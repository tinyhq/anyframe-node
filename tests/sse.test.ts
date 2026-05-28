import { describe, expect, it } from "vitest";
import type { SSEEvent } from "../src/index.js";
import { decodeSSEData } from "../src/index.js";
import { iterSSELines, parseSSE } from "../src/core/sse.js";

async function* fromArray(items: string[]): AsyncIterable<string> {
  for (const item of items) yield item;
}

async function collect(events: AsyncIterable<SSEEvent>): Promise<SSEEvent[]> {
  const out: SSEEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

describe("parseSSE", () => {
  it("parses one event with event/data/id", async () => {
    const events = await collect(parseSSE(fromArray(["event: line", "data: hello", "id: 1", ""])));
    expect(events).toEqual([{ event: "line", data: "hello", id: "1" }]);
  });

  it("falls back to event=null when omitted", async () => {
    const events = await collect(parseSSE(fromArray(["data: hi", ""])));
    expect(events).toEqual([{ event: null, data: "hi", id: null }]);
  });

  it("joins multi-line data with newline", async () => {
    const events = await collect(
      parseSSE(fromArray(["data: line1", "data: line2", "data: line3", ""])),
    );
    expect(events).toEqual([{ event: null, data: "line1\nline2\nline3", id: null }]);
  });

  it("skips comment / keepalive lines", async () => {
    const events = await collect(parseSSE(fromArray([": keepalive", "", "data: real", ""])));
    expect(events).toEqual([{ event: null, data: "real", id: null }]);
  });

  it("emits multiple frames in order", async () => {
    const events = await collect(
      parseSSE(fromArray(["event: a", "data: 1", "", "event: b", "data: 2", "id: 7", ""])),
    );
    expect(events).toEqual([
      { event: "a", data: "1", id: null },
      { event: "b", data: "2", id: "7" },
    ]);
  });

  it("drops a blank-only frame", async () => {
    const events = await collect(parseSSE(fromArray(["", "", "data: x", ""])));
    expect(events).toEqual([{ event: null, data: "x", id: null }]);
  });

  it("emits a trailing frame that has no terminating blank line", async () => {
    const events = await collect(parseSSE(fromArray(["data: tail"])));
    expect(events).toEqual([{ event: null, data: "tail", id: null }]);
  });

  it("strips one leading space from field values per spec", async () => {
    const events = await collect(parseSSE(fromArray(["data:  two-spaces", ""])));
    expect(events).toEqual([{ event: null, data: " two-spaces", id: null }]);
  });
});

describe("decodeSSEData", () => {
  it("parses JSON data", () => {
    expect(decodeSSEData<{ ok: boolean }>({ event: "x", data: '{"ok":true}', id: null })).toEqual({
      ok: true,
    });
  });

  it("returns null for empty data", () => {
    expect(decodeSSEData({ event: "x", data: "", id: null })).toBeNull();
  });
});

describe("iterSSELines", () => {
  it("splits chunked UTF-8 bytes into lines", async () => {
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode("event: foo\nda"));
        controller.enqueue(enc.encode("ta: hello\n\n"));
        controller.close();
      },
    });
    const lines: string[] = [];
    for await (const line of iterSSELines(stream)) lines.push(line);
    expect(lines).toEqual(["event: foo", "data: hello", ""]);
  });

  it("strips \\r from \\r\\n line endings", async () => {
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode("data: x\r\n\r\n"));
        controller.close();
      },
    });
    const lines: string[] = [];
    for await (const line of iterSSELines(stream)) lines.push(line);
    expect(lines).toEqual(["data: x", ""]);
  });
});
