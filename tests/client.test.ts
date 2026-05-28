import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Anyframe, { AuthenticationError, VERSION } from "../src/index.js";
import { BASE_URL, makeClient } from "./helpers/client.js";
import { jsonResponse } from "./helpers/mock-fetch.js";

describe("Anyframe constructor", () => {
  beforeEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith("ANYFRAME_")) delete process.env[k];
    }
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses explicit apiKey over env", () => {
    process.env.ANYFRAME_API_KEY = "afm_env";
    const { client, mock } = makeClient({ apiKey: "afm_explicit" });
    // sanity: send a request, check the auth header
    mock.get("/api/me", () => jsonResponse({ id: 1, github_id: 1, login: "x" }));
    return client.me().then(() => {
      expect(mock.calls[0]?.headers.authorization).toBe("Bearer afm_explicit");
    });
  });

  it("falls back to ANYFRAME_API_KEY when not passed", async () => {
    process.env.ANYFRAME_API_KEY = "afm_envkey";
    const mock = new (await import("./helpers/mock-fetch.js")).MockFetch();
    const client = new Anyframe({ baseURL: BASE_URL, fetch: mock.fetch, maxRetries: 0 });
    mock.get("/api/me", () => jsonResponse({ id: 1, github_id: 1, login: "x" }));
    await client.me();
    expect(mock.calls[0]?.headers.authorization).toBe("Bearer afm_envkey");
  });

  it("defaults baseURL to https://api.anyfrm.com", () => {
    const client = new Anyframe({ apiKey: "afm_test" });
    expect(client.baseURL).toBe("https://api.anyfrm.com");
  });

  it("falls back to ANYFRAME_BASE_URL when baseURL not passed", () => {
    process.env.ANYFRAME_API_KEY = "afm_test";
    process.env.ANYFRAME_BASE_URL = "https://staging.anyfrm.com";
    const client = new Anyframe();
    expect(client.baseURL).toBe("https://staging.anyfrm.com");
  });

  it("throws AuthenticationError when no api key resolved", () => {
    expect(() => new Anyframe()).toThrow(AuthenticationError);
  });

  it("attaches User-Agent identifying the SDK version", async () => {
    const { client, mock } = makeClient();
    mock.get("/api/me", () => jsonResponse({ id: 1, github_id: 1, login: "x" }));
    await client.me();
    expect(mock.calls[0]?.headers["user-agent"]).toBe(`anyframe-node/${VERSION}`);
  });

  it("exposes resources as instance properties", () => {
    const { client } = makeClient();
    expect(client.tokens).toBeDefined();
    expect(client.credentials).toBeDefined();
    expect(client.connectors).toBeDefined();
    expect(client.agents).toBeDefined();
    expect(client.sessions).toBeDefined();
    expect(client.attention).toBeDefined();
  });

  it("exposes error classes as static properties (Stainless parity)", () => {
    expect(Anyframe.APIError).toBeDefined();
    expect(Anyframe.AuthenticationError).toBeDefined();
    expect(Anyframe.NotFoundError).toBeDefined();
    expect(Anyframe.RateLimitError).toBeDefined();
  });

  it("me() returns the authenticated user", async () => {
    const { client, mock } = makeClient();
    mock.get("/api/me", () =>
      jsonResponse({ id: 7, github_id: 12345, login: "alice", name: "Alice" }),
    );
    const me = await client.me();
    expect(me.login).toBe("alice");
    expect(me.id).toBe(7);
  });
});
