import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, incidents } from '@/lib/db';
import { INCIDENT_KINDS } from '@/lib/incidents';
import { toEpochMs } from '@/lib/time';

import { SECTIONS_IN_ORDER, todoCount, todoList } from './todo-list';

import type { Database } from '@/lib/db';
import type { IncidentKind } from '@/lib/incidents';

// Home on Tuesday 24 November 2026 at 08:00 Paris time.
const NOW = toEpochMs(Date.UTC(2026, 10, 24, 7));
const HOUR = 3_600_000;
const hoursBefore = (hours: number) => new Date(NOW - hours * HOUR);

const LOT_2_KINDS: readonly IncidentKind[] = [
  'press_source_down',
  'collection_impossible',
  'press_source_silent',
  'feed_too_short',
  'telegram_link_broken',
];

const CONSEQUENCES: readonly (readonly [IncidentKind, string])[] = [
  ['press_source_down', 'Articles from this source are no longer collected.'],
  ['collection_impossible', 'No article is collected until a source answers again.'],
  ['press_source_silent', 'Events that only this source reports may be missed.'],
  ['feed_too_short', 'Articles published between two collection runs may be missed.'],
  ['quota_reached', 'The service stops working until this is resolved.'],
  ['quota_warning', 'The service may stop working before its quota renews.'],
  ['database_volume_warning', 'The database may soon be full and stop accepting new data.'],
  ['stats_source_unavailable', 'Statistics are no longer updated.'],
  [
    'stats_source_schema_changed',
    'The statistics file that changed is not read, so its figures are not updated.',
  ],
  ['task_not_run', 'The task did not run, so its work is late.'],
  ['backup_failed', 'Your data has no recent backup.'],
  ['logins_refused', 'You cannot sign in until logins are allowed again.'],
  ['telegram_link_broken', 'Telegram messages are not delivered.'],
  ['export_reminder', 'Your data has no recent full export.'],
];

