import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, incidents } from '@/lib/db';
import { toEpochMs } from '@/lib/time';

import { hiddenCount, listOpen } from './read';

import type { Database } from '@/lib/db';

// Home on Tuesday 24 November 2026 at 08:00 Paris time.
const NOW = toEpochMs(Date.UTC(2026, 10, 24, 7));
const HOUR = 3_600_000;
const hoursBefore = (hours: number) => new Date(NOW - hours * HOUR);

describe('the reading of the open incidents', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    return database.close;
  }, 60_000);

  it('[TRV-45] [IHM-20] lists the open incidents oldest first, hidden ones included, and leaves the closed ones out', async () => {
    await db.insert(incidents).values([
      { kind: 'logins_refused', openedAt: hoursBefore(1) },
      {
        kind: 'task_not_run',
        causeKey: 'purge',
        openedAt: hoursBefore(5),
        hiddenAt: hoursBefore(2),
      },
      { kind: 'export_reminder', openedAt: hoursBefore(5) },
      {
        kind: 'collection_impossible',
        status: 'closed',
        openedAt: hoursBefore(9),
        closedAt: hoursBefore(8),
      },
    ]);

    await expect(listOpen(db)).resolves.toStrictEqual([
      {
        id: 2,
        kind: 'task_not_run',
        causeKey: 'purge',
        serviceRole: null,
        quotaCauses: [],
        waitingArticles: null,
        openedAt: NOW - 5 * HOUR,
        hiddenAt: NOW - 2 * HOUR,
      },
      expect.objectContaining({ id: 3, kind: 'export_reminder', hiddenAt: null }),
      expect.objectContaining({ id: 1, kind: 'logins_refused', hiddenAt: null }),
    ]);
    await expect(hiddenCount(db)).resolves.toBe(1);
  });

  it('[DET-11] reads the waiting articles of the classification incident, and none from details it does not document', async () => {
    const quota = { kind: 'quota_reached' as const, quotaCauses: ['not_answering' as const] };
    await db.insert(incidents).values([
      {
        ...quota,
        causeKey: 'language_model',
        serviceRole: 'language_model',
        details: { waitingArticles: 210 },
      },
      {
        ...quota,
        causeKey: 'stats_source',
        serviceRole: 'stats_source',
        details: { waitingArticles: 'many' },
      },
    ]);

    await expect(listOpen(db)).resolves.toMatchObject([
      { id: 1, waitingArticles: 210 },
      { id: 2, waitingArticles: null },
    ]);
  });
});
