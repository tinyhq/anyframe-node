import { describe, expect, it } from "vitest";
import type { SSEEvent } from "../src/index.js";
import { decodeSSEData } from "../src/index.js";
import { makeClient } from "./helpers/client.js";
import { sseResponse } from "./helpers/mock-fetch.js";

describe("sessions.events streaming", () => {
  it("yields parsed SSE events", async () => {
    const { client, mock } = makeClient();
    mock.get("/api/sessions/abc/events", () =>
      sseResponse([
        "event: message\ndata: {\"text\":\"hello\"}\nid: 1\n\n",
        "event: message\ndata: {\"text\":\"world\"}\nid: 2\n\n",
      ]),
    );
    const stream = await client.sessions.events("abc");
    const events: SSEEvent[] = [];
    for await (const e of stream) events.push(e);
    expect(events).toHaveLength(2);
    expect(events[0]?.event).toBe("message");
    expect(decodeSSEData<{ text: string }>(events[0]!)?.text).toBe("hello");
    expect(events[1]?.id).toBe("2");
  });

  it("forwards Last-Event-ID header when resuming", async () => {
    const { client, mock } = makeClient();
    mock.get("/api/sessions/abc/events", (req) => {
      expect(req.headers["last-event-id"]).toBe("42");
      return sseResponse([]);
    });
    const stream = await client.sessions.events("abc", { lastEventId: "42" });
    await stream.toArray();
  });

  it("requests text/event-stream Accept header", async () => {
    const { client, mock } = makeClient();
    mock.get("/api/sessions/abc/events", (req) => {
      expect(req.headers["accept"]).toBe("text/event-stream");
      return sseResponse([]);
    });
    const stream = await client.sessions.events("abc");
    await stream.toArray();
  });

  it("throws if iterated twice (single-pass)", async () => {
    const { client, mock } = makeClient();
    mock.get("/api/sessions/abc/events", () => sseResponse(["data: x\n\n"]));
    const stream = await client.sessions.events("abc");
    await stream.toArray();
    await expect(
      (async () => {
        for await (const _ of stream) void _;
      })(),
    ).rejects.toThrow(/already consumed/);
  });
});

describe("agents.streamBuild", () => {
  it("streams build-log events", async () => {
    const { client, mock } = makeClient();
    mock.get("/api/agents/1/builds/2/stream", () =>
      sseResponse([
        "event: log\ndata: building...\n\n",
        "event: state\ndata: succeeded\n\n",
      ]),
    );
    const stream = await client.agents.streamBuild(1, 2);
    const events = await stream.toArray();
    expect(events).toHaveLength(2);
    expect(events[0]?.event).toBe("log");
    expect(events[1]?.data).toBe("succeeded");
  });
});
