/**
 * Subscribe to live chat events for a running session.
 *
 * Run with:
 *   ANYFRAME_API_KEY=afm_... npx tsx examples/streaming.ts <session-id>
 */

import Anyframe, { decodeSSEData } from "../src/index.js";

async function main() {
  const sessionId = process.argv[2];
  if (!sessionId) {
    console.error("usage: streaming.ts <session-id>");
    process.exit(1);
  }

  const client = new Anyframe();
  const stream = await client.sessions.events(sessionId);

  // Stop after 30 seconds so the example terminates on its own.
  setTimeout(() => stream.controller.abort(), 30_000);

  for await (const event of stream) {
    const payload = decodeSSEData(event);
    console.log(`[${event.event ?? "message"}] ${JSON.stringify(payload)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
