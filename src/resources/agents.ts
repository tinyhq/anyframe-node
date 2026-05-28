/**
 * Agents resource — `/api/agents` and its nested sub-resources.
 *
 * The top-level {@link Agents} covers CRUD on the agent record. Nested
 * sub-resources hang off the parent so the URL is the source of truth and
 * IDE autocomplete stays flat:
 *
 *   client.agents.skills.list(agentId)
 *   client.agents.mcps.create(agentId, { ... })
 *   client.agents.connectors.set(agentId, connectorId, { enabled: true })
 *
 * Builds are part of the agent surface too — see {@link Agents.build},
 * {@link Agents.waitForBuild}, and {@link Agents.streamBuild}.
 */

import { AnyframeError, APIUserAbortError } from "../core/errors.js";
import type { HTTPClient, RequestOptions } from "../core/http.js";
import { APIResource } from "../core/resource.js";
import type { SSEEvent } from "../core/sse.js";
import type { Stream } from "../core/stream.js";
import { makeSSEStream } from "../core/stream.js";
import { abortableSleep, prune } from "../core/util.js";
import type {
  Agent,
  AgentConnectorToggle,
  AgentDetail,
  AgentMcp,
  AgentSkill,
  Build,
  BuildQueued,
  BuildStatus,
  LogUrl,
  McpTransport,
  Runtime,
  SkillSource,
} from "../types.js";

const TERMINAL_BUILD_STATES = new Set(["succeeded", "failed", "cancelled"]);

// ── Sub-resources ──────────────────────────────────────────────────────────

export interface CreateSkillParams {
  name: string;
  source: SkillSource;
  content: Record<string, unknown>;
  enabled?: boolean;
}

export interface UpdateSkillParams {
  name?: string;
  content?: Record<string, unknown>;
  enabled?: boolean;
}

export class AgentSkills extends APIResource {
  list(agentId: number, options?: RequestOptions): Promise<AgentSkill[]> {
    return this._client.request({
      method: "GET",
      path: `/api/agents/${agentId}/skills`,
      options,
    });
  }

  create(
    agentId: number,
    params: CreateSkillParams,
    options?: RequestOptions,
  ): Promise<AgentSkill> {
    return this._client.request({
      method: "POST",
      path: `/api/agents/${agentId}/skills`,
      body: {
        name: params.name,
        source: params.source,
        content: params.content,
        enabled: params.enabled ?? true,
      },
      options,
    });
  }

  update(
    agentId: number,
    skillId: number,
    params: UpdateSkillParams,
    options?: RequestOptions,
  ): Promise<AgentSkill> {
    return this._client.request({
      method: "PATCH",
      path: `/api/agents/${agentId}/skills/${skillId}`,
      body: prune(params),
      options,
    });
  }

  delete(agentId: number, skillId: number, options?: RequestOptions): Promise<void> {
    return this._client.request<void>({
      method: "DELETE",
      path: `/api/agents/${agentId}/skills/${skillId}`,
      options,
    });
  }
}

export interface CreateMcpParams {
  name: string;
  transport: McpTransport;
  config: Record<string, unknown>;
  secret_ref?: string | null;
  enabled?: boolean;
}

export interface UpdateMcpParams {
  name?: string;
  config?: Record<string, unknown>;
  secret_ref?: string | null;
  enabled?: boolean;
}

export class AgentMcps extends APIResource {
  list(agentId: number, options?: RequestOptions): Promise<AgentMcp[]> {
    return this._client.request({
      method: "GET",
      path: `/api/agents/${agentId}/mcps`,
      options,
    });
  }

  create(agentId: number, params: CreateMcpParams, options?: RequestOptions): Promise<AgentMcp> {
    return this._client.request({
      method: "POST",
      path: `/api/agents/${agentId}/mcps`,
      body: prune({
        name: params.name,
        transport: params.transport,
        config: params.config,
        secret_ref: params.secret_ref,
        enabled: params.enabled ?? true,
      }),
      options,
    });
  }

