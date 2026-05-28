import Anyframe from "../../src/index.js";
import { MockFetch } from "./mock-fetch.js";

export const BASE_URL = "https://api.test.local";

export function makeClient(extra: ConstructorParameters<typeof Anyframe>[0] = {}) {
  const mock = new MockFetch();
  const client = new Anyframe({
    apiKey: "afm_test",
    baseURL: BASE_URL,
    fetch: mock.fetch,
    maxRetries: 0,
    ...extra,
  });
  return { client, mock };
}
