import { readServerEnv } from '@/lib/env';
import { err, ok } from '@/lib/result';

import type { Result } from '@/lib/result';

/** Why a link cannot be written in full: the deployment does not set APP_BASE_URL. */
export type AbsoluteUrlError = Readonly<{ kind: 'app-base-url-missing' }>;

const MISSING = { kind: 'app-base-url-missing' } as const satisfies AbsoluteUrlError;
const SLASH = '/';

/** `base` without its final slash, which every path brings. */
const withoutFinalSlash = (base: string): string =>
  base.endsWith(SLASH) ? base.slice(0, -SLASH.length) : base;

/**
 * The full address of the screen at `path`, for a link that leaves the app, such as one in
 * a Telegram message (TEL-07, IHM-17): APP_BASE_URL followed by the path, which a login
 * then opens (module map section 3.6, step 7).
 */
export function absoluteUrl(path: string): Result<string, AbsoluteUrlError> {
  const env = readServerEnv();
  const base = env.ok ? env.env.APP_BASE_URL : undefined;
  return base === undefined ? err(MISSING) : ok(`${withoutFinalSlash(base)}${path}`);
}
