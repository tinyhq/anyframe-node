/**
 * The top-level {@link Anyframe} client.
 *
 * Construction is the only place env-var resolution happens: callers
 * either pass `apiKey` / `baseURL` explicitly or rely on
 * `ANYFRAME_API_KEY` / `ANYFRAME_BASE_URL`. Authentication is a Bearer
 * token (`afm_...`); mint one in the dashboard or via
 * `client.tokens.create({ name })`.
 *
 *     import Anyframe from "anyframe";
 *
 *     const client = new Anyframe();          // reads env vars
 *     const me = await client.me();
 *     const agent = await client.agents.create({ name: "demo" });
 */

import { ENV_API_KEY, ENV_BASE_URL, readEnv } from "./core/env.js";
import { AuthenticationError } from "./core/errors.js";
import type { FetchLike, RequestOptions } from "./core/http.js";
import { HTTPClient } from "./core/http.js";
import type { Logger } from "./core/logger.js";
import { createLogger } from "./core/logger.js";
import { Agents } from "./resources/agents.js";
import { Attention } from "./resources/attention.js";
import { Connectors } from "./resources/connectors.js";
import { Credentials } from "./resources/credentials.js";
import { Sessions } from "./resources/sessions.js";
import { Tokens } from "./resources/tokens.js";
import type { User } from "./types.js";

export const DEFAULT_BASE_URL = "https://api.anyframe.dev";
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_RETRIES = 2;

export interface AnyframeOptions {
  /** Personal API token (starts with `afm_`). Falls back to `ANYFRAME_API_KEY`. */
  apiKey?: string;
  /** Override the control-plane URL. Falls back to `ANYFRAME_BASE_URL`, then the default. */
  baseURL?: string;
  /** Per-request timeout in milliseconds. Default: 30s. */
  timeout?: number;
  /** Max retry attempts on transient failures (408/409/429/5xx). Default: 2. */
  maxRetries?: number;
  /** Custom `fetch` implementation. Defaults to the runtime's global `fetch`. */
  fetch?: FetchLike;
  /** Extra headers attached to every request. */
  defaultHeaders?: Record<string, string>;
  /** Inject a custom logger. Defaults to a console logger gated by `ANYFRAME_LOG_LEVEL`. */
  logger?: Logger;
}

/** The official AnyFrame SDK client. */
export class Anyframe {
  readonly baseURL: string;

  readonly tokens: Tokens;
  readonly credentials: Credentials;
  readonly connectors: Connectors;
  readonly agents: Agents;
  readonly sessions: Sessions;
  readonly attention: Attention;

  private readonly _http: HTTPClient;

  constructor(options: AnyframeOptions = {}) {
    const apiKey = options.apiKey ?? readEnv(ENV_API_KEY);
    if (!apiKey) {
      throw new AuthenticationError(
        `missing API key — pass { apiKey } or set ${ENV_API_KEY} in your environment`,
      );
    }
    const baseURL = options.baseURL ?? readEnv(ENV_BASE_URL) ?? DEFAULT_BASE_URL;
    const fetchImpl = options.fetch ?? resolveDefaultFetch();
    const logger = options.logger ?? createLogger();

    this.baseURL = baseURL;
    this._http = new HTTPClient({
      baseURL,
      apiKey,
      timeout: options.timeout ?? DEFAULT_TIMEOUT_MS,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
      fetch: fetchImpl,
      logger,
      ...(options.defaultHeaders ? { defaultHeaders: options.defaultHeaders } : {}),
    });

    logger.info(`anyframe client initialised (baseURL=${baseURL})`);

    this.tokens = new Tokens(this._http);
    this.credentials = new Credentials(this._http);
    this.connectors = new Connectors(this._http);
    this.agents = new Agents(this._http);
    this.sessions = new Sessions(this._http);
    this.attention = new Attention(this._http);
  }

  /** Return the authenticated user (`GET /api/me`). */
  me(options?: RequestOptions): Promise<User> {
    return this._http.request<User>({ method: "GET", path: "/api/me", options });
  }
}

function resolveDefaultFetch(): FetchLike {
  if (typeof globalThis.fetch === "function") {
    // Bind to globalThis so `this` is preserved in undici/Bun/Deno.
    return globalThis.fetch.bind(globalThis) as FetchLike;
  }
  throw new Error(
    "anyframe: no global `fetch` is available. Use Node 18+ or pass a custom `fetch` to `new Anyframe({ fetch })`.",
  );
}
