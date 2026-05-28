/**
 * Attention rail — `/api/attention`.
 *
 * A curated, newest-first list of items the operator should act on:
 *
 *   - `pending`: an unresolved permission_request or ask_user_question.
 *     The agent is blocked until the operator acts.
 *   - `idle`: a running session whose agent finished its last turn.
 *   - `paused`: a session that paused within the last 24h — a candidate
 *     to resume or archive.
 *
 * The server returns items already ordered (pending → idle → paused;
 * newest first within each group), so callers can render directly.
 */

import { APIResource } from "../core/resource.js";
import type { RequestOptions } from "../core/http.js";
import type { AttentionItem } from "../types.js";

export interface ListAttentionParams {
  /** Maximum items to return. Server clamps to [1, 100]; defaults to 20. */
  limit?: number;
}

export class Attention extends APIResource {
  /** Return up to `limit` items, server-ordered. */
  list(
    params: ListAttentionParams = {},
    options?: RequestOptions,
  ): Promise<AttentionItem[]> {
    return this._client.request<AttentionItem[]>({
      method: "GET",
      path: "/api/attention",
      options: {
        ...options,
        query: { ...options?.query, limit: params.limit ?? 20 },
      },
    });
  }
}
