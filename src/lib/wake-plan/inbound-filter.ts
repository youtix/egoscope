import { z } from 'zod';

import { runtimeCache } from '@/lib/runtime-cache';

import { LONG_TTL_SECONDS, storedHash } from './stored-values';

import type { CacheFailure, CacheWrite } from '@/lib/runtime-cache';

/**
 * The Telegram inbound filter, `telegram:inbound` (module map §1.9): the HMAC-SHA-256
 * under TELEGRAM_WEBHOOK_SECRET of the linked chat's identifier, and of the link code
 * while one is pending, in lowercase hexadecimal, never either in clear. `notifications`
 * computes both.
 */
export type InboundFilter = Readonly<{ linkedChat: string | null; pendingCode: string | null }>;

/** The filter, `null` while the cache holds none it can read, or why it is unknown. */
export type InboundFilterReading =
  Readonly<{ ok: true; filter: InboundFilter | null }> | CacheFailure;

const INBOUND_KEY = 'telegram:inbound';

const filterSchema = z.strictObject({
  linkedChat: storedHash.nullable(),
  pendingCode: storedHash.nullable(),
});

/**
 * Reads the inbound filter, without the database, for the webhook to tell a valid
 * `/start <code>` from a private chat and an update from the linked chat from anything
 * else (module map §1.9; TEL-31): while it is `null`, every update counts as a
 * stranger's.
 */
export async function readInboundFilter(): Promise<InboundFilterReading> {
  const read = await runtimeCache().get(INBOUND_KEY);
  if (!read.ok) {
    return read;
  }
  const parsed = filterSchema.safeParse(read.value);
  return { ok: true, filter: parsed.success ? parsed.data : null };
}

/**
 * Writes the inbound filter (module map §1.9; TEL-31): `notifications` does whenever the
 * link or the pending code changes, and at a database pass that finds it missing. A
 * value that is no SHA-256 digest is a bug that would keep an identifier in clear, and
 * throws.
 */
export async function writeInboundFilter(filter: InboundFilter): Promise<CacheWrite> {
  return runtimeCache().set(INBOUND_KEY, filterSchema.parse(filter), LONG_TTL_SECONDS);
}
