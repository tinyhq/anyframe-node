/**
 * Internal HTTP transport — a thin, retry-aware wrapper around `fetch`.
 *
 * This module is private. Callers go through {@link Anyframe} and never
 * touch `HTTPClient` directly. Responsibilities:
 *
 *   - Attach `Authorization: Bearer <api_key>`, `User-Agent`, and `Accept`.
 *   - Serialize JSON bodies and query strings.
 *   - Map non-2xx responses to typed exceptions via {@link APIError.from}.
 *   - Retry once on transient failures (408, 409, 429, 5xx, network errors)
 *     with exponential backoff. Capped low — long retries belong in user code.
 *   - Respect per-call `AbortSignal` and per-call `timeout`.
 */

import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from "./errors.js";
import type { Logger } from "./logger.js";
import { VERSION } from "../version.js";

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface RequestOptions {
  /** Per-call timeout in milliseconds. Overrides the client default. */
  timeout?: number;
  /** Per-call headers. Merged over client defaults. */
  headers?: Record<string, string>;
  /** Per-call query parameters. */
  query?: Record<string, string | number | boolean | undefined | null>;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
  /** Per-call max retries. Defaults to the client setting. */
  maxRetries?: number;
}

export interface HTTPClientOptions {
  baseURL: string;
  apiKey: string;
  timeout: number;
  maxRetries: number;
  fetch: FetchLike;
  logger: Logger;
  defaultHeaders?: Record<string, string>;
}

export interface InternalRequest {
  method: string;
  path: string;
  body?: unknown;
  options?: RequestOptions;
  /** When true, do not parse the response body — return the raw `Response`. */
  stream?: boolean;
}

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);
const RETRY_BASE_MS = 250;

export class HTTPClient {
  private readonly baseURL: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: FetchLike;
  private readonly logger: Logger;

  constructor(opts: HTTPClientOptions) {
    this.baseURL = opts.baseURL.replace(/\/+$/, "");
    this.timeout = opts.timeout;
    this.maxRetries = opts.maxRetries;
    this.fetchImpl = opts.fetch;
    this.logger = opts.logger;
    this.defaultHeaders = {
      Authorization: `Bearer ${opts.apiKey}`,
      Accept: "application/json",
      "User-Agent": `anyframe-node/${VERSION}`,
      ...opts.defaultHeaders,
    };
  }

  /** Issue a JSON request and return the parsed body (or `null` for 204). */
  async request<T>(req: InternalRequest): Promise<T> {
    const response = await this.doFetch(req);
    if (response.status === 204) return null as T;
    const text = await response.text();
    if (text.length === 0) return null as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      // Server promised JSON but didn't deliver. Surface the raw text in
      // the error so the caller can see what actually came back.
      throw new APIError(response.status, "invalid JSON in response body", {
        body: text,
        headers: headersToRecord(response.headers),
      });
    }
  }

  /**
   * Issue a streaming request and return the raw `Response`. Used by SSE
   * endpoints; the caller is responsible for parsing `response.body`.
   *
   * Streaming requests do not auto-retry — once the headers are flushed,
   * the server has committed to the stream and retrying would skip frames.
   */
  async stream(
    req: InternalRequest,
    controller: AbortController,
  ): Promise<Response> {
    const response = await this.doFetch(
      { ...req, stream: true },
      controller,
      /* allowRetry */ false,
    );
    return response;
  }

  private async doFetch(
    req: InternalRequest,
    externalController?: AbortController,
    allowRetry = true,
  ): Promise<Response> {
    const url = this.buildURL(req.path, req.options?.query);
    const headers: Record<string, string> = {
      ...this.defaultHeaders,
      ...(req.options?.headers ?? {}),
    };
    let serializedBody: BodyInit | undefined;
    if (req.body !== undefined && req.body !== null) {
      serializedBody = JSON.stringify(req.body);
      headers["Content-Type"] = "application/json";
    }
    if (req.stream) {
      headers["Accept"] = "text/event-stream";
    }

    const timeout = req.options?.timeout ?? this.timeout;
    const maxRetries = allowRetry
      ? Math.max(0, req.options?.maxRetries ?? this.maxRetries)
      : 0;
    const userSignal = req.options?.signal;

    let attempt = 0;
    let lastError: unknown;

    while (attempt <= maxRetries) {
      const controller = externalController ?? new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), timeout);
      const onUserAbort = () => controller.abort();
      userSignal?.addEventListener("abort", onUserAbort, { once: true });

      const start = Date.now();
      try {
        const response = await this.fetchImpl(url, {
          method: req.method,
          headers,
          body: serializedBody,
          signal: controller.signal,
        });
        const elapsed = Date.now() - start;
        this.logger.debug(
          `${req.method} ${req.path} -> ${response.status} (${elapsed}ms)`,
        );

        if (response.ok) return response;

        if (
          attempt < maxRetries &&
          RETRYABLE_STATUS.has(response.status) &&
          !userSignal?.aborted
        ) {
          await sleep(backoffMs(attempt, response.headers.get("retry-after")));
          attempt += 1;
          continue;
        }

        const body = await safeReadBody(response);
        throw APIError.from(
          response.status,
          body,
          headersToRecord(response.headers),
        );
      } catch (err) {
        lastError = err;
        if (userSignal?.aborted) throw new APIUserAbortError();
        if (controller.signal.aborted && !userSignal?.aborted) {
          if (attempt < maxRetries) {
            await sleep(backoffMs(attempt));
            attempt += 1;
            continue;
          }
          throw new APIConnectionTimeoutError(
            `request to ${req.path} timed out after ${timeout}ms`,
          );
        }
        if (err instanceof APIError) throw err;
        if (attempt < maxRetries && isNetworkError(err)) {
          await sleep(backoffMs(attempt));
          attempt += 1;
          continue;
        }
        throw new APIConnectionError(
          `network request to ${req.path} failed: ${errorMessage(err)}`,
          err,
        );
      } finally {
        clearTimeout(timeoutHandle);
        userSignal?.removeEventListener("abort", onUserAbort);
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new APIConnectionError("request failed after retries");
  }

  private buildURL(
    path: string,
    query?: Record<string, string | number | boolean | undefined | null>,
  ): string {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const url = `${this.baseURL}${normalizedPath}`;
    if (!query) return url;
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      params.append(k, String(v));
    }
    const qs = params.toString();
    return qs.length > 0 ? `${url}?${qs}` : url;
  }
}

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

async function safeReadBody(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    if (text.length === 0) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch {
    return null;
  }
}

function backoffMs(attempt: number, retryAfterHeader?: string | null): number {
  if (retryAfterHeader) {
    const parsed = Number.parseFloat(retryAfterHeader);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.min(parsed * 1000, 30_000);
    }
  }
  const exp = RETRY_BASE_MS * Math.pow(2, attempt);
  const jitter = Math.random() * RETRY_BASE_MS;
  return Math.min(exp + jitter, 5_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNetworkError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  // `TypeError` is what node-fetch / undici throws for ECONNREFUSED, DNS, etc.
  return name === "TypeError" || name === "FetchError";
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
