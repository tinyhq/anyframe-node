import type { HTTPClient } from "./http.js";

/**
 * Base class for every resource. Holds a reference to the shared
 * {@link HTTPClient}; subclasses compose nested resources in their
 * constructor (see `Agents` for an example).
 */
export class APIResource {
  protected readonly _client: HTTPClient;

  constructor(client: HTTPClient) {
    this._client = client;
  }
}
