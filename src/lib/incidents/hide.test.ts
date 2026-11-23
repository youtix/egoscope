import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, it, onTestFinished } from 'vitest';

import { createTestDatabase, incidents, journalEntries } from '@/lib/db';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { hide } from './hide';
import { close, open } from './lifecycle';
import { hiddenCount, listOpen } from './read';

import type { IncidentOpening } from './kinds';
import type { Database } from '@/lib/db';
import type { FixedClock } from '@/lib/time';

// The owner's morning look at Home, Tuesday 24 November 2026 at 08:00 Paris time.
const NOW = toEpochMs(Date.UTC(2026, 10, 24, 7));
const MINUTE = 60_000;

const BACKUP = { kind: 'backup_failed', cause: 'upload_failed' } as const;
const QUOTA = {
  kind: 'quota_reached',
  serviceRole: 'stats_source',
  quotaCauses: ['limit_reached'],
} as const;

describe('hiding an incident', { timeout: 60_000 }, () => {
  let db: Database;
  let clock: FixedClock;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    clock = fixedClock(NOW);
    onTestFinished(installFakeClock(clock));
    return database.close;
  }, 60_000);

  const opened = async (opening: IncidentOpening) =>
    db.transaction(async (tx) => open(tx, opening));
  const backupSucceeds = async () => db.transaction(async (tx) => close(tx, BACKUP));
  const hidden = async (id: number) => db.transaction(async (tx) => hide(tx, id));
  const journaled = async () =>
    db
      .select({ messageKey: journalEntries.messageKey, params: journalEntries.messageParams })
      .from(journalEntries)
      .orderBy(asc(journalEntries.id));

  it('[CL-TRV-11] [CL-IHM-20] hides an incident without closing it, counted among the hidden incidents while it lasts', async () => {
    await opened(BACKUP);
    await opened(QUOTA);
    clock.advance(MINUTE);

    await expect(hidden(1)).resolves.toStrictEqual({ ok: true, value: undefined });

    await expect(listOpen(db)).resolves.toMatchObject([
      { id: 1, hiddenAt: NOW + MINUTE },
      { id: 2, hiddenAt: null },
    ]);
    await expect(hiddenCount(db)).resolves.toBe(1);

    await backupSucceeds();
    await expect(hiddenCount(db)).resolves.toBe(0);
  });

  it('[CL-IHM-20] journals the hiding once, a quota incident with its service, and changes nothing the second time', async () => {
    await opened(QUOTA);
    await hidden(1);
    clock.advance(MINUTE);

    await expect(hidden(1)).resolves.toStrictEqual({ ok: true, value: undefined });

    await expect(listOpen(db)).resolves.toMatchObject([{ id: 1, hiddenAt: NOW }]);
    await expect(journaled()).resolves.toStrictEqual([
      {
        messageKey: 'incident_opened',
        params: { incident: { kind: 'quota_reached', service: 'stats_source' } },
      },
      {
        messageKey: 'incident_hidden',
        params: { incident: { kind: 'quota_reached', service: 'stats_source' } },
      },
    ]);
  });

  it('[CL-TRV-11] refuses to hide an incident that is not open, which closed meanwhile', async () => {
    await opened(BACKUP);
    await backupSucceeds();

    await expect(hidden(1)).resolves.toStrictEqual({ ok: false, error: { kind: 'not_open' } });
    await expect(hidden(2)).resolves.toStrictEqual({ ok: false, error: { kind: 'not_open' } });
    await expect(hiddenCount(db)).resolves.toBe(0);
  });

  it('names an incident of another kind by its kind alone, and calls a quota incident without its service a bug', async () => {
    await opened(BACKUP);
    await db.insert(incidents).values({ kind: 'quota_warning', causeKey: 'database' });

    await expect(hidden(1)).resolves.toMatchObject({ ok: true });
    await expect(hidden(2)).rejects.toThrow(
      'The quota_warning incident holds no service, which open always stores.',
    );
    await expect(journaled()).resolves.toStrictEqual([
      { messageKey: 'incident_opened', params: { incident: { kind: 'backup_failed' } } },
      { messageKey: 'incident_hidden', params: { incident: { kind: 'backup_failed' } } },
    ]);
  });
});
