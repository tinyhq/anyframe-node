/**
 * Server-Sent Events frame parser.
 *
 * A frame is a sequence of `field: value` lines terminated by a blank line.
 * `event:`, `data:`, and `id:` fields aggregate into one event; comment
 * lines (lines starting with `:`) act as keepalive heartbeats and are
 * silently dropped. Multi-line `data:` values are joined with `"\n"` per
 * the W3C SSE spec.
 *
 * The parser is implemented as a transform over a `ReadableStream<Uint8Array>`
 * (the shape `fetch().body` gives us) so it works the same in Node 18+,
 * Bun, Deno, and the browser.
 */

export interface SSEEvent {
  /** The `event:` field, or `null` for the default "message" event. */
  readonly event: string | null;
  /** The `data:` field. Multi-line `data:` lines are joined with `"\n"`. */
  readonly data: string;
  /** The `id:` field, used for resumable streams via `Last-Event-ID`. */
  readonly id: string | null;
}

/**
 * Decode `event.data` as JSON, or return `null` if it's empty.
 *
 * Throws on malformed JSON — keepalive comments never reach here because
 * the parser drops them, but a server that sends garbage in `data:` will
 * raise here so callers see the wire-format break instead of silently
 * working with `undefined`.
 */
export function decodeSSEData<T = unknown>(event: SSEEvent): T | null {
  if (!event.data) return null;
  return JSON.parse(event.data) as T;
}

/**
 * Parse one SSE field line into `[name, value]`, or `null` if it's a
 * comment or blank.
 *
 * Per spec: the first whitespace after `:` is the separator; any further
 * whitespace belongs to the value.
 */
function parseField(line: string): [string, string] | null {
  if (line.length === 0) return null;
  if (line.startsWith(":")) return null;
  const idx = line.indexOf(":");
  if (idx === -1) return [line, ""];
  const name = line.slice(0, idx);
  let value = line.slice(idx + 1);
  if (value.startsWith(" ")) value = value.slice(1);
  return [name, value];
}

/**
 * Yield parsed SSE events from an async iterable of UTF-8 line strings.
 *
 * Use {@link iterSSELines} to lift a `ReadableStream<Uint8Array>` into the
 * line iterator this expects.
 */
export async function* parseSSE(lines: AsyncIterable<string>): AsyncIterable<SSEEvent> {
  let event: string | null = null;
  let id: string | null = null;
  const dataLines: string[] = [];

  const flush = (): SSEEvent | null => {
    if (event === null && id === null && dataLines.length === 0) return null;
    const out: SSEEvent = { event, data: dataLines.join("\n"), id };
    event = null;
    id = null;
    dataLines.length = 0;
    return out;
  };

  for await (const line of lines) {
    if (line === "") {
      const flushed = flush();
      if (flushed) yield flushed;
      continue;
    }
    const parsed = parseField(line);
    if (parsed === null) continue;
    const [name, value] = parsed;
    if (name === "event") event = value;
    else if (name === "data") dataLines.push(value);
    else if (name === "id") id = value;
    // Other field names (retry, comments) are ignored.
  }
  const trailing = flush();
  if (trailing) yield trailing;
}

/**
 * Convert a `ReadableStream<Uint8Array>` (e.g. `fetch().body`) into an
 * async iterable of UTF-8 lines, splitting on `\n` and stripping `\r`.
 *
 * Lifecycle:
 *   - When the source stream ends normally, the reader's lock is released.
 *   - If the consumer breaks out of the `for await` loop early (or throws),
 *     the generator's `return()` runs this function's `finally` block. We
 *     cancel the underlying stream there so the upstream `fetch` body is
 *     closed promptly instead of held open until garbage collection.
 */
export async function* iterSSELines(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const decoder = new TextDecoder("utf-8");
  const reader = body.getReader();
  let buffer = "";
  let closedByEof = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        closedByEof = true;
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let newlineIdx = buffer.indexOf("\n");
      while (newlineIdx !== -1) {
        let line = buffer.slice(0, newlineIdx);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        yield line;
        buffer = buffer.slice(newlineIdx + 1);
        newlineIdx = buffer.indexOf("\n");
      }
    }
    // Flush whatever final partial line is left after the stream ends.
    const tail = buffer + decoder.decode();
    if (tail.length > 0) {
      yield tail.endsWith("\r") ? tail.slice(0, -1) : tail;
    }
  } finally {
    if (!closedByEof) {
      // The consumer left early or an error bubbled. Cancel the upstream
      // body so the underlying HTTP socket is freed; releaseLock() alone
      // would leak the connection. Swallow errors — we're already in
      // cleanup and have no caller to surface them to.
      try {
        await reader.cancel();
      } catch {
        /* ignore cancel errors */
      }
    }
    reader.releaseLock();
  }
}
