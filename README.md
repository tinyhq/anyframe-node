# anyframe

[![npm version](https://img.shields.io/npm/v/anyframe.svg)](https://www.npmjs.com/package/anyframe)
[![CI](https://github.com/tinyhq/anyframe-node/actions/workflows/ci.yml/badge.svg)](https://github.com/tinyhq/anyframe-node/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

The official JavaScript / TypeScript SDK for the [AnyFrame](https://anyfrm.com) control plane — point an agent at a repo, get a sandbox running Claude Code (or Codex) inside.

```
                                ┌──────────────────────────────┐
                                │  Agent  (repo, system prompt)│
                                │   ├── Skills                 │
                                │   ├── MCPs                   │
                                │   └── Connector toggles      │
   ┌──────────┐   anyframe SDK  └─────────────┬────────────────┘
   │   you    │ ───────────────────▶          │  build
   │ (TS/JS)  │                               ▼
   └──────────┘   ┌──────────────────────────────────────────┐
                  │ Session (sandbox · chat · serve)         │
                  └──────────────────────────────────────────┘
```

User-level **Connectors** plug MCP servers (Linear, Sentry, …) in once and toggle them per-agent. **Skills** + **MCPs** ride with the agent into every session it boots.

Runs on Node 18+, Bun, Deno, Cloudflare Workers, and the browser — anywhere with a global `fetch`.

## Install

```bash
# npm
npm install anyframe

# bun
bun add anyframe

# pnpm
pnpm add anyframe

# yarn
yarn add anyframe
```

## Quickstart

```ts
import Anyframe from "anyframe";

const client = new Anyframe();          // reads ANYFRAME_API_KEY + ANYFRAME_BASE_URL

const agent = await client.agents.create({
  name: "demo",
  repo_url: "tinyhq/box",
  install_cmd: "bun install",
});

await client.agents.build(agent.id);
await client.agents.waitForBuild(agent.id);

const session = await client.sessions.create({ agent_id: agent.id });
await client.sessions.waitUntilRunning(session.id);

console.log(session.sandbox_url);
```

## Authentication

Set environment variables (or pass them explicitly):

```bash
ANYFRAME_API_KEY=afm_...
ANYFRAME_BASE_URL=https://api.anyfrm.com   # optional, this is the default
ANYFRAME_LOG_LEVEL=debug                   # optional, debug | info | warn | error | silent
```

Mint a key in the dashboard, or from a logged-in session via the SDK:

```ts
const t = await client.tokens.create({ name: "my-laptop" });
console.log(t.token); // afm_... — store it now, it isn't shown again
```

## Streaming chat events

```ts
const stream = await client.sessions.events(session.id);

for await (const event of stream) {
  console.log(event.event, event.data);
}

// Cancel from outside the loop:
stream.controller.abort();
```

The stream is a single-pass async iterable. Pass `lastEventId` to resume from a checkpoint after a disconnect — the server replays anything past that sequence.

```ts
const stream = await client.sessions.events(session.id, {
  lastEventId: "42",
});
```

## Agents

Agents are the unit of "what runs in the sandbox" — a repo, a system prompt, a permissions config.

```ts
await client.agents.list();
await client.agents.create({
  name: "demo",
  repo_url: "owner/name",
  install_cmd: "bun install",
  runtime: "claude",                   // or "codex"
  env_vars: { DATABASE_URL: "..." },   // injected into every session
});
await client.agents.get(agentId);      // AgentDetail: includes skills, mcps, connectors, image
await client.agents.update(agentId, { name: "renamed" });
await client.agents.delete(agentId);
```

### Skills

Skills are bundles of instructions the agent loads at boot ("deploy this app", "review this PR").

```ts
await client.agents.skills.list(agentId);
await client.agents.skills.create(agentId, {
  name: "deploy",
  source: "inline",
  content: { md: "When asked to deploy, run `railway up`..." },
});
await client.agents.skills.update(agentId, skillId, { enabled: false });
await client.agents.skills.delete(agentId, skillId);
```

### MCPs

Inline MCP servers attached to one agent. For reusable MCP setups, see Connectors below.

```ts
await client.agents.mcps.list(agentId);
await client.agents.mcps.create(agentId, {
  name: "git",
  transport: "http",
  config: { url: "..." },
});
```

## Connectors

User-level MCP connectors — configure once, then opt in per-agent.

```ts
await client.connectors.list();

const d = await client.connectors.discover("https://mcp.linear.app/sse");
const auth = await client.connectors.createOauth({
  mcp_url: d.mcp_url,
  display_name: "Linear",
});
// Open auth.authorize_url in a browser; the callback completes server-side.

await client.connectors.createBearer({
  mcp_url: "https://example.com/mcp",
  display_name: "Internal MCP",
  token: "...",
});

await client.connectors.reauthorize(connectorId);
await client.connectors.delete(connectorId);
```

### Catalog

The control plane ships with a curated catalog (Linear, Sentry, Google, …). Install by slug:

```ts
const catalog = await client.connectors.listCatalog();
await client.connectors.installCatalogOauth("linear");       // → authorize URL
await client.connectors.installCatalogBearer("sentry", { token: "..." });
```

Per-agent toggle — which connectors apply to a given agent:

```ts
await client.agents.connectors.list(agentId);
await client.agents.connectors.set(agentId, connectorId, { enabled: true });
```

## Builds

Builds bake an agent's repo + dependencies into a cached sandbox image — required before a session can boot.

```ts
const queued = await client.agents.build(agentId, { force: false });
const status = await client.agents.buildStatus(agentId);
const history = await client.agents.builds(agentId, { limit: 20 });
const log = await client.agents.buildLogUrl(agentId, buildId);

await client.agents.waitForBuild(agentId);   // polls until terminal

// Or stream build logs as they happen:
const stream = await client.agents.streamBuild(agentId, buildId);
for await (const event of stream) {
  console.log(event.event, event.data);
}
```

## Sessions

```ts
const session = await client.sessions.create({
  agent_id: agentId,
  idle_timeout_s: 600,         // optional, default 300
});

await client.sessions.waitUntilRunning(session.id);

await client.sessions.sendMessage(session.id, { content: "summarize the README" });

// Persisted chat history (server-side):
const events = await client.sessions.transcript(session.id, { since: 0, limit: 1000 });

// Snapshot + terminate, then re-boot from the snapshot later:
await client.sessions.terminate(session.id);
await client.sessions.resume(session.id);

// Or delete entirely:
await client.sessions.delete(session.id);
```

### Live previews

Start dev servers inside the sandbox and proxy them out via the control plane:

```ts
await client.sessions.previews.start(session.id, { cmd: "bun dev", port: 3000 });
await client.sessions.previews.list(session.id);
await client.sessions.previews.stop(session.id, { port: 3000 });
await client.sessions.previews.logs(session.id, { port: 3000, tail: 200 });

// Or start a batch atomically (restart-once semantics):
await client.sessions.previews.batchStart(session.id, [
  { cmd: "bun dev", port: 3000, name: "web" },
  { cmd: "bun worker", name: "worker" },
]);
```

## Attention rail

```ts
const items = await client.attention.list();
for (const item of items) {
  if (item.kind === "pending") {
    // operator action needed (permission request or ask_user_question)
  }
}
```

## Error handling

Every failure derives from `AnyframeError`. The typed subclasses let you branch on intent:

```ts
import Anyframe, { NotFoundError, RateLimitError } from "anyframe";

try {
  await client.agents.get(9999);
} catch (err) {
  if (err instanceof NotFoundError) {
    console.log("no such agent");
  } else if (err instanceof RateLimitError) {
    console.log(`slow down for ${err.retryAfter}s`);
  } else if (err instanceof Anyframe.APIError) {
    console.log(`api error ${err.status}: ${err.message}`);
  } else {
    throw err;
  }
}
```

| Status   | Class                       |
| -------- | --------------------------- |
| 401      | `AuthenticationError`       |
| 403      | `PermissionDeniedError`     |
| 404      | `NotFoundError`             |
| 409      | `ConflictError`             |
| 400, 422 | `ValidationError`           |
| 429      | `RateLimitError`            |
| 5xx      | `ServerError`               |
| —        | `APIConnectionError`        |
| —        | `APIConnectionTimeoutError` |
| —        | `APIUserAbortError`         |

Error instances expose `status`, `body`, `headers`, and `requestId` (from the `x-request-id` response header).

## Per-call options

Every method accepts an optional `RequestOptions` argument:

```ts
await client.agents.list({
  timeout: 5000,                       // ms; overrides the client default
  signal: controller.signal,           // AbortSignal for cancellation
  headers: { "x-trace-id": "..." },    // merged over client defaults
  query: { /* additional query params */ },
  maxRetries: 0,                       // override the client retry policy
});
```

## Client options

```ts
const client = new Anyframe({
  apiKey: "afm_...",                   // or ANYFRAME_API_KEY
  baseURL: "https://api.anyfrm.com",   // or ANYFRAME_BASE_URL
  timeout: 30_000,                     // default 30s
  maxRetries: 2,                       // default 2; retries on 408/409/429/5xx
  fetch: customFetch,                  // for proxies, observability, etc.
  defaultHeaders: { "x-service": "demo" },
});
```

## Retry behaviour

The SDK retries up to `maxRetries` times (default 2) on these conditions:

- HTTP 408, 409, 429, 500, 502, 503, 504
- Network errors (`TypeError` from `fetch` — DNS, connection refused, etc.)

Backoff is exponential with jitter, capped at 5s per retry. When the server sets `Retry-After` (on 429), the SDK honors that header value (capped at 30s).

Streaming endpoints (`sessions.events`, `agents.streamBuild`) do **not** retry once headers are flushed — retrying would skip events.

## Custom fetch

For runtimes without a global `fetch`, or to inject a proxy / observability wrapper:

```ts
import Anyframe from "anyframe";
import { fetch as undiciFetch } from "undici";

const client = new Anyframe({ fetch: undiciFetch as any });
```

## Publishing

See [PUBLISHING.md](./PUBLISHING.md) for the npm and Bun (JSR) publish flows.

## License

[MIT](./LICENSE) © Tiny HQ
