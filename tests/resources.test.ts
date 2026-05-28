import { describe, expect, it } from "vitest";
import { APIUserAbortError } from "../src/index.js";
import { makeClient } from "./helpers/client.js";
import { emptyResponse, jsonResponse } from "./helpers/mock-fetch.js";

describe("Tokens", () => {
  it("lists tokens", async () => {
    const { client, mock } = makeClient();
    mock.get("/api/tokens", () =>
      jsonResponse([
        {
          id: 1,
          name: "ci",
          prefix: "afm",
          last4: "abcd",
          created_at: "2026-01-01T00:00:00Z",
        },
      ]),
    );
    const tokens = await client.tokens.list();
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.name).toBe("ci");
  });

  it("creates and revokes a token", async () => {
    const { client, mock } = makeClient();
    mock.post("/api/tokens", (req) => {
      expect(req.body).toEqual({ name: "ci" });
      return jsonResponse({
        id: 1,
        name: "ci",
        prefix: "afm",
        last4: "abcd",
        created_at: "2026-01-01T00:00:00Z",
        token: "afm_secret",
      });
    });
    mock.del("/api/tokens/1", () => emptyResponse());
    const t = await client.tokens.create({ name: "ci" });
    expect(t.token).toBe("afm_secret");
    await client.tokens.revoke(1);
    expect(mock.calls.at(-1)?.method).toBe("DELETE");
  });
});

describe("Credentials", () => {
  it("returns redacted credentials", async () => {
    const { client, mock } = makeClient();
    mock.get("/api/credentials", () =>
      jsonResponse({
        claude: { set: true, last4: "1234", updated_at: "2026-01-01T00:00:00Z" },
        codex: { set: false },
        github: { set: true, last4: "abcd", updated_at: "2026-01-01T00:00:00Z" },
      }),
    );
    const creds = await client.credentials.get();
    expect(creds.claude.set).toBe(true);
    expect(creds.codex.set).toBe(false);
  });

  it("sets a Claude token", async () => {
    const { client, mock } = makeClient();
    mock.put("/api/credentials/claude", (req) => {
      expect(req.body).toEqual({ token: "secret" });
      return emptyResponse();
    });
    await client.credentials.setClaude("secret");
  });

  it("clears a Codex token", async () => {
    const { client, mock } = makeClient();
    mock.del("/api/credentials/codex", () => emptyResponse());
    await client.credentials.clearCodex();
    expect(mock.calls[0]?.method).toBe("DELETE");
  });
});

describe("Connectors", () => {
  it("discovers an MCP URL", async () => {
    const { client, mock } = makeClient();
    mock.post("/api/connectors/discover", (req) => {
      expect(req.body).toEqual({ mcp_url: "https://mcp.linear.app/sse" });
      return jsonResponse({
        mcp_url: "https://mcp.linear.app/sse",
        supports_dcr: true,
        suggested_display_name: "Linear",
        scopes_supported: [],
      });
    });
    const d = await client.connectors.discover("https://mcp.linear.app/sse");
    expect(d.supports_dcr).toBe(true);
  });

  it("creates an OAuth connector with default_enabled=true by default", async () => {
    const { client, mock } = makeClient();
    mock.post("/api/connectors/oauth", (req) => {
      expect(req.body).toEqual({
        mcp_url: "https://mcp.linear.app/sse",
        display_name: "Linear",
        default_enabled: true,
      });
      return jsonResponse({
        connector_id: 1,
        authorize_url: "https://linear.app/oauth/authorize?...",
        state: "abc",
      });
    });
    const a = await client.connectors.createOauth({
      mcp_url: "https://mcp.linear.app/sse",
      display_name: "Linear",
    });
    expect(a.connector_id).toBe(1);
  });

  it("installs a catalog connector by slug", async () => {
    const { client, mock } = makeClient();
    mock.post("/api/connectors/catalog/linear/oauth", () =>
      jsonResponse({
        connector_id: 2,
        authorize_url: "https://linear.app/...",
        state: "xyz",
      }),
    );
    const a = await client.connectors.installCatalogOauth("linear");
    expect(a.connector_id).toBe(2);
  });
});

