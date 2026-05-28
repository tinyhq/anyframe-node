# anyframe

[![npm version](https://img.shields.io/npm/v/anyframe.svg)](https://www.npmjs.com/package/anyframe)

The official JavaScript / TypeScript SDK for the [AnyFrame](https://anyfrm.com) control plane - point an agent at a repo, get a sandbox running Claude Code inside.

```
                                ┌──────────────────────────────┐
                                │  Agent  (repo, system prompt)│
                                │   ├── Skills                 │
                                │   ├── MCPs                   │
                                │   └── Connector toggles      │
   ┌──────────┐   anyframe SDK  └─────────────┬────────────────┘
   │   you    │ ───────────────────▶          │  build
   │ (ts/js)  │                               ▼
   └──────────┘   ┌──────────────────────────────────────────┐
                  │ Session (sandbox · chat · serve)         │
                  └──────────────────────────────────────────┘
```

User-level **Connectors** plug MCP servers (Linear, Sentry, …) in once and toggle them per-agent. **Skills** + **MCPs** ride with the agent into every session it boots.

## Install

```bash
npm install anyframe
# bun add anyframe   ·   pnpm add anyframe   ·   yarn add anyframe
```

Runs on Node 18+, Bun, Deno, Cloudflare Workers, and the browser - anywhere with a global `fetch`.

## Quickstart

```ts
import Anyframe from "anyframe";

const af = new Anyframe();          // reads ANYFRAME_API_KEY + ANYFRAME_BASE_URL

const agent = await af.agents.create({ name: "demo", repo_url: "tinyhq/box", install_cmd: "bun install" });
await af.agents.build(agent.id);
await af.agents.waitForBuild(agent.id);

const session = await af.sessions.create({ agent_id: agent.id });
const ready = await af.sessions.waitUntilRunning(session.id);
console.log(ready.sandbox_url);
```

## Authentication

`.env` in your project root, or shell environment:

```bash
ANYFRAME_API_KEY=afm_...
ANYFRAME_BASE_URL=https://api.anyfrm.com   # optional
ANYFRAME_LOG_LEVEL=debug                   # set debug for request tracing
```

Mint a key in the dashboard, or from a logged-in session with `af.tokens.create({ name: "..." })`.

## Agents

Agents are the unit of "what runs in the sandbox" - a repo, a system prompt, a permissions config.

```ts
await af.agents.list();
await af.agents.create({
  name: "demo",
  repo_url: "owner/name",
  install_cmd: "bun install",
  runtime: "claude",                   // or "codex"
  env_vars: { DATABASE_URL: "..." },   // injected into every session
});
await af.agents.get(agentId);                  // AgentDetail: includes skills, mcps, connectors, image
await af.agents.update(agentId, { name: "renamed" });
await af.agents.delete(agentId);
```

## Skills

Skills are bundles of instructions the agent loads at boot (think: "deploy this app", "review this PR").

```ts
await af.agents.skills.list(agentId);
await af.agents.skills.create(agentId, { name: "deploy", source: "inline", content: { /* ... */ } });
await af.agents.skills.update(agentId, skillId, { enabled: false });
await af.agents.skills.delete(agentId, skillId);
```

## MCPs

MCPs configured inline on the agent - for one-off MCP servers that aren't worth setting up as a reusable connector.

```ts
await af.agents.mcps.list(agentId);
await af.agents.mcps.create(agentId, { name: "git", transport: "http", config: { url: "..." } });
await af.agents.mcps.update(agentId, mcpId, { enabled: false });
await af.agents.mcps.delete(agentId, mcpId);
```

## Connectors

User-level MCP connectors - configure once, then opt in per-agent via the connector-toggle API below.

```ts
await af.connectors.list();
const discovery = await af.connectors.discover("https://mcp.linear.app/sse");
const authorize = await af.connectors.createOauth({ mcp_url: discovery.mcp_url, display_name: "Linear" });
// open authorize.authorize_url in a browser; callback completes server-side
await af.connectors.createBearer({ mcp_url: "...", display_name: "...", token: "..." });
await af.connectors.reauthorize(connectorId);
await af.connectors.delete(connectorId);
```

### Catalog

The control plane ships with a curated catalog (Linear, Sentry, Google, …). Install by slug instead of pasting URLs.

```ts
const catalog = await af.connectors.listCatalog();              // ConnectorCatalogItem[]
await af.connectors.installCatalogOauth("linear");              // → authorize URL (DCR or pre-registered)
await af.connectors.installCatalogBearer("sentry", { token: "..." });
```

Per-agent toggle (controls which connectors apply to one agent):

```ts
await af.agents.connectors.list(agentId);
await af.agents.connectors.set(agentId, connectorId, { enabled: true });
```

## Builds

Builds bake an agent's repo + dependencies into a cached sandbox image - required before a session can boot it.

```ts
await af.agents.build(agentId, { force: false });               // queue a build
await af.agents.buildStatus(agentId);                           // current state + cached image id
await af.agents.builds(agentId, { limit: 20 });                 // history
await af.agents.buildLogUrl(agentId, buildId);                  // signed R2 URL for the archived log
const stream = await af.agents.streamBuild(agentId, buildId);
for await (const event of stream) console.log(event.event, event.data);   // live SSE log frames
await af.agents.waitForBuild(agentId);                          // blocks until succeeded / fails
```

## Sessions

A session is one live sandbox. Lifecycle is `booting → running → snapshotting → terminated`; `resume` brings a terminated session back from its snapshot.

```ts
const session = await af.sessions.create({ agent_id: agent.id, idle_timeout_s: 300 });
await af.sessions.waitUntilRunning(session.id);
await af.sessions.list();
await af.sessions.get(session.id);
await af.sessions.snapshots(session.id);
await af.sessions.terminate(session.id);
await af.sessions.resume(session.id);
await af.sessions.delete(session.id);                            // hard delete; requires terminated
```

### Setup sessions + save-as-base

Setup sessions are user-driven sandboxes you use to seed an agent's filesystem (clone, install, warm caches), then promote to that agent's warmup image. Future normal sessions then hydrate from the promoted snapshot.

```ts
const session = await af.sessions.create({ agent_id: agent.id, is_setup_session: true });
await af.sessions.waitUntilRunning(session.id);
// ... do interactive setup ...
const result = await af.sessions.saveAsBase(session.id);          // SaveAsBaseResult
console.log(result.warmup_image_id);
```

## Chat

Talk to the running agent. `sendMessage` and `respond` proxy verbatim to the in-sandbox chat server; `events` is the live SSE stream; `transcript` reads persisted history.

```ts
await af.sessions.sendMessage(session.id, { text: "deploy main to staging" });
const stream = await af.sessions.events(session.id, { lastEventId: undefined });
for await (const event of stream) console.log(event.id, event.event, event.data);
await af.sessions.transcript(session.id, { since: 0, limit: 1000 });
await af.sessions.respond(session.id, { decision: "approve", tool_use_id: "..." });
```

Cancel a stream from outside the loop with `stream.controller.abort()`.

## Previews (in-sandbox dev servers)

Launch dev servers inside the sandbox and tunnel their ports out. Multiple previews can run per session - name them or address them by port.

```ts
await af.sessions.previews.start(session.id, { cmd: "bun dev", port: 3000, name: "web" });
await af.sessions.previews.status(session.id, { name: "web" });   // PreviewActionResult
await af.sessions.previews.list(session.id);                       // Preview[]
await af.sessions.previews.logs(session.id, { name: "web", tail: 200 });
await af.sessions.previews.stop(session.id, { name: "web" });

// Atomic batch - restarts at most once when allocating new ports
await af.sessions.previews.batchStart(session.id, [
  { cmd: "bun dev", port: 3000, name: "web" },
  { cmd: "bun api", port: 4000, name: "api" },
]);
```

## Attention rail

A curated, newest-first list of things the operator should act on - pending permission prompts, idle running sessions, and recently-paused sessions.

```ts
for (const item of await af.attention.list({ limit: 20 })) {
  console.log(item.kind, item.agent_name);
}
```

Each row is one of `AttentionPendingItem`, `AttentionIdleItem`, or `AttentionPausedItem`. Discriminate on `item.kind`.

## Credentials

The control plane needs a runtime credential - Claude OAuth (default Claude runtime) or an OpenAI Codex token (Codex runtime) - plus a GitHub PAT for private repos. It only ever shows you redacted views.

```ts
await af.credentials.get();                       // set flag + last4 for claude / codex / github
await af.credentials.setClaude("sk-...");
await af.credentials.setCodex("sk-...");
await af.credentials.setGithub("ghp_...");
await af.credentials.clearClaude();
await af.credentials.clearCodex();
await af.credentials.clearGithub();
```

## Tokens

Manage the API keys this SDK uses. `create` returns the raw token exactly once - store it now.

```ts
await af.tokens.list();
const created = await af.tokens.create({ name: "ci-bot" });
console.log(created.token);                       // afm_...  one-time
await af.tokens.revoke(created.id);
```

## Errors

All errors derive from `AnyframeError`, so one `catch` catches everything.

```ts
import { AnyframeError, APIError, AuthenticationError, NotFoundError,
         ConflictError, ValidationError, RateLimitError, ServerError } from "anyframe";

AnyframeError                        // base
├── APIError                         // any non-2xx (status, message, body, requestId)
│   ├── AuthenticationError          // 401 - bad / missing API key
│   ├── PermissionDeniedError        // 403
│   ├── NotFoundError                // 404
│   ├── ConflictError                // 409 - e.g. delete on a running session
│   ├── ValidationError              // 400/422 (carries field-level details)
│   ├── RateLimitError               // 429 (exposes retryAfter)
│   ├── ServerError                  // 5xx
│   ├── APIConnectionError           // network failure
│   └── APIConnectionTimeoutError    // exceeded the per-request timeout
└── APIUserAbortError                // AbortSignal fired
```

## Client options

```ts
const af = new Anyframe({
  apiKey: "afm_...",                   // or ANYFRAME_API_KEY
  baseURL: "https://api.anyfrm.com",   // or ANYFRAME_BASE_URL
  timeout: 30_000,                     // default 30s
  maxRetries: 2,                       // retries on 408 / 409 / 429 / 5xx with backoff
  fetch: customFetch,                  // inject a proxy / observability wrapper
  defaultHeaders: { "x-service": "demo" },
});
```

Every method accepts a final `RequestOptions` argument: `{ timeout, signal, headers, query, maxRetries }`.

## CommonJS

Both ESM and CJS are shipped. CJS users should use **named imports**:

```js
const { Anyframe, NotFoundError } = require("anyframe");
```

## License

MIT.

---

Docs: [docs.anyfrm.com](https://docs.anyfrm.com) · Found a bug or have a question? [Join us on Discord](https://discord.gg/UpkEW6JjpU).
