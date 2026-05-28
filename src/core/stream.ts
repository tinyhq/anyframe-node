/**
 * `Stream<T>` — a single-pass async iterable over SSE events.
 *
 * Returned by methods like `client.sessions.events()` and
 * `client.agents.streamBuild()`. Usage:
 *
 *     const stream = await client.sessions.events(id);
 *     for await (const event of stream) {
 *       // event is your typed payload
 *     }
 *     stream.controller.abort(); // optional, cancels the underlying request
 *
 * The stream is single-pass: a second iteration throws. The underlying
 * `AbortController` is exposed so callers can cancel from outside the
 * loop (e.g. on a UI unmount or shutdown signal).
 */

import { APIUserAbortError } from "./errors.js";
import type { SSEEvent } from "./sse.js";
import { decodeSSEData, iterSSELines, parseSSE } from "./sse.js";

export class Stream<T> implements AsyncIterable<T> {
  /** Abort the underlying request from outside the iterator. */
  readonly controller: AbortController;

  private readonly iterator: () => AsyncIterableIterator<T>;
  private consumed = false;

  constructor(iteratorFactory: () => AsyncIterableIterator<T>, controller: AbortController) {
    this.iterator = iteratorFactory;
    this.controller = controller;
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    if (this.consumed) {
      throw new Error(
        "Stream already consumed: each Stream<T> can only be iterated once. Call the SDK method again to start a new stream.",
      );
    }
    this.consumed = true;
    return this.iterator();
  }

  /**
   * Drain the stream into an array. Convenient for tests; in production
   * code, prefer `for await` so events stream incrementally.
   */
  async toArray(): Promise<T[]> {
    const out: T[] = [];
    for await (const item of this) out.push(item);
    return out;
  }
}

/**
 * Build a typed Stream<T> from a fetch response body. The factory parses
 * the SSE byte stream, optionally maps each `SSEEvent` to a typed value,
 * and propagates abort errors as {@link APIUserAbortError}.
 */
export function makeSSEStream<T>(
  body: ReadableStream<Uint8Array>,
  controller: AbortController,
  map: (event: SSEEvent) => T | undefined = defaultMap as (e: SSEEvent) => T,
): Stream<T> {
  async function* factory(): AsyncIterableIterator<T> {
    try {
      const lines = iterSSELines(body);
      for await (const event of parseSSE(lines)) {
        const mapped = map(event);
        if (mapped !== undefined) yield mapped;
      }
    } catch (err) {
      if (isAbort(err)) throw new APIUserAbortError();
      throw err;
    }
  }
  return new Stream<T>(factory, controller);
}

function defaultMap<T>(event: SSEEvent): T {
  return event as unknown as T;
}

function isAbort(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  return name === "AbortError";
}

export { decodeSSEData };
export type { SSEEvent };
