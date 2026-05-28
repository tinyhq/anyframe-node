/**
 * Per-user Claude / Codex / GitHub credentials — `/api/credentials`.
 *
 * The control plane needs at least one runtime credential (Claude OAuth
 * token or Codex token) to run agents, and a GitHub PAT for private repo
 * cloning. The server never returns raw tokens — {@link Credentials.get}
 * returns a redacted view (`set` flag, `last4`, `updated_at`).
 */

import { APIResource } from "../core/resource.js";
import type { RequestOptions } from "../core/http.js";
import type { Credentials as CredentialsModel } from "../types.js";

export class Credentials extends APIResource {
  /** Return the redacted credential metadata for the current user. */
  get(options?: RequestOptions): Promise<CredentialsModel> {
    return this._client.request<CredentialsModel>({
      method: "GET",
      path: "/api/credentials",
      options,
    });
  }

  /** Store a Claude OAuth token. Agents on the Claude runtime require this. */
  setClaude(token: string, options?: RequestOptions): Promise<void> {
    return this._client.request<void>({
      method: "PUT",
      path: "/api/credentials/claude",
      body: { token },
      options,
    });
  }

  /** Store an OpenAI Codex token. Required for agents on the Codex runtime. */
  setCodex(token: string, options?: RequestOptions): Promise<void> {
    return this._client.request<void>({
      method: "PUT",
      path: "/api/credentials/codex",
      body: { token },
      options,
    });
  }

  /** Store a GitHub PAT. Required for cloning private repos / builds. */
  setGithub(token: string, options?: RequestOptions): Promise<void> {
    return this._client.request<void>({
      method: "PUT",
      path: "/api/credentials/github",
      body: { token },
      options,
    });
  }

  /** Delete the stored Claude token. */
  clearClaude(options?: RequestOptions): Promise<void> {
    return this._client.request<void>({
      method: "DELETE",
      path: "/api/credentials/claude",
      options,
    });
  }

  /** Delete the stored Codex token. */
  clearCodex(options?: RequestOptions): Promise<void> {
    return this._client.request<void>({
      method: "DELETE",
      path: "/api/credentials/codex",
      options,
    });
  }

  /** Delete the stored GitHub token. */
  clearGithub(options?: RequestOptions): Promise<void> {
    return this._client.request<void>({
      method: "DELETE",
      path: "/api/credentials/github",
      options,
    });
  }
}
