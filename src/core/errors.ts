/**
 * Typed error hierarchy raised by the SDK.
 *
 * Every error extends {@link AnyframeError}, so one `catch` clause covers
 * the SDK. Common HTTP failure modes have their own subclasses so callers
 * branch on intent (auth, not-found, validation) rather than scrape status
 * codes.
 */

export class AnyframeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnyframeError";
  }
}

export class APIError extends AnyframeError {
  /** HTTP status code, or 0 for transport failures (DNS, connection refused, timeout). */
  readonly status: number;
  /** The raw response body, parsed as JSON when possible. */
  readonly body: unknown;
  /** Response headers, when available. */
  readonly headers: Record<string, string> | undefined;
  /** Request id from the `x-request-id` header, when set by the server. */
  readonly requestId: string | undefined;

  constructor(
    status: number,
    message: string,
    options: { body?: unknown; headers?: Record<string, string> } = {},
  ) {
    super(`[${status}] ${message}`);
    this.name = "APIError";
    this.status = status;
    this.body = options.body;
    this.headers = options.headers;
    this.requestId = options.headers?.["x-request-id"];
  }

  /**
   * Build the correct subclass for a given HTTP status.
   *
   * The shape of `body` follows FastAPI's convention — a `{ detail: ... }`
   * envelope where `detail` is either a string message or a structured list
   * (Pydantic validation errors).
   */
  static from(
    status: number,
    body: unknown,
    headers: Record<string, string>,
  ): APIError {
    const message = extractMessage(body, status);
    const opts = { body, headers };
    if (status === 401) return new AuthenticationError(message, opts);
    if (status === 403) return new PermissionDeniedError(message, opts);
    if (status === 404) return new NotFoundError(message, opts);
    if (status === 409) return new ConflictError(message, opts);
    if (status === 400 || status === 422) {
      return new ValidationError(message, {
        ...opts,
        details: extractDetails(body),
        status,
      });
    }
    if (status === 429) {
      const retryAfter = headers["retry-after"];
      const parsed = retryAfter ? Number.parseInt(retryAfter, 10) : NaN;
      return new RateLimitError(message, {
        ...opts,
        retryAfter: Number.isFinite(parsed) ? parsed : undefined,
      });
    }
    if (status >= 500) return new ServerError(status, message, opts);
    return new APIError(status, message, opts);
  }
}

export class APIConnectionError extends APIError {
  constructor(message: string, cause?: unknown) {
    super(0, message, {});
    this.name = "APIConnectionError";
    if (cause !== undefined) this.cause = cause;
  }
}

export class APIConnectionTimeoutError extends APIConnectionError {
  constructor(message = "request timed out") {
    super(message);
    this.name = "APIConnectionTimeoutError";
  }
}

export class APIUserAbortError extends AnyframeError {
  constructor(message = "request was aborted") {
    super(message);
    this.name = "APIUserAbortError";
  }
}

export class AuthenticationError extends APIError {
  constructor(message = "authentication failed", options: ErrorOptions = {}) {
    super(401, message, options);
    this.name = "AuthenticationError";
  }
}

export class PermissionDeniedError extends APIError {
  constructor(message = "permission denied", options: ErrorOptions = {}) {
    super(403, message, options);
    this.name = "PermissionDeniedError";
  }
}

export class NotFoundError extends APIError {
  constructor(message = "not found", options: ErrorOptions = {}) {
    super(404, message, options);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends APIError {
  constructor(message = "conflict", options: ErrorOptions = {}) {
    super(409, message, options);
    this.name = "ConflictError";
  }
}

export class ValidationError extends APIError {
  /** Raw field-level error list when the server returned a structured 422 payload. */
  readonly details: unknown;

  constructor(
    message = "validation failed",
    options: ErrorOptions & { details?: unknown; status?: number } = {},
  ) {
    super(options.status ?? 422, message, options);
    this.name = "ValidationError";
    this.details = options.details;
  }
}

export class RateLimitError extends APIError {
  /** Seconds the server asked the caller to wait, parsed from `Retry-After`. */
  readonly retryAfter: number | undefined;

  constructor(
    message = "rate limited",
    options: ErrorOptions & { retryAfter?: number } = {},
  ) {
    super(429, message, options);
    this.name = "RateLimitError";
    this.retryAfter = options.retryAfter;
  }
}

export class ServerError extends APIError {
  constructor(status = 500, message = "server error", options: ErrorOptions = {}) {
    super(status, message, options);
    this.name = "ServerError";
  }
}

type ErrorOptions = { body?: unknown; headers?: Record<string, string> };

function extractMessage(body: unknown, status: number): string {
  if (typeof body === "string" && body.length > 0) return body;
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) return `validation failed (${detail.length} issue(s))`;
    if (detail != null) return String(detail);
  }
  return `HTTP ${status}`;
}

function extractDetails(body: unknown): unknown {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (Array.isArray(detail)) return detail;
  }
  return undefined;
}
