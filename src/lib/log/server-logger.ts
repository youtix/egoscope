import 'server-only';

import { readServerEnv } from '@/lib/env';

import { consoleSink } from './console-sink';
import { createLogger } from './logger';

import type { Logger } from './logger';

const env = readServerEnv();

/**
 * The server's logger, at the level that LOG_LEVEL sets. While the environment
 * is invalid it still logs, at `info`, so that the problem can be reported.
 */
export const logger: Logger = createLogger({
  minLevel: env.ok ? env.env.LOG_LEVEL : 'info',
  sink: consoleSink,
});
