const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

/** Severity of a log entry, from the most verbose to the most severe. */
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Structured context of a log entry. Never pass a secret, even masked (TRV-64). */
export type LogFields = Readonly<Record<string, unknown>>;

export type Logger = Readonly<Record<LogLevel, (message: string, fields?: LogFields) => void>>;

type LogSink = (level: LogLevel, line: string) => void;

const REDACTED = '[redacted]';
const TRUNCATED = '[truncated]';
const MAX_DEPTH = 4;
// Field names that usually carry credentials; their values are never written.
const SECRET_NAME =
  /password|passphrase|passwd|secret|token|api[-_]?key|private[-_]?key|authori[sz]ation|cookie|credential/iu;

function toJsonSafe(value: unknown, depth: number): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  }
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (depth >= MAX_DEPTH) {
    return TRUNCATED;
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => toJsonSafe(item, depth + 1));
  }
  const entries = Object.entries(value).map(([name, item]) => [
    name,
    SECRET_NAME.test(name) ? REDACTED : toJsonSafe(item, depth + 1),
  ]);
  return Object.fromEntries(entries);
}

/**
 * Creates a logger that writes each entry at or above `minLevel` to `sink` as
 * one JSON line. Field values are made JSON-safe, nested objects are cut off
 * after a few levels, and fields whose names suggest a credential are masked,
 * as a last line of defense for TRV-64.
 */
export function createLogger(options: Readonly<{ minLevel: LogLevel; sink: LogSink }>): Logger {
  const threshold = LOG_LEVELS.indexOf(options.minLevel);
  const writerFor =
    (level: LogLevel) =>
    (message: string, fields?: LogFields): void => {
      if (LOG_LEVELS.indexOf(level) < threshold) {
        return;
      }
      const context = fields === undefined ? {} : { context: toJsonSafe(fields, 0) };
      options.sink(level, JSON.stringify({ level, message, ...context }));
    };
  return {
    debug: writerFor('debug'),
    info: writerFor('info'),
    warn: writerFor('warn'),
    error: writerFor('error'),
  };
}
