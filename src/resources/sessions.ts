/**
 * Sessions resource — `/api/sessions`.
 *
 * A session is one live sandbox running an agent. The lifecycle is:
 *
 *     booting → running → snapshotting → terminated
 *
 * `resume` re-boots from a snapshot. This module covers the session
 * record and snapshots, the chat bridge (`sendMessage`, `respond`,
 * `events`, `transcript`), live preview servers (`previews.*`), and
 * setup-session promotion (`saveAsBase`).
 */

import { AnyframeError } from "../core/errors.js";
import type { HTTPClient, RequestOptions } from "../core/http.js";
import { APIResource } from "../core/resource.js";
import type { SSEEvent } from "../core/sse.js";
import { Stream, makeSSEStream } from "../core/stream.js";
import type {
  ChatEvent,
  Preview,
  PreviewActionResult,
  PreviewBatchResult,
  PreviewSpec,
  SaveAsBaseResult,
  Session,
  Snapshot,
} from "../types.js";

const TERMINAL_NON_RUNNING = new Set(["terminated", "error"]);

function prune<T extends object>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out as Partial<T>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface CreateSessionParams {
  agent_id: number;
  /** Snapshot the sandbox after this many idle seconds. Default: 300. */
  idle_timeout_s?: number;
  /** Pass `--dangerously-skip-permissions` to Claude. Strongly discouraged. */
  unsafe?: boolean;
  /** Hydrate from a snapshot instead of booting fresh. */
  resume_from_snapshot_id?: number;
  /** Mark as user-driven setup; unlocks {@link Sessions.saveAsBase}. */
  is_setup_session?: boolean;
}

export interface WaitUntilRunningOptions {
  timeout?: number;
  pollInterval?: number;
  signal?: AbortSignal;
}

export interface TranscriptParams {
  since?: number;
  limit?: number;
}

export interface EventsOptions extends RequestOptions {
  /** Resume from this event id (sent as the `Last-Event-ID` header). */
  lastEventId?: string;
}

// ── Previews sub-resource ──────────────────────────────────────────────────

export interface PreviewTargetParams {
  port?: number;
  name?: string;
}

export class SessionPreviews extends APIResource {
  /** Return every live or stopped preview server for a session. */
  list(sessionId: string, options?: RequestOptions): Promise<Preview[]> {
    return this._client.request({
      method: "POST",
      path: `/api/sessions/${sessionId}/previews`,
      body: { action: "list" },
      options,
    });
  }

  /**
   * Start a preview server inside the sandbox.
   *
   * When `port` is omitted the control plane picks one from the agent's
   * `preview_ports` (or allocates a new one, observable via
   * `restart_pending=true`).
   */
  start(
    sessionId: string,
    params: { cmd: string; port?: number; name?: string },
    options?: RequestOptions,
  ): Promise<PreviewActionResult> {
    return this._client.request({
      method: "POST",
      path: `/api/sessions/${sessionId}/previews`,
      body: prune({
        action: "start",
        cmd: params.cmd,
        port: params.port,
        name: params.name,
      }),
      options,
    });
  }

  /** Stop a running preview. Pass either `port` or `name`. */
  stop(
    sessionId: string,
    params: PreviewTargetParams,
    options?: RequestOptions,
  ): Promise<PreviewActionResult> {
    return this._client.request({
      method: "POST",
      path: `/api/sessions/${sessionId}/previews`,
      body: prune({ action: "stop", port: params.port, name: params.name }),
      options,
    });
  }

  /** Probe one preview's current status. */
  status(
    sessionId: string,
    params: PreviewTargetParams,
    options?: RequestOptions,
  ): Promise<PreviewActionResult> {
    return this._client.request({
      method: "POST",
      path: `/api/sessions/${sessionId}/previews`,
      body: prune({ action: "status", port: params.port, name: params.name }),
      options,
    });
  }

  /** Return the last `tail` lines of a preview's stdout/stderr. */
  logs(
    sessionId: string,
    params: PreviewTargetParams & { tail?: number },
    options?: RequestOptions,
  ): Promise<unknown> {
    return this._client.request({
      method: "POST",
      path: `/api/sessions/${sessionId}/previews`,
      body: prune({
        action: "logs",
        port: params.port,
        name: params.name,
        tail: params.tail ?? 200,
      }),
      options,
    });
  }

  /** Start a batch of previews atomically — restart-once semantics. */
  batchStart(
    sessionId: string,
    previews: PreviewSpec[],
    options?: RequestOptions,
  ): Promise<PreviewBatchResult> {
    return this._client.request({
      method: "POST",
      path: `/api/sessions/${sessionId}/previews`,
      body: {
        action: "batch_start",
        previews: previews.map((s) => prune(s)),
      },
      options,
    });
  }
}

// ── Main sessions resource ─────────────────────────────────────────────────

export class Sessions extends APIResource {
  readonly previews: SessionPreviews;

  constructor(client: HTTPClient) {
    super(client);
    this.previews = new SessionPreviews(client);
  }

  /** Return all sessions owned by the current user, newest first. */
  list(options?: RequestOptions): Promise<Session[]> {
    return this._client.request({
      method: "GET",
      path: "/api/sessions",
      options,
    });
  }

  /**
   * Boot a new sandbox for an agent.
   *
   * The returned session starts in the `booting` state — call
   * {@link waitUntilRunning} to block until it's ready.
   */
  create(params: CreateSessionParams, options?: RequestOptions): Promise<Session> {
    return this._client.request({
      method: "POST",
      path: "/api/sessions",
      body: prune({
        agent_id: params.agent_id,
        idle_timeout_s: params.idle_timeout_s ?? 300,
        unsafe: params.unsafe ?? false,
        resume_from_snapshot_id: params.resume_from_snapshot_id,
        is_setup_session: params.is_setup_session || undefined,
      }),
      options,
    });
  }