  update(
    agentId: number,
    mcpId: number,
    params: UpdateMcpParams,
    options?: RequestOptions,
  ): Promise<AgentMcp> {
    return this._client.request({
      method: "PATCH",
      path: `/api/agents/${agentId}/mcps/${mcpId}`,
      body: prune(params),
      options,
    });
  }

  delete(agentId: number, mcpId: number, options?: RequestOptions): Promise<void> {
    return this._client.request<void>({
      method: "DELETE",
      path: `/api/agents/${agentId}/mcps/${mcpId}`,
      options,
    });
  }
}

export class AgentConnectorToggles extends APIResource {
  list(agentId: number, options?: RequestOptions): Promise<AgentConnectorToggle[]> {
    return this._client.request({
      method: "GET",
      path: `/api/agents/${agentId}/connectors`,
      options,
    });
  }

  set(
    agentId: number,
    connectorId: number,
    params: { enabled: boolean },
    options?: RequestOptions,
  ): Promise<AgentConnectorToggle> {
    return this._client.request({
      method: "PUT",
      path: `/api/agents/${agentId}/connectors/${connectorId}`,
      body: { enabled: params.enabled },
      options,
    });
  }
}

// ── Main agents resource ───────────────────────────────────────────────────

export interface CreateAgentParams {
  name: string;
  description?: string;
  system_prompt?: string;
  runtime?: Runtime;
  repo_url?: string;
  repo_ref?: string;
  install_cmd?: string;
  serve_cmd?: string;
  preview_ports?: number[];
  permissions?: Record<string, unknown>;
  env_vars?: Record<string, string>;
}

export type UpdateAgentParams = Partial<CreateAgentParams>;

export interface WaitForBuildOptions {
  /** Maximum milliseconds to wait. Defaults to 10 minutes. */
  timeout?: number;
  /** Milliseconds between polls. Defaults to 2s. */
  pollInterval?: number;
  /** Abort the wait early. */
  signal?: AbortSignal;
}

export class Agents extends APIResource {
  readonly skills: AgentSkills;
  readonly mcps: AgentMcps;
  readonly connectors: AgentConnectorToggles;

  constructor(client: HTTPClient) {
    super(client);
    this.skills = new AgentSkills(client);
    this.mcps = new AgentMcps(client);
    this.connectors = new AgentConnectorToggles(client);
  }

  /** Return all agents owned by the current user. */
  list(options?: RequestOptions): Promise<Agent[]> {
    return this._client.request({
      method: "GET",
      path: "/api/agents",
      options,
    });
  }

  /**
   * Create a new agent.
   *
   * @param params.runtime Which coding-agent runtime drives this agent's
   *   sandboxes (`"claude"` or `"codex"`). Defaults server-side to `"claude"`.
   * @param params.repo_url GitHub `owner/name`. Omit for a general-purpose
   *   agent with no repo bound.
   * @param params.repo_ref Branch / tag / SHA. Defaults server-side to `main`.
   * @param params.env_vars Env vars injected into every session. Keys must
   *   match `[A-Z_][A-Z0-9_]*`; values are encrypted at rest and masked.
   */
  create(params: CreateAgentParams, options?: RequestOptions): Promise<Agent> {
    return this._client.request({
      method: "POST",
      path: "/api/agents",
      body: prune(params),
      options,
    });
  }

  /** Return the detail view including skills, mcps, connectors, image. */
  get(agentId: number, options?: RequestOptions): Promise<AgentDetail> {
    return this._client.request({
      method: "GET",
      path: `/api/agents/${agentId}`,
      options,
    });
  }

  /** Patch any subset of an agent's mutable fields. */
  update(
    agentId: number,
    params: UpdateAgentParams,
    options?: RequestOptions,
  ): Promise<AgentDetail> {
    return this._client.request({
      method: "PATCH",
      path: `/api/agents/${agentId}`,
      body: prune(params),
      options,
    });
  }

