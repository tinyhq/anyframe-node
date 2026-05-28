/**
 * Read process env without crashing in browser-like runtimes where
 * `process` is not defined. Returns undefined when the var isn't set.
 */
export function readEnv(name: string): string | undefined {
  if (typeof process !== "undefined" && process?.env) {
    const value = process.env[name];
    return value && value.length > 0 ? value : undefined;
  }
  return undefined;
}

export const ENV_API_KEY = "ANYFRAME_API_KEY";
export const ENV_BASE_URL = "ANYFRAME_BASE_URL";
export const ENV_LOG_LEVEL = "ANYFRAME_LOG_LEVEL";
