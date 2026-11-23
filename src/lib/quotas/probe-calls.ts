// The calls that a tick's database-free probes made, which the wake plan counted outside
// the database and the next database pass hands over (module map §1.9, TRV-03).
import { getParams } from '@/lib/params';
import { now } from '@/lib/time';

import { addUsage, settle } from './record';

import type { Transaction } from '@/lib/db';
import type { EpochMs } from '@/lib/time';
import type { ProbeService } from '@/lib/wake-plan';

/** A probe's call, as `drainCounters()` of `@/lib/wake-plan` gives it. */
type ProbeCall = Readonly<{ service: ProbeService; at: EpochMs }>;

// What one probe call of the stats source uses: one conditional file request, which the
// source's ceilings count whether it answers 200 or 304; its bytes, a few dozen, are
// not reported (CL-STA-15, CL-TRV-23).
const STATS_SOURCE_PROBE = { amounts: { requests: 1 }, resets: {}, refusal: null } as const;

/**
 * Adds the probe calls that the scheduler drained to the stats source's count, each in
 * the period of its own instant, in the caller's transaction `tx`, then settles its
 * incidents and warning (TRV-03, TRV-05). Telegram's probe, `getUpdates`, sends no
 * message, the only thing its limit counts (Telegram sheet), so it adds nothing.
 */
export async function recordProbeCalls(
  tx: Transaction,
  probeCalls: readonly ProbeCall[],
): Promise<void> {
  const calls = probeCalls.filter((call) => call.service === 'statsSource');
  if (calls.length === 0) {
    return;
  }
  for (const call of calls) {
    await addUsage(tx, 'statsSource', { usage: STATS_SOURCE_PROBE, at: call.at });
  }
  const values = await getParams(tx);
  await settle(tx, 'statsSource', { at: now(), values, resumed: false, refused: false });
}
