/**
 * Basic agent + session lifecycle.
 *
 * Run with:
 *   ANYFRAME_API_KEY=afm_... npx tsx examples/basic.ts
 */

import Anyframe from "../src/index.js";

async function main() {
  const client = new Anyframe();

  const me = await client.me();
  console.log(`hi, ${me.login}`);

  const agent = await client.agents.create({
    name: `demo-${Date.now()}`,
    repo_url: "tinyhq/box",
    install_cmd: "bun install",
  });
  console.log(`created agent ${agent.id}`);

  await client.agents.build(agent.id);
  await client.agents.waitForBuild(agent.id);
  console.log("build complete");

  const session = await client.sessions.create({ agent_id: agent.id });
  const ready = await client.sessions.waitUntilRunning(session.id);
  console.log(`session ${ready.id} -> ${ready.status} at ${ready.sandbox_url}`);

  await client.sessions.terminate(ready.id);
  await client.agents.delete(agent.id);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
