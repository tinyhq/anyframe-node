/**
 * Error-handling patterns: catching specific subclasses, reading
 * status / request id, opting out of retries.
 *
 * Run with:
 *   ANYFRAME_API_KEY=afm_... npx tsx examples/error-handling.ts
 */

import Anyframe, { NotFoundError, RateLimitError } from "../src/index.js";

async function main() {
  const client = new Anyframe();

  try {
    await client.agents.get(9_999_999, { maxRetries: 0 });
  } catch (err) {
    if (err instanceof NotFoundError) {
      console.log(`no agent: ${err.message} (request: ${err.requestId ?? "?"})`);
    } else if (err instanceof RateLimitError) {
      console.log(`backing off ${err.retryAfter ?? "?"}s`);
    } else if (err instanceof Anyframe.APIError) {
      console.log(`api error ${err.status}: ${err.message}`);
    } else {
      throw err;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
