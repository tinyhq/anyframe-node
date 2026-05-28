import { describe, expect, it } from "vitest";
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIUserAbortError,
  AuthenticationError,
  NotFoundError,
  RateLimitError,
  ServerError,
} from "../src/index.js";
import { makeClient } from "./helpers/client.js";
import { emptyResponse, jsonResponse } from "./helpers/mock-fetch.js";

describe("HTTPClient", () => {
  it("serializes a JSON body and Content-Type header", async () => {
    const { client, mock } = makeClient();
    mock.post("/api/tokens", (req) => {
      expect(req.body).toEqual({ name: "ci" });
      expect(req.headers["content-type"]).toBe("application/json");
      return jsonResponse({
        id: 1,
        name: "ci",
        prefix: "afm",
        last4: "abcd",
        created_at: "2026-01-01T00:00:00Z",
        token: "afm_secret",
      });
    });
    const t = await client.tokens.create({ name: "ci" });
    expect(t.token).toBe("afm_secret");
  });

  it("normalises 204 to null", async () => {
    const { client, mock } = makeClient();
    mock.del("/api/tokens/42", () => emptyResponse(204));
    await expect(client.tokens.revoke(42)).resolves.toBeNull();
  });

  it("encodes query parameters", async () => {
    const { client, mock } = makeClient();
    mock.get("/api/attention", (req) => {
      expect(req.query.get("limit")).toBe("5");
      return jsonResponse([]);
    });
    await client.attention.list({ limit: 5 });
  });

  it("trims trailing slashes from baseURL", async () => {
    const { client, mock } = makeClient({ baseURL: "https://api.test.local//" });
    mock.get("/api/me", () => jsonResponse({ id: 1, github_id: 1, login: "x" }));
    await client.me();
    expect(mock.calls[0]?.url).toBe("https://api.test.local/api/me");
  });

  it("maps non-2xx responses to typed errors", async () => {
    const { client, mock } = makeClient();
    mock.get("/api/me", () => jsonResponse({ detail: "bad token" }, { status: 401 }));
    await expect(client.me()).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("404 surfaces NotFoundError with the body message", async () => {
    const { client, mock } = makeClient();
    mock.get("/api/agents/999", () =>
      jsonResponse({ detail: "agent not found" }, { status: 404 }),
    );
    await expect(client.agents.get(999)).rejects.toMatchObject({
      name: "NotFoundError",
      status: 404,
      message: expect.stringContaining("agent not found"),
    });
  });

  it("server error becomes ServerError", async () => {
    const { client, mock } = makeClient();
    mock.get("/api/agents", () => jsonResponse({ detail: "boom" }, { status: 502 }));
    await expect(client.agents.list()).rejects.toBeInstanceOf(ServerError);
  });

  it("translates AbortSignal aborts to APIUserAbortError", async () => {
    const { client, mock } = makeClient();
    const controller = new AbortController();
    // Handler holds the request open until the signal aborts; the SDK
    // should observe the user-initiated abort and translate it.
    mock.get("/api/me", () => new Promise<Response>(() => {}));
    const inFlight = client.me({ signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    await expect(inFlight).rejects.toBeInstanceOf(APIUserAbortError);
  });

  it("times out and raises APIConnectionTimeoutError", async () => {
    const { client, mock } = makeClient();
    // Handler that never resolves — the SDK should fire its own timeout.
    mock.get("/api/me", () => new Promise<Response>(() => {}));
    await expect(client.me({ timeout: 20 })).rejects.toBeInstanceOf(
      APIConnectionTimeoutError,
    );
  });

  it("wraps a thrown TypeError as APIConnectionError", async () => {
    const { client, mock } = makeClient();
    mock.get("/api/me", () => {
      const e = new TypeError("connection refused");
      throw e;
    });
    await expect(client.me()).rejects.toBeInstanceOf(APIConnectionError);
  });
});

describe("HTTPClient retries", () => {
  it("retries a 503 then succeeds", async () => {
    const { client, mock } = makeClient({ maxRetries: 1 });
    let attempts = 0;
    mock.get("/api/me", () => {
      attempts += 1;
      if (attempts === 1) {
        return jsonResponse({ detail: "down" }, { status: 503 });
      }
      return jsonResponse({ id: 1, github_id: 1, login: "x" });
    });
    const me = await client.me();
    expect(me.login).toBe("x");
    expect(attempts).toBe(2);
  });

  it("retries a 429 once and surfaces RateLimitError after exhausting retries", async () => {
    const { client, mock } = makeClient({ maxRetries: 1 });
    mock.get("/api/me", () =>
      jsonResponse(
        { detail: "slow down" },
        { status: 429, headers: { "retry-after": "0" } },
      ),
    );
    await expect(client.me()).rejects.toBeInstanceOf(RateLimitError);
  });

  it("does not retry on 404", async () => {
    const { client, mock } = makeClient({ maxRetries: 3 });
    let attempts = 0;
    mock.get("/api/me", () => {
      attempts += 1;
      return jsonResponse({ detail: "nope" }, { status: 404 });
    });
    await expect(client.me()).rejects.toBeInstanceOf(NotFoundError);
    expect(attempts).toBe(1);
  });
});
