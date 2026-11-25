import 'server-only';

import { getDb } from '@/lib/db';
import { getParam } from '@/lib/params';
import { ok } from '@/lib/result';
import { formatInstant } from '@/lib/time';
import { sentence } from '@/lib/wording';

import type { DatabaseError } from '@/lib/db';
import type { Result } from '@/lib/result';
import type { EpochMs } from '@/lib/time';

/** A lockout of logins as the login screen shows it: its end, and that end written out. */
export type Lockout = Readonly<{ until: EpochMs; notice: string }>;

/**
 * The lockout of logins that ends at `until`, written "Login locked until Wednesday 25
 * November 2026, 14:47 Paris time": the one instant of its block, in full, in the
 * owner's zone (TRV-61, IHM-07, CL-IHM-04).
 */
export async function lockoutUntil(until: EpochMs): Promise<Result<Lockout, DatabaseError>> {
  const database = await getDb();
  if (!database.ok) {
    return database;
  }
  const zone = await getParam(database.db, 'display.timeZone');
  const time = formatInstant(until, zone, 'full');
  return ok({ until, notice: sentence('interface.loginLockedUntil', { time }) });
}