  /** Return the current state of a session. */
  get(sessionId: string, options?: RequestOptions): Promise<Session> {
    return this._client.request({
      method: "GET",
      path: `/api/sessions/${sessionId}`,
      options,
    });
  }

  /** Snapshot and terminate a session (idempotent). */
  terminate(sessionId: string, options?: RequestOptions): Promise<Session> {
    return this._client.request({
      method: "POST",
      path: `/api/sessions/${sessionId}/terminate`,
      options,
    });
  }

  /** Hard-delete a session row. Refuses while the sandbox is still live. */
  delete(sessionId: string, options?: RequestOptions): Promise<void> {
    return this._client.request<void>({
      method: "DELETE",
      path: `/api/sessions/${sessionId}`,
      options,
    });
  }

  /** Re-boot a terminated session from its latest snapshot. */
  resume(
    sessionId: string,
    params: { unsafe?: boolean } = {},
    options?: RequestOptions,
  ): Promise<Session> {
    return this._client.request({
      method: "POST",
      path: `/api/sessions/${sessionId}/resume`,
      body: { unsafe: params.unsafe ?? false },
      options,
    });
  }

  /** List snapshots for a session, newest first. */
  snapshots(sessionId: string, options?: RequestOptions): Promise<Snapshot[]> {
    return this._client.request({
      method: "GET",
      path: `/api/sessions/${sessionId}/snapshots`,
      options,
    });
  }

  /**
   * Snapshot a setup session and promote it to the agent's warmup image.
   *
   * Only valid for setup sessions (created with `is_setup_session=true`).
   * Future normal sessions for the same agent warm-hydrate from this
   * snapshot. Overwrites any prior warmup image.
   */
  saveAsBase(sessionId: string, options?: RequestOptions): Promise<SaveAsBaseResult> {
    return this._client.request({
      method: "POST",
      path: `/api/sessions/${sessionId}/save-as-base`,
      options,
    });
  }

  /**
   * Poll {@link get} until the session reaches the `running` state.
   *
   * @throws AnyframeError if the session enters a terminal non-running
   *   state (terminated, error).
   * @throws AnyframeError if the session doesn't run within `timeout` ms.
   */
  async waitUntilRunning(
    sessionId: string,
    opts: WaitUntilRunningOptions = {},
  ): Promise<Session> {
    const timeout = opts.timeout ?? 180_000;
    const pollInterval = opts.pollInterval ?? 1_000;
    const deadline = Date.now() + timeout;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (opts.signal?.aborted) {
        throw new AnyframeError("waitUntilRunning aborted");
      }
      const session = await this.get(sessionId, {
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      if (session.status === "running") return session;
      if (TERMINAL_NON_RUNNING.has(session.status)) {
        throw new AnyframeError(
          `session ${sessionId} ended in state ${session.status}`,
        );
      }
      if (Date.now() >= deadline) {
        throw new AnyframeError(
          `session ${sessionId} did not reach 'running' within ${timeout}ms`,
        );
      }
      await sleep(pollInterval);
    }
  }

  // ── chat ──────────────────────────────────────────────────────────────

  /**
   * Send a user message to the live chat bridge.
   *
   * The control plane proxies the body verbatim to the in-sandbox chat
   * server, so the exact accepted schema lives there. The SDK does not
   * validate the body or the response shape.
   */
  sendMessage(
    sessionId: string,
    body: Record<string, unknown>,
    options?: RequestOptions,
  ): Promise<unknown> {
    return this._client.request({
      method: "POST",
      path: `/api/sessions/${sessionId}/message`,
      body,
      options,
    });
  }

  /** Send a permission-prompt response (approve / reject a tool call). */
  respond(
    sessionId: string,
    body: Record<string, unknown>,
    options?: RequestOptions,
  ): Promise<unknown> {
    return this._client.request({
      method: "POST",
      path: `/api/sessions/${sessionId}/respond`,
      body,
      options,
    });
  }

  /** Return persisted chat events, ordered by `seq` ascending. */
  transcript(
    sessionId: string,
    params: TranscriptParams = {},
    options?: RequestOptions,
  ): Promise<ChatEvent[]> {
    return this._client.request({
      method: "GET",
      path: `/api/sessions/${sessionId}/transcript`,
      options: {
        ...options,
        query: {
          ...options?.query,
          since: params.since ?? 0,
          limit: params.limit ?? 1000,
        },
      },
    });
  }

  /**
   * Stream chat events as SSE frames in real time.
   *
   *     const stream = await client.sessions.events(id);
   *     for await (const event of stream) { ... }
   *     stream.controller.abort();
   *
   * Pass `lastEventId` to resume from a prior checkpoint.
   */
  async events(
    sessionId: string,
    opts: EventsOptions = {},
  ): Promise<Stream<SSEEvent>> {
    const controller = new AbortController();
    if (opts.signal) {
      const onAbort = () => controller.abort();
      if (opts.signal.aborted) controller.abort();
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }
    const headers: Record<string, string> = {
      ...opts.headers,
      Accept: "text/event-stream",
    };
    if (opts.lastEventId) headers["Last-Event-ID"] = opts.lastEventId;

    const response = await this._client.stream(
      {
        method: "GET",
        path: `/api/sessions/${sessionId}/events`,
        options: { ...opts, headers },
      },
      controller,
    );
    if (!response.body) {
      throw new AnyframeError("server returned no body for stream request");
    }
    return makeSSEStream<SSEEvent>(response.body, controller);
  }
}
