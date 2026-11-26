import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestDatabase, journalEntries } from '@/lib/db';
import { DATABASE_TEST_TIMEOUT_MS } from '@/lib/testing';
import { toEpochMs } from '@/lib/time';

import type { Database } from '@/lib/db';

const PROCESS_FAKE = Symbol.for('egoscope.runtime-cache.process-fake');
const MINUTE = 60_000;
// Wednesday 25 November 2026, 10:00 UTC.
const AT = Date.UTC(2026, 10, 25, 10);
const at = (minutes: number) => toEpochMs(AT + minutes * MINUTE);

/** The flush as a deployment loads it, over the process's fake cache. */
async function load() {
  vi.resetModules();
  vi.stubEnv('EGOSCOPE_FAKES', 'runtime-cache');
  vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'dpl_test');
  vi.stubGlobal(PROCESS_FAKE, undefined);
  const { processFakeRuntimeCache } = await import('@/lib/runtime-cache');
  return {
    fake: processFakeRuntimeCache(),
    wakePlan: await import('@/lib/wake-plan'),
    ...(await import('./flush')),
  };
}

describe('the counters flush', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    return database.close;
  }, DATABASE_TEST_TIMEOUT_MS);

  it('[CL-TRV-25] journals an attempt that another instance writes after a pass, though older than those journaled, and no attempt twice', async () => {
    const { flushCounters, wakePlan } = await load();
    await wakePlan.bumpCounter({ attempt: 'refused_trigger' }, at(0))();
    await wakePlan.bumpCounter({ attempt: 'refused_trigger' }, at(2))();
    await flushCounters(db);
    // Another instance writes its buffer late: a refusal of 10:00:30, and a stranger's
    // update in a private conversation at 10:02, the instant of a refusal journaled.
    const late = toEpochMs(at(0) + MINUTE / 2);
    await wakePlan.bumpCounter({ attempt: 'refused_trigger' }, late)();
    await wakePlan.bumpCounter({ attempt: 'private' }, at(2))();
    await flushCounters(db);
    // A drain that raced a write gives attempts back: none is journaled again.
    await wakePlan.bumpCounter({ attempt: 'refused_trigger' }, at(0))();
    await wakePlan.bumpCounter({ attempt: 'private' }, at(2))();
    await flushCounters(db);
    const entries = await db
      .select({
        messageKey: journalEntries.messageKey,
        occurredAt: journalEntries.occurredAt,
        params: journalEntries.messageParams,
      })
      .from(journalEntries)
      .orderBy(asc(journalEntries.occurredAt), asc(journalEntries.id));
    expect(entries).toStrictEqual([
      { messageKey: 'trigger_refused', occurredAt: new Date(at(0)), params: {} },
      { messageKey: 'trigger_refused', occurredAt: new Date(late), params: {} },
      { messageKey: 'trigger_refused', occurredAt: new Date(at(2)), params: {} },
      {
        messageKey: 'telegram_update_ignored',
        occurredAt: new Date(at(2)),
        params: { conversation: 'private' },
      },
    ]);
  });

  it('[CL-TRV-25] journals once the count of the attempts beyond those kept one by one, though a drain gives it back', async () => {
    const { flushCounters, fake } = await load();
    const none = { tags: '', deltas: [] };
    const beyond = { kind: 'refused_trigger', count: 3, firstAt: at(-3), lastAt: at(-1) };
    const counters = { attempts: none, beyond: [beyond], probeCalls: none };
    await fake.set('wake:counters', counters, 3600);
    await flushCounters(db);
    await fake.set('wake:counters', counters, 3600);
    await flushCounters(db);
    const counted = await db
      .select({ params: journalEntries.messageParams })
      .from(journalEntries)
      .where(eq(journalEntries.messageKey, 'trigger_refusals_counted'));
    expect(counted).toStrictEqual([{ params: { count: 3, firstAt: at(-3), lastAt: at(-1) } }]);
  });
});