describe("Agents", () => {
  it("prunes null/undefined fields in create body", async () => {
    const { client, mock } = makeClient();
    mock.post("/api/agents", (req) => {
      expect(req.body).toEqual({ name: "demo" });
      return jsonResponse(agentFixture());
    });
    await client.agents.create({ name: "demo" });
  });

  it("lists agents", async () => {
    const { client, mock } = makeClient();
    mock.get("/api/agents", () => jsonResponse([agentFixture()]));
    const agents = await client.agents.list();
    expect(agents[0]?.name).toBe("demo");
  });

  it("nests skills subresource under agents", async () => {
    const { client, mock } = makeClient();
    mock.post("/api/agents/42/skills", (req) => {
      expect(req.body).toEqual({
        name: "deploy",
        source: "inline",
        content: { md: "..." },
        enabled: true,
      });
      return jsonResponse({
        id: 1,
        name: "deploy",
        source: "inline",
        content: { md: "..." },
        enabled: true,
        created_at: "2026-01-01T00:00:00Z",
      });
    });
    const s = await client.agents.skills.create(42, {
      name: "deploy",
      source: "inline",
      content: { md: "..." },
    });
    expect(s.name).toBe("deploy");
  });

  it("waitForBuild aborts promptly via signal during sleep", async () => {
    const { client, mock } = makeClient();
    const controller = new AbortController();
    // First call returns "running". The poll loop then enters abortableSleep
    // for a long interval; the abort should preempt it.
    mock.get("/api/agents/1/build/status", () => jsonResponse({ agent_id: 1, state: "running" }));
    setTimeout(() => controller.abort(), 20);
    await expect(
      client.agents.waitForBuild(1, {
        pollInterval: 10_000,
        timeout: 60_000,
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(APIUserAbortError);
  });

  it("waitForBuild resolves on terminal success state", async () => {
    const { client, mock } = makeClient();
    let calls = 0;
    mock.get("/api/agents/1/build/status", () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse({ agent_id: 1, state: "running" });
      }
      return jsonResponse({ agent_id: 1, state: "succeeded", built_image_id: "img_abc" });
    });
    const status = await client.agents.waitForBuild(1, { pollInterval: 5, timeout: 1000 });
    expect(status.state).toBe("succeeded");
    expect(calls).toBe(2);
  });
});

describe("Sessions", () => {
  it("creates a session with sane defaults", async () => {
    const { client, mock } = makeClient();
    mock.post("/api/sessions", (req) => {
      expect(req.body).toEqual({
        agent_id: 1,
        idle_timeout_s: 300,
        unsafe: false,
      });
      return jsonResponse(sessionFixture());
    });
    await client.sessions.create({ agent_id: 1 });
  });

  it("transcript passes since/limit in query", async () => {
    const { client, mock } = makeClient();
    mock.get("/api/sessions/abc/transcript", (req) => {
      expect(req.query.get("since")).toBe("10");
      expect(req.query.get("limit")).toBe("50");
      return jsonResponse([]);
    });
    await client.sessions.transcript("abc", { since: 10, limit: 50 });
  });

  it("waitUntilRunning resolves when status flips to running", async () => {
    const { client, mock } = makeClient();
    let calls = 0;
    mock.get("/api/sessions/abc", () => {
      calls += 1;
      const status = calls === 1 ? "booting" : "running";
      return jsonResponse(sessionFixture({ status }));
    });
    const s = await client.sessions.waitUntilRunning("abc", {
      pollInterval: 5,
      timeout: 1000,
    });
    expect(s.status).toBe("running");
    expect(calls).toBe(2);
  });

  it("waitUntilRunning aborts promptly via signal during sleep", async () => {
    const { client, mock } = makeClient();
    const controller = new AbortController();
    mock.get("/api/sessions/abc", () => jsonResponse(sessionFixture({ status: "booting" })));
    setTimeout(() => controller.abort(), 20);
    await expect(
      client.sessions.waitUntilRunning("abc", {
        pollInterval: 10_000,
        timeout: 60_000,
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(APIUserAbortError);
  });

  it("waitUntilRunning throws when session enters terminal state", async () => {
    const { client, mock } = makeClient();
    mock.get("/api/sessions/abc", () => jsonResponse(sessionFixture({ status: "error" })));
    await expect(
      client.sessions.waitUntilRunning("abc", { pollInterval: 5, timeout: 1000 }),
    ).rejects.toThrow(/error/);
  });

  it("previews.start prunes optional fields", async () => {
    const { client, mock } = makeClient();
    mock.post("/api/sessions/abc/previews", (req) => {
      expect(req.body).toEqual({ action: "start", cmd: "bun dev" });
      return jsonResponse({ ok: true });
    });
    await client.sessions.previews.start("abc", { cmd: "bun dev" });
  });
});

describe("Attention", () => {
  it("returns the rail with default limit=20", async () => {
    const { client, mock } = makeClient();
    mock.get("/api/attention", (req) => {
      expect(req.query.get("limit")).toBe("20");
      return jsonResponse([]);
    });
    await client.attention.list();
  });
});

// ── fixtures ───────────────────────────────────────────────────────────────

function agentFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    name: "demo",
    runtime: "claude",
    preview_ports: [],
    permissions: {},
    env_vars: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function sessionFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "abc",
    agent_id: 1,
    status: "booting",
    idle_timeout_s: 300,
    previews: [],
    created_at: "2026-01-01T00:00:00Z",
    last_active: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}
