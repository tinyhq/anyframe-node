/**
 * Tiny internal utilities shared across resources.
 *
 * Kept in one place so multiple resources don't drift apart. Nothing
 * here is part of the public API.
 */

import { APIUserAbortError } from "./errors.js";

/**
 * Drop keys whose value is `null` or `undefined`. The server distinguishes
 * "omit this field" from "set it to null", so callers must opt in to null
 * by passing it through a different path — never via `prune`.
 */
export function prune<T extends object>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out as Partial<T>;
}

/** Sleep for `ms` milliseconds. Pure-time, ignores aborts. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sleep for `ms` milliseconds, rejecting early with {@link APIUserAbortError}
 * if `signal` aborts. Use this inside polling loops so an abort propagates
 * within milliseconds instead of waiting for the next tick.
 */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return sleep(ms);
  if (signal.aborted) return Promise.reject(new APIUserAbortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new APIUserAbortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
