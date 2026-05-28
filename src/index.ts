/**
 * AnyFrame — official JavaScript / TypeScript SDK for the AnyFrame
 * control plane.
 *
 *     import Anyframe from "anyframe";
 *
 *     const client = new Anyframe();
 *     const agent = await client.agents.create({ name: "demo" });
 *     const session = await client.sessions.create({ agent_id: agent.id });
 *     await client.sessions.waitUntilRunning(session.id);
 *
 *     const stream = await client.sessions.events(session.id);
 *     for await (const event of stream) {
 *       console.log(event.event, event.data);
 *     }
 */

import { Anyframe as AnyframeClient } from "./client.js";
import {
  AnyframeError,
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  ConflictError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  ServerError,
  ValidationError,
} from "./core/errors.js";

export { DEFAULT_BASE_URL, DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS } from "./client.js";
export type { AnyframeOptions } from "./client.js";
export { VERSION } from "./version.js";

// Errors — exposed as named exports. Also attached as static properties
// on the default export so users can write `Anyframe.APIError` Stainless-style.
export {
  AnyframeError,
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  ConflictError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  ServerError,
  ValidationError,
};

// Streaming
export { Stream, decodeSSEData } from "./core/stream.js";
export type { SSEEvent } from "./core/sse.js";

// Resource classes — exported so users can reference `Agents` in type
// positions without going through `Anyframe["agents"]`.
export {
  AgentConnectorToggles,
  AgentMcps,
  AgentSkills,
  Agents,
} from "./resources/agents.js";
export type {
  CreateAgentParams,
  CreateMcpParams,
  CreateSkillParams,
  UpdateAgentParams,
  UpdateMcpParams,
  UpdateSkillParams,
  WaitForBuildOptions,
} from "./resources/agents.js";
export { Attention } from "./resources/attention.js";
export type { ListAttentionParams } from "./resources/attention.js";
export { Connectors } from "./resources/connectors.js";
export type {
  CreateBearerConnectorParams,
  CreateOAuthConnectorParams,
} from "./resources/connectors.js";
export { Credentials } from "./resources/credentials.js";
export { SessionPreviews, Sessions } from "./resources/sessions.js";
export type {
  CreateSessionParams,
  EventsOptions,
  PreviewTargetParams,
  TranscriptParams,
  WaitUntilRunningOptions,
} from "./resources/sessions.js";
export { Tokens } from "./resources/tokens.js";
export type { CreateTokenParams } from "./resources/tokens.js";

// Per-call request options
export type { FetchLike, RequestOptions } from "./core/http.js";

// Public response types
export type {
  Agent,
  AgentConnectorToggle,
  AgentDetail,
  AgentImage,
  AgentMcp,
  AgentSkill,
  AttentionIdleItem,
  AttentionItem,
  AttentionPausedItem,
  AttentionPendingItem,
  Build,
  BuildQueued,
  BuildState,
  BuildStatus,
  CatalogSetupKind,
  CatalogTrustLevel,
  ChatEvent,
  Connector,
  ConnectorAuthKind,
  ConnectorAuthorize,
  ConnectorCatalogItem,
  ConnectorDiscovery,
  CredentialPart,
  Credentials as CredentialsResponse,
  LogUrl,
  McpTransport,
  PermissionPreset,
  Preview,
  PreviewActionResult,
  PreviewBatchResult,
  PreviewSpec,
  PreviewStatus,
  Runtime,
  SaveAsBaseResult,
  Session,
  SessionStatus,
  SkillSource,
  Snapshot,
  Token,
  TokenCreated,
  User,
} from "./types.js";

const ErrorStatics = {
  AnyframeError,
  APIError,
  APIConnectionError,
  APIConnectionTimeoutError,
  APIUserAbortError,
  AuthenticationError,
  PermissionDeniedError,
  NotFoundError,
  ConflictError,
  ValidationError,
  RateLimitError,
  ServerError,
};

/**
 * The AnyFrame client. Also exposes every error class as a static
 * property (e.g. `Anyframe.APIError`) for parity with the OpenAI SDK.
 */
export const Anyframe = Object.assign(AnyframeClient, ErrorStatics);

export type Anyframe = AnyframeClient;

export default Anyframe;
