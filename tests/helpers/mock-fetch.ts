/**
 * Tiny fetch mock used by the SDK tests.
 *
 * Each test sets up handlers via `mock.on("METHOD", "/path", handler)`,
 * then passes `mock.fetch` to the SDK constructor. Handlers receive the
 * parsed request (method, url, body, headers) and return a Response.
 *
 * Why a hand-rolled mock instead of MSW? The SDK is fetch-based and
 * single-threaded; testing it through a real HTTP server adds latency
 * for no extra signal. The mock here lets us assert on outgoing
 * requests directly and simulate streams via `ReadableStream`.
 */

import { vi } from "vitest";

export interface MockRequest {
  method: string;
  url: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  body: unknown;
}

export type Handler = (req: MockRequest) => Response | Promise<Response>;

interface Route {
  method: string;
  path: string;
  handler: Handler;
}

export class MockFetch {
  private routes: Route[] = [];
  readonly calls: MockRequest[] = [];

  on(method: string, path: string, handler: Handler): this {
    this.routes.push({ method: method.toUpperCase(), path, handler });
    return this;
  }

  /** Convenience helpers for the common verbs. */
  get(path: string, handler: Handler): this {
    return this.on("GET", path, handler);
  }
  post(path: string, handler: Handler): this {
    return this.on("POST", path, handler);
  }
  put(path: string, handler: Handler): this {
    return this.on("PUT", path, handler);
  }
  patch(path: string, handler: Handler): this {
    return this.on("PATCH", path, handler);
  }
  del(path: string, handler: Handler): this {
    return this.on("DELETE", path, handler);
  }

  reset(): void {
    this.routes = [];
    this.calls.length = 0;
  }

  readonly fetch = vi.fn(async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === "string" ? input : input.toString();
    const url = new URL(urlStr);
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname;
    const headers: Record<string, string> = {};
    const rawHeaders = init?.headers;
    if (rawHeaders instanceof Headers) {
      rawHeaders.forEach((v, k) => {
        headers[k.toLowerCase()] = v;
      });
    } else if (Array.isArray(rawHeaders)) {
      for (const [k, v] of rawHeaders) headers[k.toLowerCase()] = v;
    } else if (rawHeaders && typeof rawHeaders === "object") {
      for (const [k, v] of Object.entries(rawHeaders as Record<string, string>)) {
        headers[k.toLowerCase()] = v;
      }
    }
    let body: unknown = undefined;
    if (init?.body) {
      const raw = init.body as string;
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }
    const req: MockRequest = {
      method,
      url: urlStr,
      path,
      query: url.searchParams,
      headers,
      body,
    };
    this.calls.push(req);

    const route = this.routes.find((r) => r.method === method && r.path === path);
    if (!route) {
      return new Response(
        JSON.stringify({ detail: `no mock for ${method} ${path}` }),
        { status: 599, headers: { "content-type": "application/json" } },
      );
    }
    // Honor AbortSignal so abort + timeout tests behave like a real fetch.
    const signal = init?.signal as AbortSignal | undefined;
    if (signal?.aborted) {
      throw mkAbortError();
    }
    return new Promise<Response>((resolve, reject) => {
      const onAbort = () => reject(mkAbortError());
      signal?.addEventListener("abort", onAbort, { once: true });
      Promise.resolve(route.handler(req)).then(
        (response) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(response);
        },
        (err) => {
          signal?.removeEventListener("abort", onAbort);
          reject(err as Error);
        },
      );
    });
  });
}

function mkAbortError(): DOMException {
  // Match what undici/native fetch throws on abort.
  return new DOMException("The operation was aborted.", "AbortError");
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...((init.headers ?? {}) as Record<string, string>),
    },
  });
}

export function emptyResponse(status = 204): Response {
  return new Response(null, { status });
}

export function sseResponse(frames: string[]): Response {
  // Stream the SSE frames out one at a time so the SDK's parser is
  // exercised against a real ReadableStream<Uint8Array>, not a single
  // pre-baked buffer.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}
