import { redirect } from 'next/navigation';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { requireSession } from '@/lib/auth';
import { createTestDatabase, databaseActivityMinutes } from '@/lib/db';
import { logger } from '@/lib/log';
import { DATABASE_TEST_TIMEOUT_MS } from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { guardScreen } from './screen-guard';

import type { Session } from '@/lib/auth';
import type { Database, DatabaseResult } from '@/lib/db';
import type { FixedClock } from '@/lib/time';

vi.mock(import('@/lib/auth'), () => ({ requireSession: vi.fn() }));
const getDb = vi.hoisted(() => vi.fn<() => Promise<DatabaseResult>>());
vi.mock(import('@/lib/db'), async (importOriginal) => ({ ...(await importOriginal()), getDb }));
vi.mock(import('@/lib/log'), () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const SESSION: Session = {
  id: 4,
  device: 'Phone',
  openedAt: toEpochMs(Date.UTC(2026, 10, 23, 9)),
  passwordStatus: 'chosen',
};
const MINUTE = 60_000;
// The quotas module remembers, for the life of the process, the last minute that it wrote,
// and writes no row again in that minute. So each test reads the clock at a minute of its
// own, ten minutes after the last test's, 25 seconds into it: Thursday 26 November 2026 from
// 09:00:25 UTC on.
const FIRST_MINUTE = Date.UTC(2026, 10, 26, 9);
const INTO_THE_MINUTE = 25_000;
const MINUTES_APART = 10;
const RECORD_FAILED = "The minute's database activity of the page could not be recorded.";

/** The minute of the test numbered `index`, and the instant 25 seconds into it. */
const minuteOfTest = (index: number) => FIRST_MINUTE + index * MINUTES_APART * MINUTE;

/** The clock at 25 seconds into the minute of the test numbered `index`, restored when it ends. */
function clockOfTest(index: number): FixedClock {
  const clock = fixedClock(toEpochMs(minuteOfTest(index) + INTO_THE_MINUTE));
  onTestFinished(installFakeClock(clock));
  return clock;
}

/** A database of the test's own, which the guard reaches through `getDb()`. */
async function servedDatabase(): Promise<Database> {
  const database = await createTestDatabase();
  onTestFinished(database.close);
  getDb.mockResolvedValue({ ok: true, db: database.db });
  return database.db;
}

/** The minutes of database activity recorded, as instants, in order. */
async function recordedMinutes(db: Database): Promise<number[]> {
  const rows = await db
    .select({ minuteAt: databaseActivityMinutes.minuteAt })
    .from(databaseActivityMinutes)
    .orderBy(databaseActivityMinutes.minuteAt);
  return rows.map(({ minuteAt }) => minuteAt.getTime());
}

describe('guardScreen', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  it('[IHM-16] gives the screen the open session of the device', async () => {
    clockOfTest(0);
    await servedDatabase();
    vi.mocked(requireSession).mockResolvedValue({ ok: true, value: SESSION });

    await expect(guardScreen('/players')).resolves.toStrictEqual(SESSION);
    expect(requireSession).toHaveBeenCalledWith('/players');
  });

  it("[TRV-03] [TRV-04] records the minute's database activity of each page, once a minute", async () => {
    const clock = clockOfTest(1);
    const db = await servedDatabase();
    vi.mocked(requireSession).mockResolvedValue({ ok: true, value: SESSION });

    await guardScreen('/');
    const afterFirst = await recordedMinutes(db);
    clock.advance(MINUTE / 2);
    await guardScreen('/players');
    const sameMinute = await recordedMinutes(db);
    clock.advance(MINUTE / 2);
    await guardScreen('/types');

    expect(afterFirst).toStrictEqual([Date.UTC(2026, 10, 26, 9, 10)]);
    expect(sameMinute).toStrictEqual([Date.UTC(2026, 10, 26, 9, 10)]);
    await expect(recordedMinutes(db)).resolves.toStrictEqual([
      Date.UTC(2026, 10, 26, 9, 10),
      Date.UTC(2026, 10, 26, 9, 11),
    ]);
  });

  it('[IHM-10] sends a device without a session to the login page, which returns to the screen, recording nothing', async () => {
    clockOfTest(2);
    const db = await servedDatabase();
    vi.mocked(requireSession).mockResolvedValue({
      ok: false,
      error: { kind: 'log-in', redirect: '/log-in?next=%2Fplayers', ended: null },
    });

    await expect(guardScreen('/players')).rejects.toMatchObject({
      digest: 'NEXT_REDIRECT;replace;/log-in?next=%2Fplayers;307;',
    });
    await expect(recordedMinutes(db)).resolves.toStrictEqual([]);
  });

  it('[TRV-57] sends an account on its initial password to the choose-password screen, recording nothing', async () => {
    clockOfTest(3);
    const db = await servedDatabase();
    vi.mocked(requireSession).mockResolvedValue({
      ok: false,
      error: { kind: 'choose-password', redirect: '/choose-password' },
    });

    await expect(guardScreen('/more')).rejects.toMatchObject({
      digest: 'NEXT_REDIRECT;replace;/choose-password;307;',
    });
    await expect(recordedMinutes(db)).resolves.toStrictEqual([]);
  });

  it('[TRV-03] leaves a server that cannot check sessions to the error screen, recording nothing', async () => {
    clockOfTest(4);
    const db = await servedDatabase();
    vi.mocked(requireSession).mockResolvedValue({
      ok: false,
      error: { kind: 'database-not-configured' },
    });

    await expect(guardScreen('/')).rejects.toThrow(
      'The server cannot check sessions: database-not-configured.',
    );
    await expect(recordedMinutes(db)).resolves.toStrictEqual([]);
  });

  it('[TRV-03] gives the session without a record when no connection can be had', async () => {
    clockOfTest(5);
    getDb.mockResolvedValue({ ok: false, error: { kind: 'database-not-configured' } });
    vi.mocked(requireSession).mockResolvedValue({ ok: true, value: SESSION });

    await expect(guardScreen('/')).resolves.toStrictEqual(SESSION);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('[TRV-03] [IHM-16] still gives the screen its session when the record fails, and logs why once', async () => {
    clockOfTest(6);
    const database = await createTestDatabase();
    await database.close();
    getDb.mockResolvedValue({ ok: true, db: database.db });
    vi.mocked(requireSession).mockResolvedValue({ ok: true, value: SESSION });

    await expect(guardScreen('/players')).resolves.toStrictEqual(SESSION);
    const [call, ...others] = vi.mocked(logger.error).mock.calls;
    expect(others).toStrictEqual([]);
    expect(call?.[0]).toBe(RECORD_FAILED);
    expect(call?.[1]).toHaveProperty('error', expect.any(Error) as unknown);
  });

  it('leaves to Next.js the errors through which it controls a request, while recording', async () => {
    clockOfTest(7);
    getDb.mockImplementation(() => {
      redirect('/settings');
    });
    vi.mocked(requireSession).mockResolvedValue({ ok: true, value: SESSION });

    await expect(guardScreen('/')).rejects.toThrow('NEXT_REDIRECT');
    expect(logger.error).not.toHaveBeenCalled();
  });
});
