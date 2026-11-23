import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, it, onTestFinished } from 'vitest';

import { createTestDatabase, incidents, journalEntries, outboxFacts } from '@/lib/db';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { INCIDENT_KINDS } from './kinds';
import { close, open, updateQuotaCauses } from './lifecycle';
import { listOpen } from './read';

import type { IncidentCause, IncidentOpening, QuotaCauses, ServiceRole } from './kinds';
import type { Database } from '@/lib/db';
import type { FixedClock } from '@/lib/time';

// The first failed statistics run, Monday 23 November 2026 at 15:00 Paris time.
const FIRST_FAILURE = toEpochMs(Date.UTC(2026, 10, 23, 14));
const HOUR = 3_600_000;
const PASS_ID = '3f6a2d8c-1b4e-4c97-9e05-8a7b2c1d6f43';

const STATS_DOWN = { kind: 'stats_source_unavailable', cause: 'not_answering' } as const;
const STATS_LATE = { kind: 'stats_source_unavailable', cause: 'source_late' } as const;
const CLASSIFICATION = {
  kind: 'quota_reached',
  serviceRole: 'language_model',
  quotaCauses: ['limit_reached'],
  waitingArticles: 140,
} as const;

describe('the life of an incident', { timeout: 60_000 }, () => {
  let db: Database;
  let clock: FixedClock;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    clock = fixedClock(FIRST_FAILURE);
    onTestFinished(installFakeClock(clock));
    return database.close;
  }, 60_000);

  const opened = async (opening: IncidentOpening, passId?: string) =>
    db.transaction(async (tx) => open(tx, opening, passId));
  const closed = async (cause: IncidentCause) => db.transaction(async (tx) => close(tx, cause));
  const updated = async (serviceRole: ServiceRole, quotaCauses: QuotaCauses) =>
    db.transaction(async (tx) => updateQuotaCauses(tx, serviceRole, quotaCauses));
  const entries = async () =>
    db
      .select({
        messageKey: journalEntries.messageKey,
        level: journalEntries.level,
        incidentId: journalEntries.incidentId,
        params: journalEntries.messageParams,
      })
      .from(journalEntries)
      .orderBy(asc(journalEntries.id));
  const facts = async () =>
    db
      .select({
        kind: outboxFacts.kind,
        incidentId: outboxFacts.incidentId,
        passId: outboxFacts.passId,
      })
      .from(outboxFacts)
      .orderBy(asc(outboxFacts.id));
  const stored = async () =>
    db
      .select({
        id: incidents.id,
        status: incidents.status,
        openedAt: incidents.openedAt,
        closedAt: incidents.closedAt,
      })
      .from(incidents)
      .orderBy(asc(incidents.id));

  it('[TRV-45] lists the complete incident kinds of the module map, without a failed-messages kind', () => {
    expect(new Set(INCIDENT_KINDS)).toStrictEqual(
      new Set([
        'quota_reached',
        'stats_source_unavailable',
        'stats_source_schema_changed',
        'task_not_run',
        'backup_failed',
        'logins_refused',
        'quota_warning',
        'database_volume_warning',
        'export_reminder',
        'press_source_down',
        'collection_impossible',
        'press_source_silent',
        'feed_too_short',
        'telegram_link_broken',
      ]),
    );
    expect(INCIDENT_KINDS).toHaveLength(14);
  });

  it('[CA-TRV-14] shows one incident through three failed runs, open since the first, and closes it when the source answers', async () => {
    for (let run = 0; run < 3; run += 1) {
      await opened({ ...STATS_DOWN, since: FIRST_FAILURE });
      clock.advance(4 * HOUR);
    }

    await expect(listOpen(db)).resolves.toMatchObject([
      {
        id: 1,
        kind: 'stats_source_unavailable',
        causeKey: 'not_answering',
        openedAt: FIRST_FAILURE,
      },
    ]);

    await expect(closed(STATS_DOWN)).resolves.toBe(1);
    await expect(listOpen(db)).resolves.toStrictEqual([]);
    await expect(stored()).resolves.toStrictEqual([
      {
        id: 1,
        status: 'closed',
        openedAt: new Date(FIRST_FAILURE),
        closedAt: new Date(FIRST_FAILURE + 12 * HOUR),
      },
    ]);
  });

  it('[CA-TRV-14] dates an incident that opens after a delay from when its cause began', async () => {
    clock.advance(12 * HOUR);

    await expect(opened({ ...STATS_DOWN, since: FIRST_FAILURE })).resolves.toBe(1);
    await expect(opened(STATS_LATE)).resolves.toBe(2);

    await expect(listOpen(db)).resolves.toMatchObject([
      { id: 1, openedAt: FIRST_FAILURE },
      { id: 2, openedAt: FIRST_FAILURE + 12 * HOUR },
    ]);
  });

  it('[TRV-45] changes nothing when the cause of an incident is already open: no second incident, entry or fact', async () => {
    await expect(opened(CLASSIFICATION)).resolves.toBe(1);
    clock.advance(HOUR);

    await expect(
      opened({ ...CLASSIFICATION, quotaCauses: ['not_answering'], waitingArticles: 90 }, PASS_ID),
    ).resolves.toBeNull();

    await expect(listOpen(db)).resolves.toStrictEqual([
      {
        id: 1,
        kind: 'quota_reached',
        causeKey: 'language_model',
        serviceRole: 'language_model',
        quotaCauses: ['limit_reached'],
        waitingArticles: 140,
        openedAt: FIRST_FAILURE,
        hiddenAt: null,
      },
    ]);
    await expect(entries()).resolves.toHaveLength(1);
    await expect(facts()).resolves.toHaveLength(1);
  });

  it('[TRV-45] [CL-TRV-04] [CL-TRV-11] [CL-TRV-23] opens one incident per cause of a kind', async () => {
    const openings: readonly IncidentOpening[] = [
      { kind: 'quota_reached', serviceRole: 'stats_source', quotaCauses: ['refused_before_limit'] },
      { kind: 'quota_warning', serviceRole: 'stats_source' },
      { kind: 'quota_warning', serviceRole: 'database' },
      STATS_DOWN,
      STATS_LATE,
      { kind: 'task_not_run', task: 'purge' },
      { kind: 'task_not_run', task: 'backup' },
      { kind: 'backup_failed', cause: 'upload_failed' },
      { kind: 'backup_failed', cause: 'missing_token' },
      { kind: 'press_source_down', pressSourceId: 3 },
      { kind: 'press_source_silent', pressSourceId: 3 },
      { kind: 'collection_impossible' },
    ];
    for (const opening of [...openings, ...openings]) {
      await opened(opening);
    }

    const listed = await listOpen(db);
    expect(
      listed.map(({ kind, causeKey, quotaCauses }) => [kind, causeKey, quotaCauses]),
    ).toStrictEqual([
      ['quota_reached', 'stats_source', ['refused_before_limit']],
      ['quota_warning', 'stats_source', []],
      ['quota_warning', 'database', []],
      ['stats_source_unavailable', 'not_answering', []],
      ['stats_source_unavailable', 'source_late', []],
      ['task_not_run', 'purge', []],
      ['task_not_run', 'backup', []],
      ['backup_failed', 'upload_failed', []],
      ['backup_failed', 'missing_token', []],
      ['press_source_down', '3', []],
      ['press_source_silent', '3', []],
      ['collection_impossible', '', []],
    ]);
  });

  it('[CL-TRV-23] closes the late source apart from its failures, each cause on its own recovery', async () => {
    await opened(STATS_DOWN);
    await opened(STATS_LATE);

    await expect(closed(STATS_LATE)).resolves.toBe(2);

    await expect(listOpen(db)).resolves.toMatchObject([{ id: 1, causeKey: 'not_answering' }]);
  });

  it('[TRV-45] closes nothing when no incident of the cause is open', async () => {
    await opened({ kind: 'task_not_run', task: 'purge' });

    await expect(closed({ kind: 'task_not_run', task: 'backup' })).resolves.toBeNull();
    await expect(closed(STATS_DOWN)).resolves.toBeNull();

    await expect(listOpen(db)).resolves.toHaveLength(1);
    await expect(entries()).resolves.toHaveLength(1);
    await expect(facts()).resolves.toHaveLength(1);
  });

  it('[TRV-45] opens a new incident when its cause comes back after a closure', async () => {
    await opened(STATS_DOWN);
    await closed(STATS_DOWN);
    clock.advance(HOUR);

    await expect(opened(STATS_DOWN)).resolves.toBe(2);

    await expect(listOpen(db)).resolves.toMatchObject([
      { id: 2, openedAt: FIRST_FAILURE + HOUR, hiddenAt: null },
    ]);
  });

  it('[TRV-45] [TRV-43] journals every opening by the level of its kind, and every closing', async () => {
    await opened({ kind: 'backup_failed', cause: 'upload_failed' });
    await opened({ kind: 'quota_warning', serviceRole: 'language_model' });
    await opened({ kind: 'export_reminder' });
    await closed({ kind: 'quota_warning', serviceRole: 'language_model' });

    await expect(entries()).resolves.toStrictEqual([
      {
        messageKey: 'incident_opened',
        level: 'incident',
        incidentId: 1,
        params: { incident: { kind: 'backup_failed' } },
      },
      {
        messageKey: 'warning_opened',
        level: 'warning',
        incidentId: 2,
        params: { incident: { kind: 'quota_warning', service: 'language_model' } },
      },
      {
        messageKey: 'reminder_opened',
        level: 'warning',
        incidentId: 3,
        params: { incident: { kind: 'export_reminder' } },
      },
      {
        messageKey: 'incident_closed',
        level: 'info',
        incidentId: 2,
        params: { incident: { kind: 'quota_warning', service: 'language_model' } },
      },
    ]);
  });

  it('[TEL-15] emits one fact at the opening and one at the closing, of the pass that made them', async () => {
    await opened({ kind: 'logins_refused' }, PASS_ID);
    await closed({ kind: 'logins_refused' });

    await expect(facts()).resolves.toStrictEqual([
      { kind: 'incident_opened', incidentId: 1, passId: PASS_ID },
      { kind: 'incident_closed', incidentId: 1, passId: null },
    ]);
  });

  it('[TRV-45] [TEL-15] writes the incident, its entry and its fact in the caller’s transaction, all or nothing', async () => {
    const rolledBack = db.transaction(async (tx) => {
      await open(tx, { kind: 'telegram_link_broken' });
      throw new Error('The send failed further on.');
    });

    await expect(rolledBack).rejects.toThrow('The send failed further on.');
    await expect(stored()).resolves.toStrictEqual([]);
    await expect(entries()).resolves.toStrictEqual([]);
    await expect(facts()).resolves.toStrictEqual([]);
  });

  it('[CL-DET-04] [CL-DET-05] updates the classification incident’s cause without a message or an entry, keeping its waiting articles', async () => {
    await opened(CLASSIFICATION);

    await expect(updated('language_model', ['not_answering'])).resolves.toBe(1);
    await expect(updated('stats_source', ['limit_reached'])).resolves.toBeNull();

    await expect(listOpen(db)).resolves.toMatchObject([
      { quotaCauses: ['not_answering'], waitingArticles: 140 },
    ]);
    await expect(facts()).resolves.toHaveLength(1);
    await expect(entries()).resolves.toHaveLength(1);
  });

  it('[CL-DET-04] closes the classification incident when no item is eligible, which no update reopens', async () => {
    await opened(CLASSIFICATION);

    await expect(closed({ kind: 'quota_reached', serviceRole: 'language_model' })).resolves.toBe(1);
    await expect(updated('language_model', ['limit_reached'])).resolves.toBeNull();

    await expect(listOpen(db)).resolves.toStrictEqual([]);
    await expect(facts()).resolves.toMatchObject([
      { kind: 'incident_opened' },
      { kind: 'incident_closed' },
    ]);
  });
});
