/**
 * Personal API tokens — `/api/tokens`.
 *
 * API tokens authenticate this SDK. Mint one with {@link Tokens.create}
 * (the raw secret is returned exactly once), list them with
 * {@link Tokens.list}, revoke one with {@link Tokens.revoke}. List
 * responses are redacted to `prefix` + `last4` — never the secret.
 */

import { APIResource } from "../core/resource.js";
import type { RequestOptions } from "../core/http.js";
import type { Token, TokenCreated } from "../types.js";

export interface CreateTokenParams {
  /** A human label for the token (visible in the dashboard). */
  name: string;
}

export class Tokens extends APIResource {
  /** Return all non-revoked tokens for the current user. */
  list(options?: RequestOptions): Promise<Token[]> {
    return this._client.request<Token[]>({
      method: "GET",
      path: "/api/tokens",
      options,
    });
  }

  /**
   * Mint a new API token.
   *
   * The raw secret is on `.token` of the returned object — it cannot be
   * retrieved later, so store it now.
   */
  create(params: CreateTokenParams, options?: RequestOptions): Promise<TokenCreated> {
    return this._client.request<TokenCreated>({
      method: "POST",
      path: "/api/tokens",
      body: { name: params.name },
      options,
    });
  }

  /** Soft-delete a token. Subsequent requests using it return 401. */
  revoke(tokenId: number, options?: RequestOptions): Promise<void> {
    return this._client.request<void>({
      method: "DELETE",
      path: `/api/tokens/${tokenId}`,
      options,
    });
  }
}
