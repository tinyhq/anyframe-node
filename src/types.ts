/**
 * Public type definitions for AnyFrame API responses.
 *
 * Every response type is structural (an interface), not a class — there
 * is nothing to instantiate client-side. Optional fields use `?` rather
 * than `| undefined` so they can be omitted from object literals.
 *
 * Forward-compatibility: we don't decorate any type with extra-key
 * restrictions, so a server that adds a new field doesn't break older
 * SDK pins. Likewise, enum-valued fields use `Literal` unions rather than
 * TS enums — callers never need to import an enum to compare a string.
 */

// ── Shared primitives ──────────────────────────────────────────────────────

export type SessionStatus =
  | "booting"
  | "running"
  | "snapshotting"
  | "terminated"
  | "error";

export type PreviewStatus =
  | "starting"
  | "running"
  | "paused"
  | "stopped"
  | "error";

export type Runtime = "claude" | "codex";

export type McpTransport = "http" | "sse" | "stdio";

export type SkillSource = "inline" | "git";

export type ConnectorAuthKind =
  | "oauth_dcr"
  | "oauth_preregistered"
  | "bearer_token";

export type CatalogSetupKind =
  | "oauth_dcr"
  | "oauth_preregistered"
  | "bearer_token"
  | "custom_mcp";

export type CatalogTrustLevel = "official" | "verified" | "community";

export type BuildState =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type PermissionPreset = "read_only" | "standard" | "full_trust";

// ── Identity ───────────────────────────────────────────────────────────────

export interface User {
  id: number;
  github_id: number;
  login: string;
  name?: string | null;
  avatar_url?: string | null;
}

// ── Personal API tokens ────────────────────────────────────────────────────

export interface Token {
  id: number;
  name: string;
  prefix: string;
  last4: string;
  created_at: string;
  revoked_at?: string | null;
}

export interface TokenCreated extends Token {
  /** The raw token secret. Returned once at creation — store it now. */
  token: string;
}

// ── Credentials ────────────────────────────────────────────────────────────

export interface CredentialPart {
  set: boolean;
  last4?: string | null;
  updated_at?: string | null;
}

export interface Credentials {
  claude: CredentialPart;
  codex: CredentialPart;
  github: CredentialPart;
}

// ── User-level MCP connectors ──────────────────────────────────────────────

export interface Connector {
  id: number;
  display_name: string;
  mcp_url: string;
  catalog_slug?: string | null;
  default_enabled: boolean;
  transport: McpTransport;
  auth_kind: ConnectorAuthKind;
  secret_last4?: string | null;
  expires_at?: string | null;
  scopes?: string | null;
  is_authorized: boolean;
  last_refresh_attempt_at?: string | null;
  last_refresh_error?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConnectorDiscovery {
  mcp_url: string;
  supports_dcr: boolean;
  suggested_display_name: string;
  authorization_endpoint?: string | null;
  token_endpoint?: string | null;
  scopes_supported: string[];
}

export interface ConnectorAuthorize {
  connector_id: number;
  authorize_url: string;
  state: string;
}

export interface ConnectorCatalogItem {
  slug: string;
  display_name: string;
  category: string;
  description: string;
  mcp_url: string;
  transport: McpTransport;
  setup_kind: CatalogSetupKind;
  publisher: string;
  trust_level: CatalogTrustLevel;
  docs_url: string;
  tags: string[];
  has_logo?: boolean;
  coming_soon?: boolean;
  installed?: boolean;
  connector_id?: number | null;
  is_authorized?: boolean | null;
}

// ── Agents and sub-resources ───────────────────────────────────────────────

export interface AgentSkill {
  id: number;
  name: string;
  source: SkillSource;
  content: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
}

export interface AgentMcp {
  id: number;
  name: string;
  transport: McpTransport;
  config: Record<string, unknown>;
  secret_ref?: string | null;
  enabled: boolean;
  created_at: string;
}

export interface AgentConnectorToggle {
  connector_id: number;
  display_name: string;
  mcp_url: string;
  auth_kind: ConnectorAuthKind;
  enabled: boolean;
  is_authorized: boolean;
}

export interface AgentImage {
  build_key: string;
  modal_image_id: string;
  built_at: string;
}

export interface Agent {
  id: number;
  name: string;
  description?: string | null;
  system_prompt?: string | null;
  runtime: Runtime;
  repo_url?: string | null;
  repo_ref?: string | null;
  install_cmd?: string | null;
  serve_cmd?: string | null;
  preview_ports: number[];
  build_key?: string | null;
  permissions: Record<string, unknown>;
  env_vars: Record<string, string>;
  warmup_image_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentDetail extends Agent {
  skills: AgentSkill[];
  mcps: AgentMcp[];
  connectors: AgentConnectorToggle[];
  image?: AgentImage | null;
}

// ── Builds ─────────────────────────────────────────────────────────────────

export interface BuildQueued {
  agent_id: number;
  build_key?: string | null;
  queued: boolean;
  reason?: string | null;
  build_id?: number | null;
}

export interface BuildStatus {
  agent_id: number;
  build_key?: string | null;
  state?: BuildState | null;
  started_at?: string | null;
  finished_at?: string | null;
  error?: string | null;
  built_image_id?: string | null;
}

export interface Build {
  id: number;
  build_key: string;
  state: BuildState;
  started_at: string;
  finished_at?: string | null;
  error?: string | null;
  log_size?: number | null;
}

export interface LogUrl {
  url: string;
  expires_in: number;
}

// ── Sessions, snapshots, chat, previews ────────────────────────────────────

export interface Preview {
  port: number;
  name: string;
  cmd?: string | null;
  status: PreviewStatus;
  url?: string | null;
  started_at?: number | null;
  exit_code?: number | null;
}

export interface PreviewSpec {
  cmd: string;
  port?: number;
  name?: string;
}

export interface PreviewActionResult {
  ok: boolean;
  port?: number | null;
  name?: string | null;
  url?: string | null;
  status?: PreviewStatus | null;
  restart_pending?: boolean;
  already_open?: boolean;
  error?: string | null;
}

export interface PreviewBatchResult {
  ok: boolean;
  restart_pending?: boolean;
  previews: Preview[];
  error?: string | null;
}

export interface SaveAsBaseResult {
  warmup_image_id: string;
  warmup_inputs_hash: string;
}

export interface Session {
  id: string;
  agent_id: number;
  status: SessionStatus;
  modal_sandbox_id?: string | null;
  sandbox_url?: string | null;
  snapshot_image_id?: string | null;
  idle_timeout_s: number;
  previews: Preview[];
  is_setup_session?: boolean;
  created_at: string;
  last_active: string;
}

export interface Snapshot {
  id: number;
  modal_image_id: string;
  label?: string | null;
  created_at: string;
}

export interface ChatEvent {
  seq: number;
  payload: Record<string, unknown>;
  created_at: string;
}

// ── Attention rail ─────────────────────────────────────────────────────────

export interface AttentionPendingItem {
  kind: "pending";
  session_id: string;
  agent_id: number;
  agent_name: string;
  session_status: SessionStatus;
  seq: number;
  payload: Record<string, unknown>;
  at: string;
  preview?: string | null;
}

export interface AttentionIdleItem {
  kind: "idle";
  session_id: string;
  agent_id: number;
  agent_name: string;
  at: string;
  preview?: string | null;
}

export interface AttentionPausedItem {
  kind: "paused";
  session_id: string;
  agent_id: number;
  agent_name: string;
  snapshot_image_id?: string | null;
  at: string;
}

export type AttentionItem =
  | AttentionPendingItem
  | AttentionIdleItem
  | AttentionPausedItem;
