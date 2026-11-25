import 'server-only';

import { adapterFor } from '@/lib/env';

import { createFakePressFeeds } from './fake';

import type { FakePressFeeds } from './fake';
import type { PressFeeds } from './types';

/** The press feeds that this deployment reads, or why it reads none. */
export type PressFeedsAccess =
  | Readonly<{ ok: true; feeds: PressFeeds }>
  | Readonly<{ ok: false; error: Readonly<{ kind: 'not_configured' }> }>;

const NOT_CONFIGURED: PressFeedsAccess = { ok: false, error: { kind: 'not_configured' } };

// The fake of the whole process lives on globalThis under a registered symbol, so
// that every copy of this module (a bundle of the server, a reload of `next dev`)
// serves the same feeds and the same scripted failures.
const SHARED_FAKE = Symbol.for('egoscope.press-feeds.fake');

const isFake = (value: unknown): value is FakePressFeeds =>
  typeof value === 'object' && value !== null && 'post' in value;

/**
 * The fake that the whole process shares, created at its first use, which the
 * accessor serves under EGOSCOPE_FAKES and the hermetic end-to-end controls script
 * (COL-02, module map §2.3).
 */
export function fakePressFeeds(): FakePressFeeds {
  const existing: unknown = Reflect.get(globalThis, SHARED_FAKE);
  if (isFake(existing)) {
    return existing;
  }
  const fake = createFakePressFeeds();
  Reflect.set(globalThis, SHARED_FAKE, fake);
  return fake;
}

/**
 * The press feeds that `env.adapterFor` names (module map §5): the process's one fake
 * under EGOSCOPE_FAKES; otherwise the syndication adapter, which this build does not
 * hold yet, and in its place "not configured", which reads nothing (COL-02).
 */
export function pressFeeds(): PressFeedsAccess {
  return adapterFor('press-feeds') === 'fake'
    ? { ok: true, feeds: fakePressFeeds() }
    : NOT_CONFIGURED;
}
