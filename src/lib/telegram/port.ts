import 'server-only';

import { adapterFor } from '@/lib/env';

import { createFakeTelegram } from './fake';

import type { FakeTelegram } from './fake';
import type { Telegram } from './types';

/** The Telegram bot that this deployment uses, or why it has none. */
export type TelegramAccess =
  | Readonly<{ ok: true; bot: Telegram }>
  | Readonly<{ ok: false; error: Readonly<{ kind: 'not_configured' }> }>;

const NOT_CONFIGURED: TelegramAccess = { ok: false, error: { kind: 'not_configured' } };

// The fake of the whole process lives on globalThis under a registered symbol, so
// that every copy of this module (a bundle of the server, a reload of `next dev`)
// keeps the same chats, updates and scripted failures.
const SHARED_FAKE = Symbol.for('egoscope.telegram.fake');

const isFake = (value: unknown): value is FakeTelegram =>
  typeof value === 'object' && value !== null && 'deliver' in value;

/**
 * The fake that the whole process shares, created at its first use, which the
 * accessor serves under EGOSCOPE_FAKES and the hermetic end-to-end controls script
 * (TEL-29, module map §2.3).
 */
export function fakeTelegram(): FakeTelegram {
  const existing: unknown = Reflect.get(globalThis, SHARED_FAKE);
  if (isFake(existing)) {
    return existing;
  }
  const fake = createFakeTelegram();
  Reflect.set(globalThis, SHARED_FAKE, fake);
  return fake;
}

/**
 * The Telegram bot that `env.adapterFor` names (module map §5): the process's one fake
 * under EGOSCOPE_FAKES; otherwise the Bot API adapter, which this build does not hold
 * yet, and in its place "not configured", which sends nothing (TEL-28).
 */
export function telegram(): TelegramAccess {
  return adapterFor('telegram') === 'fake' ? { ok: true, bot: fakeTelegram() } : NOT_CONFIGURED;
}
