/**
 * User-level MCP connectors — `/api/connectors`.
 *
 * A connector points an agent at an MCP server (Linear, Sentry, a custom
 * HTTP server, …). Setup happens once at the user level; each agent then
 * opts in via {@link AgentConnectorToggles}.
 *
 * Two auth flows are supported:
 *
 *   - **OAuth DCR**: {@link Connectors.discover} to probe the MCP server,
 *     then {@link Connectors.createOauth} to register a dynamic client and
 *     get an `authorize_url` the user opens in a browser.
 *   - **Bearer paste**: skip discovery and call {@link Connectors.createBearer}
 *     with a pre-issued token, for MCP servers that don't speak OAuth.
 *
 * There is also a curated **catalog** of connectors (Linear, Sentry, …).
 * Install by slug with {@link Connectors.installCatalogOauth} /
 * {@link Connectors.installCatalogBearer}.
 */

import { APIResource } from "../core/resource.js";
import type { RequestOptions } from "../core/http.js";
import type {
  Connector,
  ConnectorAuthorize,
  ConnectorCatalogItem,
  ConnectorDiscovery,
} from "../types.js";

export interface CreateOAuthConnectorParams {
  mcp_url: string;
  display_name: string;
  default_enabled?: boolean;
}

export interface CreateBearerConnectorParams {
  mcp_url: string;
  display_name: string;
  token: string;
  default_enabled?: boolean;
}

export class Connectors extends APIResource {
  /** Return every connector the user has set up. */
  list(options?: RequestOptions): Promise<Connector[]> {
    return this._client.request<Connector[]>({
      method: "GET",
      path: "/api/connectors",
      options,
    });
  }

  /** Return the curated catalog of installable connectors. */
  listCatalog(options?: RequestOptions): Promise<ConnectorCatalogItem[]> {
    return this._client.request<ConnectorCatalogItem[]>({
      method: "GET",
      path: "/api/connectors/catalog",
      options,
    });
  }

  /**
   * Probe an MCP URL for OAuth metadata and DCR support.
   *
   * Use the returned `supports_dcr` flag to decide whether to call
   * {@link createOauth} (DCR available) or {@link createBearer} (paste a
   * pre-issued token).
   */
  discover(mcpUrl: string, options?: RequestOptions): Promise<ConnectorDiscovery> {
    return this._client.request<ConnectorDiscovery>({
      method: "POST",
      path: "/api/connectors/discover",
      body: { mcp_url: mcpUrl },
      options,
    });
  }

  /**
   * Register a new OAuth-flow connector and return an `authorize_url`.
   *
   * Open the URL in a browser; on success the server stores tokens and
   * redirects back to the dashboard.
   */
  createOauth(
    params: CreateOAuthConnectorParams,
    options?: RequestOptions,
  ): Promise<ConnectorAuthorize> {
    return this._client.request<ConnectorAuthorize>({
      method: "POST",
      path: "/api/connectors/oauth",
      body: {
        mcp_url: params.mcp_url,
        display_name: params.display_name,
        default_enabled: params.default_enabled ?? true,
      },
      options,
    });
  }

  /** Create a bearer-token connector with a pre-issued token. */
  createBearer(
    params: CreateBearerConnectorParams,
    options?: RequestOptions,
  ): Promise<Connector> {
    return this._client.request<Connector>({
      method: "POST",
      path: "/api/connectors/bearer",
      body: {
        mcp_url: params.mcp_url,
        display_name: params.display_name,
        token: params.token,
        default_enabled: params.default_enabled ?? true,
      },
      options,
    });
  }

  /**
   * Install a catalog connector that uses OAuth (DCR or pre-registered).
   * Returns an `authorize_url` to open in a browser.
   */
  installCatalogOauth(slug: string, options?: RequestOptions): Promise<ConnectorAuthorize> {
    return this._client.request<ConnectorAuthorize>({
      method: "POST",
      path: `/api/connectors/catalog/${slug}/oauth`,
      options,
    });
  }

  /** Install a catalog connector that authenticates with a bearer token. */
  installCatalogBearer(
    slug: string,
    params: { token: string },
    options?: RequestOptions,
  ): Promise<Connector> {
    return this._client.request<Connector>({
      method: "POST",
      path: `/api/connectors/catalog/${slug}/bearer`,
      body: { token: params.token },
      options,
    });
  }

  /**
   * Rerun the OAuth dance on an existing connector row.
   *
   * Useful when refresh tokens expire or the provider revokes the app —
   * the connector row, display name, and per-agent toggles are preserved.
   */
  reauthorize(connectorId: number, options?: RequestOptions): Promise<ConnectorAuthorize> {
    return this._client.request<ConnectorAuthorize>({
      method: "POST",
      path: `/api/connectors/${connectorId}/reauthorize`,
      options,
    });
  }

  /** Delete a connector. Best-effort RFC 7592 revocation runs server-side. */
  delete(connectorId: number, options?: RequestOptions): Promise<void> {
    return this._client.request<void>({
      method: "DELETE",
      path: `/api/connectors/${connectorId}`,
      options,
    });
  }
}
