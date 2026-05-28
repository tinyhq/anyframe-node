/**
 * Tiny logger that respects `ANYFRAME_LOG_LEVEL`.
 *
 * Default level is `warn` so the SDK is silent by default. Set
 * `ANYFRAME_LOG_LEVEL=debug` to get one line per request.
 */

import { ENV_LOG_LEVEL, readEnv } from "./env.js";

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

function resolveLevel(): LogLevel {
  const raw = readEnv(ENV_LOG_LEVEL)?.toLowerCase();
  if (raw && raw in ORDER) return raw as LogLevel;
  return "warn";
}

class ConsoleLogger implements Logger {
  constructor(private readonly level: LogLevel) {}

  private emit(level: LogLevel, message: string, args: unknown[]): void {
    if (ORDER[level] < ORDER[this.level]) return;
    const line = `[anyframe] ${level.toUpperCase()} ${message}`;
    if (level === "error") {
      // eslint-disable-next-line no-console
      console.error(line, ...args);
    } else if (level === "warn") {
      // eslint-disable-next-line no-console
      console.warn(line, ...args);
    } else {
      // eslint-disable-next-line no-console
      console.log(line, ...args);
    }
  }

  debug(message: string, ...args: unknown[]): void {
    this.emit("debug", message, args);
  }
  info(message: string, ...args: unknown[]): void {
    this.emit("info", message, args);
  }
  warn(message: string, ...args: unknown[]): void {
    this.emit("warn", message, args);
  }
  error(message: string, ...args: unknown[]): void {
    this.emit("error", message, args);
  }
}

export function createLogger(level?: LogLevel): Logger {
  return new ConsoleLogger(level ?? resolveLevel());
}