  /** Delete an agent. Cascades to skills, mcps, builds, sessions. */
  delete(agentId: number, options?: RequestOptions): Promise<void> {
    return this._client.request<void>({
      method: "DELETE",
      path: `/api/agents/${agentId}`,
      options,
    });
  }

  // ── builds ────────────────────────────────────────────────────────────

  /**
   * Trigger an image build for the agent's current repo config.
   *
   * @param params.force If true, rebuild even when a cached image exists.
   */
  build(
    agentId: number,
    params: { force?: boolean } = {},
    options?: RequestOptions,
  ): Promise<BuildQueued> {
    return this._client.request({
      method: "POST",
      path: `/api/agents/${agentId}/build`,
      body: { force: params.force ?? false },
      options,
    });
  }

  /** Return the current build status (latest run + cached image, if any). */
  buildStatus(agentId: number, options?: RequestOptions): Promise<BuildStatus> {
    return this._client.request({
      method: "GET",
      path: `/api/agents/${agentId}/build/status`,
      options,
    });
  }

  /** Return the most recent build runs for this agent, newest first. */
  builds(
    agentId: number,
    params: { limit?: number } = {},
    options?: RequestOptions,
  ): Promise<Build[]> {
    return this._client.request({
      method: "GET",
      path: `/api/agents/${agentId}/builds`,
      options: {
        ...options,
        query: { ...options?.query, limit: params.limit ?? 20 },
      },
    });
  }

  /** Return a signed URL for the build's archived log file. */
  buildLogUrl(agentId: number, buildId: number, options?: RequestOptions): Promise<LogUrl> {
    return this._client.request({
      method: "GET",
      path: `/api/agents/${agentId}/builds/${buildId}/log_url`,
      options,
    });
  }

  /**
   * Stream live build-log events as SSE frames.
   *
   * Yields parsed SSE events; use `JSON.parse(event.data)` to decode the
   * payload, or the `decodeSSEData` helper.
   */
  async streamBuild(
    agentId: number,
    buildId: number,
    options?: RequestOptions,
  ): Promise<Stream<SSEEvent>> {
    const controller = new AbortController();
    if (options?.signal) {
      const onAbort = () => controller.abort();
      if (options.signal.aborted) controller.abort();
      else options.signal.addEventListener("abort", onAbort, { once: true });
    }
    const response = await this._client.stream(
      {
        method: "GET",
        path: `/api/agents/${agentId}/builds/${buildId}/stream`,
        options,
      },
      controller,
    );
    if (!response.body) {
      throw new AnyframeError("server returned no body for stream request");
    }
    return makeSSEStream<SSEEvent>(response.body, controller);
  }

  /**
   * Poll {@link buildStatus} until the build reaches a terminal state.
   *
   * Resolves with the terminal status on `succeeded` or `cancelled`.
   * Rejects with {@link AnyframeError} on `failed` and `TimeoutError`-like
   * behavior on timeout.
   */
  async waitForBuild(agentId: number, options: WaitForBuildOptions = {}): Promise<BuildStatus> {
    const timeout = options.timeout ?? 600_000;
    const pollInterval = options.pollInterval ?? 2_000;
    const signal = options.signal;
    const deadline = Date.now() + timeout;
    // Loop until terminal state, timeout, or abort.
    while (true) {
      if (signal?.aborted) throw new APIUserAbortError();
      const status = await this.buildStatus(agentId, signal ? { signal } : {});
      if (status.state && TERMINAL_BUILD_STATES.has(status.state)) {
        if (status.state === "failed") {
          throw new AnyframeError(`build failed: ${status.error ?? "unknown error"}`);
        }
        return status;
      }
      if (Date.now() >= deadline) {
        throw new AnyframeError(`build for agent ${agentId} did not finish within ${timeout}ms`);
      }
      // Abort-aware sleep so aborts propagate within ms, not pollInterval.
      await abortableSleep(pollInterval, signal);
    }
  }
}
