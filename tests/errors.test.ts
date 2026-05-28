import { describe, expect, it } from "vitest";
import {
  APIError,
  AuthenticationError,
  ConflictError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  ServerError,
  ValidationError,
} from "../src/index.js";

describe("APIError.from", () => {
  it("dispatches 401 -> AuthenticationError", () => {
    const err = APIError.from(401, { detail: "bad key" }, {});
    expect(err).toBeInstanceOf(AuthenticationError);
    expect(err.status).toBe(401);
    expect(err.message).toContain("bad key");
  });

  it("dispatches 403 -> PermissionDeniedError", () => {
    const err = APIError.from(403, { detail: "nope" }, {});
    expect(err).toBeInstanceOf(PermissionDeniedError);
  });

  it("dispatches 404 -> NotFoundError", () => {
    const err = APIError.from(404, { detail: "agent not found" }, {});
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.message).toContain("agent not found");
  });

  it("dispatches 409 -> ConflictError", () => {
    const err = APIError.from(409, { detail: "conflict" }, {});
    expect(err).toBeInstanceOf(ConflictError);
  });

  it("dispatches 400/422 -> ValidationError with structured details", () => {
    const details = [{ loc: ["body", "name"], msg: "required", type: "missing" }];
    const err = APIError.from(422, { detail: details }, {});
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).details).toEqual(details);
  });

  it("dispatches 429 -> RateLimitError with retryAfter from header", () => {
    const err = APIError.from(429, { detail: "slow down" }, { "retry-after": "30" });
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfter).toBe(30);
  });

  it("RateLimitError handles missing/invalid Retry-After", () => {
    const err = APIError.from(429, { detail: "slow down" }, {});
    expect((err as RateLimitError).retryAfter).toBeUndefined();
  });

  it("dispatches 5xx -> ServerError", () => {
    const err = APIError.from(503, { detail: "down" }, {});
    expect(err).toBeInstanceOf(ServerError);
    expect(err.status).toBe(503);
  });

  it("treats other codes as APIError (not a subclass)", () => {
    const err = APIError.from(418, { detail: "teapot" }, {});
    expect(err).toBeInstanceOf(APIError);
    expect(err).not.toBeInstanceOf(NotFoundError);
  });

  it("falls back to `HTTP <status>` when the body is empty", () => {
    const err = APIError.from(500, null, {});
    expect(err.message).toContain("500");
  });

  it("exposes request id from x-request-id header", () => {
    const err = APIError.from(500, null, { "x-request-id": "req_abc123" });
    expect(err.requestId).toBe("req_abc123");
  });

  it("stringifies a structured 422 detail array sensibly", () => {
    const details = [
      { loc: ["body", "name"], msg: "required", type: "missing" },
      { loc: ["body", "runtime"], msg: "invalid", type: "value_error" },
    ];
    const err = APIError.from(422, { detail: details }, {});
    expect(err.message).toContain("2 issue(s)");
  });
});
