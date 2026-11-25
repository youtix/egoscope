import { beforeEach, describe, expect, it, onTestFinished } from 'vitest';

import { createTestDatabase, exportDownloads, incidents, installation } from '@/lib/db';
import { DATABASE_TEST_TIMEOUT_MS } from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { exportReminderDue, lastExport } from './queries';

import type { Database } from '@/lib/db';
import type { EpochMs } from '@/lib/time';

const DAY_MS = 86_400_000;
// Monday 2 November 2026, 08:00 UTC: the first start of the installation.
const FIRST_START = toEpochMs(Date.UTC(2026, 10, 2, 8));
// The default export reminder delay, 30 days (H-TRV-09).
const DELAY_DAYS = 30;
// The purge pass that runs the step.
const PASS_ID = '7d3c9a52-1e4b-4f86-9a0d-2b5e8c6f1a34';

function daysAfter(start: EpochMs, days: number): EpochMs {
  return toEpochMs(start + days * DAY_MS);
}

describe('the export reminder', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;

  beforeEach(async () => {
    const created = await createTestDatabase();
    onTestFinished(created.close);
    onTestFinished(installFakeClock(fixedClock(FIRST_START)));
    db = created.db;
  });

  async function reminderDue(at: EpochMs): Promise<number | null> {
    return db.transaction(async (tx) => exportReminderDue(tx, { now: at, passId: PASS_ID }));
  }

  async function download(kind: 'full' | 'cases', at: EpochMs): Promise<void> {
    await db.insert(exportDownloads).values({ kind, downloadedAt: new Date(at) });
  }

  async function reminders() {
    return db.select({ kind: incidents.kind, openedAt: incidents.openedAt }).from(incidents);
  }

  it('[TRV-54] [CL-TRV-22] gives no last export before a full one is downloaded, then the latest full one, whatever the partial ones', async () => {
    await expect(lastExport(db)).resolves.toBeNull();
    await download('full', daysAfter(FIRST_START, 1));
    await download('full', daysAfter(FIRST_START, 3));
    await download('cases', daysAfter(FIRST_START, 5));

    await expect(lastExport(db)).resolves.toBe(daysAfter(FIRST_START, 3));
  });

  it('[TRV-54] [CL-TRV-22] opens the export reminder once the delay has passed since the first start, when no full export was downloaded, and only once', async () => {
    await db.insert(installation).values({ id: 1, firstStartedAt: new Date(FIRST_START) });
    const dueAt = daysAfter(FIRST_START, DELAY_DAYS);

    const early = await reminderDue(toEpochMs(dueAt - 1));
    const opened = await reminderDue(dueAt);
    const again = await reminderDue(daysAfter(dueAt, 1));

    expect([early, typeof opened, again]).toStrictEqual([null, 'number', null]);
    await expect(reminders()).resolves.toStrictEqual([
      { kind: 'export_reminder', openedAt: new Date(dueAt) },
    ]);
  });

  it('[TRV-54] [CL-TRV-22] counts the delay from the last full export downloaded, which a later partial export does not reset', async () => {
    await db.insert(installation).values({ id: 1, firstStartedAt: new Date(FIRST_START) });
    const exportedAt = daysAfter(FIRST_START, 20);
    await download('full', exportedAt);
    await download('cases', daysAfter(exportedAt, 10));
    const dueAt = daysAfter(exportedAt, DELAY_DAYS);

    await expect(reminderDue(daysAfter(FIRST_START, DELAY_DAYS))).resolves.toBeNull();
    await expect(reminderDue(toEpochMs(dueAt - 1))).resolves.toBeNull();
    await reminderDue(dueAt);

    await expect(reminders()).resolves.toStrictEqual([
      { kind: 'export_reminder', openedAt: new Date(dueAt) },
    ]);
  });

  it('[TRV-54] [CL-TRV-22] is never due before the installation has started', async () => {
    await expect(reminderDue(daysAfter(FIRST_START, DELAY_DAYS * 2))).resolves.toBeNull();
    await expect(reminders()).resolves.toStrictEqual([]);
  });
});
