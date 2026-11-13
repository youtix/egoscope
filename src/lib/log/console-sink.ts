import type { LogLevel } from './logger';

/**
 * Writes one finished log line to the console stream that matches its level.
 * This is the only place in the codebase allowed to touch `console`.
 */
export function consoleSink(level: LogLevel, line: string): void {
  switch (level) {
    case 'debug': {
      console.debug(line);
      break;
    }
    case 'info': {
      console.info(line);
      break;
    }
    case 'warn': {
      console.warn(line);
      break;
    }
    case 'error': {
      console.error(line);
      break;
    }
  }
}