describe('the to-do list', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    return database.close;
  }, 60_000);

  it('[IHM-20] names the six sections in the order of the specification', () => {
    expect(SECTIONS_IN_ORDER).toStrictEqual([
      'requests_to_do',
      'proposed_supplements',
      'incidents',
      'players',
      'proposed_types',
      'events_and_cases_to_review',
    ]);
  });

  it('[IHM-20] shows no section and a count of zero when nothing waits for the owner', async () => {
    expect(await todoList(db, 1)).toStrictEqual({ sections: [], count: 0 });
    expect(await todoCount(db, 1)).toBe(0);
  });

  it('[IHM-20] [TRV-45] lists the open incidents oldest first with their start and their consequence, and a reference to open each', async () => {
    const [task, stats] = await db
      .insert(incidents)
      .values([
        { kind: 'task_not_run', causeKey: 'purge', openedAt: hoursBefore(2) },
        { kind: 'stats_source_unavailable', causeKey: 'not_answering', openedAt: hoursBefore(30) },
      ])
      .returning({ id: incidents.id });

    const list = await todoList(db, 1);

    expect(list).toStrictEqual({
      sections: [
        {
          section: 'incidents',
          hiddenCount: 0,
          items: [
            {
              ref: { kind: 'incident', id: stats?.id },
              incidentKind: 'stats_source_unavailable',
              serviceRole: null,
              startedAt: toEpochMs(NOW - 30 * HOUR),
              consequence: 'Statistics are no longer updated.',
            },
            {
              ref: { kind: 'incident', id: task?.id },
              incidentKind: 'task_not_run',
              serviceRole: null,
              startedAt: toEpochMs(NOW - 2 * HOUR),
              consequence: 'The task did not run, so its work is late.',
            },
          ],
        },
      ],
      count: 2,
    });
  });

  it('[IHM-20] [TRV-45] says which service a quota incident concerns', async () => {
    await db.insert(incidents).values({
      kind: 'quota_reached',
      causeKey: 'language_model',
      serviceRole: 'language_model',
      quotaCauses: ['limit_reached'],
      openedAt: hoursBefore(1),
    });

    const list = await todoList(db, 1);
    const section = list.sections[0];

    expect(section?.items.map((item) => item.serviceRole)).toStrictEqual(['language_model']);
  });

  it('[IHM-20] [CL-IHM-20] leaves a hidden incident out and counts it among the hidden incidents', async () => {
    await db.insert(incidents).values([
      { kind: 'backup_failed', causeKey: 'storage', openedAt: hoursBefore(5) },
      {
        kind: 'logins_refused',
        openedAt: hoursBefore(4),
        hiddenAt: hoursBefore(3),
      },
      {
        kind: 'export_reminder',
        openedAt: hoursBefore(4),
        hiddenAt: hoursBefore(1),
      },
      {
        kind: 'task_not_run',
        causeKey: 'purge',
        status: 'closed',
        openedAt: hoursBefore(9),
        closedAt: hoursBefore(8),
        hiddenAt: hoursBefore(8),
      },
    ]);

    const list = await todoList(db, 1);

    expect(list.sections).toHaveLength(1);
    expect(list.sections[0]?.items.map((item) => item.incidentKind)).toStrictEqual([
      'backup_failed',
    ]);
    expect(list.sections[0]?.hiddenCount).toBe(2);
  });

  it('[IHM-20] [CL-IHM-20] keeps the hidden incidents counter while only hidden incidents are open, with a count of zero', async () => {
    await db.insert(incidents).values({
      kind: 'logins_refused',
      openedAt: hoursBefore(4),
      hiddenAt: hoursBefore(3),
    });

    expect(await todoList(db, 1)).toStrictEqual({
      sections: [{ section: 'incidents', items: [], hiddenCount: 1 }],
      count: 0,
    });
  });

  it('[IHM-20] counts the items shown, never the hidden incidents', async () => {
    await db.insert(incidents).values([
      { kind: 'backup_failed', causeKey: 'storage', openedAt: hoursBefore(5) },
      {
        kind: 'quota_warning',
        causeKey: 'database',
        serviceRole: 'database',
        openedAt: hoursBefore(4),
      },
      { kind: 'logins_refused', openedAt: hoursBefore(4), hiddenAt: hoursBefore(3) },
    ]);

    const list = await todoList(db, 1);

    expect(await todoCount(db, 1)).toBe(2);
    expect(list.count).toBe(2);
    expect(list.sections.flatMap((section) => section.items)).toHaveLength(2);
  });

  describe('Lot 2 causes', () => {
    beforeEach(async () => {
      await db.insert(incidents).values([
        ...LOT_2_KINDS.map((kind, index) => ({
          kind,
          causeKey: String(index),
          openedAt: hoursBefore(10 - index),
          hiddenAt: kind === 'feed_too_short' ? hoursBefore(1) : null,
        })),
        { kind: 'backup_failed' as const, causeKey: 'storage', openedAt: hoursBefore(20) },
      ]);
    });

    it('[IHM-20] leaves the Lot 2 causes out, hidden ones included, while Lot 1 is active', async () => {
      const list = await todoList(db, 1);

      expect(list.sections[0]?.items.map((item) => item.incidentKind)).toStrictEqual([
        'backup_failed',
      ]);
      expect(list.sections[0]?.hiddenCount).toBe(0);
      expect(await todoCount(db, 1)).toBe(1);
    });

    it('[IHM-20] reads the active lot when none is given, which is Lot 1 by default', async () => {
      expect(await todoCount(db)).toBe(1);
    });

    it('[IHM-20] lists the Lot 2 causes when Lot 2 is active', async () => {
      const list = await todoList(db, 2);

      expect(list.sections[0]?.items.map((item) => item.incidentKind)).toStrictEqual([
        'backup_failed',
        'press_source_down',
        'collection_impossible',
        'press_source_silent',
        'telegram_link_broken',
      ]);
      expect(list.sections[0]?.hiddenCount).toBe(1);
      expect(await todoCount(db, 2)).toBe(5);
    });
  });

  it('[IHM-20] [TRV-42] gives every kind of incident its consequence in plain English', async () => {
    await db.insert(incidents).values(
      INCIDENT_KINDS.map((kind, index) => ({
        kind,
        causeKey: String(index),
        serviceRole:
          kind === 'quota_reached' || kind === 'quota_warning' ? ('database' as const) : null,
        quotaCauses: kind === 'quota_reached' ? ['limit_reached' as const] : [],
        openedAt: hoursBefore(100 - index),
      })),
    );

    const list = await todoList(db, 2);
    const items = list.sections.flatMap((section) => section.items);

    expect(new Map(items.map((item) => [item.incidentKind, item.consequence]))).toStrictEqual(
      new Map(CONSEQUENCES),
    );
  });
});
