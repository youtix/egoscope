import { eq, isNotNull, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';

import { describeColumns, describeForeignKeys, describeIndexes } from '../catalog';
import { createTestDatabase } from '../test-database';
import { DETECTED_EVENT, HISTORICAL_EVENT, insertParents, PARENTS } from '../test-parents';
import { imports } from './backtests';
import { backtestRequestEvents } from './backtests-events';
import { restoreReportEvents, restoreReports } from './backups';
import { events } from './events';
import {
  eventCorrections,
  eventImportWarnings,
  eventMarks,
  eventSources,
  eventStatusChanges,
} from './events-children';
import { importEventOutcomes, importPossibleDuplicates } from './imports';
import { journalEntries } from './journal';
import { outboxFacts } from './outbox';

import type { Database } from '../types';

// The tables of events-and-cases.md that hang off one event.
const TABLES = [
  'event_corrections',
  'event_import_warnings',
  'event_marks',
  'event_sources',
  'event_status_changes',
];

// Their columns, table by table and each table's in the order of the model, with the
// type, the null and the default that the model gives each, in the words of SQL.
const COLUMNS = [
  'event_corrections.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'event_corrections.player_event_id integer NOT NULL',
  'event_corrections.corrected_at timestamp with time zone NOT NULL DEFAULT now()',
  'event_corrections.field text NOT NULL',
  'event_corrections.before_value text',
  'event_corrections.after_value text',
  'event_import_warnings.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'event_import_warnings.player_event_id integer NOT NULL',
  'event_import_warnings.import_id integer',
  'event_import_warnings.kind text NOT NULL',
  'event_import_warnings.field text',
  'event_import_warnings.source_drop_cause text',
  'event_import_warnings.related_position smallint',
  'event_import_warnings.related_player_event_id integer',
  'event_marks.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'event_marks.player_event_id integer NOT NULL',
  'event_marks.mark text NOT NULL',
  "event_marks.status text NOT NULL DEFAULT 'set'::text",
  'event_marks.set_at timestamp with time zone NOT NULL DEFAULT now()',
  'event_marks.resolved_at timestamp with time zone',
  'event_sources.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'event_sources.player_event_id integer NOT NULL',
  'event_sources.position smallint NOT NULL',
  'event_sources.url text NOT NULL',
  'event_sources.cleaned_url text NOT NULL',
  'event_sources.outlet text',
  'event_sources.title text',
  'event_sources.publication_date_on date NOT NULL',
  'event_sources.publication_at timestamp with time zone',
  'event_sources.publication_offset_minutes smallint',
  'event_sources.publication_precision text',
  'event_sources.added_by_import_id integer',
  'event_sources.added_at timestamp with time zone NOT NULL DEFAULT now()',
  'event_sources.link_status text',
  'event_sources.link_checked_at timestamp with time zone',
  'event_sources.spot_check_verdict text',
  'event_status_changes.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'event_status_changes.player_event_id integer NOT NULL',
  'event_status_changes.changed_at timestamp with time zone NOT NULL DEFAULT now()',
  'event_status_changes.to_status text NOT NULL',
  'event_status_changes.dismissal_reason text',
  'event_status_changes.dismissal_comment text',
];

// Their indexes, primary keys and unique constraints included, in the words of the catalog.
const INDEXES = [
  'CREATE INDEX event_corrections_event_idx ON public.event_corrections USING btree (player_event_id, corrected_at)',
  'CREATE UNIQUE INDEX event_corrections_pkey ON public.event_corrections USING btree (id)',
  'CREATE INDEX event_import_warnings_event_idx ON public.event_import_warnings USING btree (player_event_id)',
  'CREATE UNIQUE INDEX event_import_warnings_pkey ON public.event_import_warnings USING btree (id)',
  'CREATE INDEX event_import_warnings_related_idx ON public.event_import_warnings USING btree (related_player_event_id)',
  'CREATE UNIQUE INDEX event_marks_event_mark_key ON public.event_marks USING btree (player_event_id, mark)',
  'CREATE UNIQUE INDEX event_marks_pkey ON public.event_marks USING btree (id)',
  'CREATE INDEX event_sources_cleaned_url_idx ON public.event_sources USING btree (cleaned_url)',
  'CREATE INDEX event_sources_event_idx ON public.event_sources USING btree (player_event_id, "position")',
  'CREATE UNIQUE INDEX event_sources_pkey ON public.event_sources USING btree (id)',
  'CREATE INDEX event_sources_unchecked_idx ON public.event_sources USING btree (id) WHERE (link_checked_at IS NULL)',
  'CREATE UNIQUE INDEX event_status_changes_pkey ON public.event_status_changes USING btree (id)',
];

// Their references: each row goes with its event, and outlives its import.
const FOREIGN_KEYS = [
  'event_corrections FOREIGN KEY (player_event_id) REFERENCES events(id) ON DELETE CASCADE',
  'event_import_warnings FOREIGN KEY (import_id) REFERENCES imports(id) ON DELETE SET NULL',
  'event_import_warnings FOREIGN KEY (player_event_id) REFERENCES events(id) ON DELETE CASCADE',
  'event_import_warnings FOREIGN KEY (related_player_event_id) REFERENCES events(id) ON DELETE CASCADE',
  'event_marks FOREIGN KEY (player_event_id) REFERENCES events(id) ON DELETE CASCADE',
  'event_sources FOREIGN KEY (added_by_import_id) REFERENCES imports(id) ON DELETE SET NULL',
  'event_sources FOREIGN KEY (player_event_id) REFERENCES events(id) ON DELETE CASCADE',
  'event_status_changes FOREIGN KEY (player_event_id) REFERENCES events(id) ON DELETE CASCADE',
];

// 07:15 UTC on 2 December 2024, published at 08:15 in Paris.
const PUBLISHED_AT = new Date(toEpochMs(Date.UTC(2024, 11, 2, 7, 15)));
const OFFSET = 60;
// A source of the parent event dated as written, without a time.
const SOURCE = {
  playerEventId: PARENTS.eventId,
  position: 1,
  url: 'https://news.example.com/2024/12/02/storm?utm_source=feed',
  cleanedUrl: 'https://news.example.com/2024/12/02/storm',
  publicationDateOn: '2024-12-02',
} as const;
const TIMED_SOURCE = {
  ...SOURCE,
  publicationAt: PUBLISHED_AT,
  publicationOffsetMinutes: OFFSET,
} as const;
// A warning that an import left on the parent event.
const WARNING = { playerEventId: PARENTS.eventId, importId: PARENTS.importId } as const;
// The other event that cites a shared link.
const OTHER_EVENT_ID = 2;
// The historical media storm of the first player, when a test writes it: the third event.
const HISTORICAL_EVENT_ID = 3;
// A restore that left the parent event for the owner to check.
const REPORT = {
  backupCreatedAt: PUBLISHED_AT,
  sourceKind: 'backup',
  tableCounts: { events: 2 },
  playersDeletedAgain: 0,
  eventsWithdrawnAgain: 0,
  ledgerCarriedOver: true,
  olderThanHorizon: false,
  consistencyCheckPassed: true,
} as const;
// A value that no stored set of the model holds.
const OUTSIDE = sql`'outside'`;

/** The error of a query that a CHECK constraint refused. */
const violationOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23514', constraint },
});

describe('the tables that hang off an event', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    await insertParents(db);
    await db.insert(events).values({ ...DETECTED_EVENT, referenceAt: PUBLISHED_AT });
    return database.close;
  }, 60_000);

  it('builds the columns, indexes and references that events-and-cases.md gives these tables', async () => {
    await expect(describeColumns(db, TABLES)).resolves.toStrictEqual(COLUMNS);
    await expect(describeIndexes(db, TABLES)).resolves.toStrictEqual(INDEXES);
    await expect(describeForeignKeys(db, TABLES)).resolves.toStrictEqual(FOREIGN_KEYS);
  });

  it('[DSN-08] [CL-IMP-09] [CL-DET-26] keeps a source as published, dated as written, and every value of its checks', async () => {
    await db.insert(eventSources).values([
      { ...SOURCE, linkStatus: 'not_found', spotCheckVerdict: 'consistent' },
      { ...TIMED_SOURCE, position: 2, outlet: 'Harbor Daily', spotCheckVerdict: 'inconsistent' },
      { ...SOURCE, position: 3, publicationAt: PUBLISHED_AT, publicationPrecision: 'exact' },
      {
        ...TIMED_SOURCE,
        position: 4,
        publicationPrecision: 'approximate',
        spotCheckVerdict: 'inaccessible',
      },
    ]);

    const [first] = await db.select().from(eventSources).orderBy(eventSources.position);

    expect(first).toMatchObject({ ...SOURCE, outlet: null, title: null, addedByImportId: null });
    expect(first?.addedAt).toBeInstanceOf(Date);
  });

  it.each([
    [
      'a precision of none',
      { ...TIMED_SOURCE, publicationPrecision: sql`'none'` },
      'publication_precision',
    ],
    ['a link status', { ...SOURCE, linkStatus: OUTSIDE }, 'link_status'],
    ['a spot-check verdict', { ...SOURCE, spotCheckVerdict: OUTSIDE }, 'spot_check_verdict'],
    ['a time without its offset', { ...SOURCE, publicationAt: PUBLISHED_AT }, 'publication'],
    ['an offset without its time', { ...SOURCE, publicationOffsetMinutes: OFFSET }, 'publication'],
    ['a precision without a time', { ...SOURCE, publicationPrecision: 'exact' }, 'publication'],
  ] as const)('[CL-IMP-09] [CL-DET-26] refuses a source with %s', async (_case, source, check) => {
    const insert = db.insert(eventSources).values(source);

    await expect(insert).rejects.toMatchObject(violationOf(`event_sources_${check}_check`));
  });

  it('[IMP-19] [CL-IMP-02] stores each event-scope warning of the glossary with what it names', async () => {
    const causes = [
      'incomplete_address',
      'home_page',
      'disallowed_domain',
      'publication_date_missing',
      'publication_date_malformed',
      'publication_date_in_future',
    ] as const;
    const plain = [
      'attached_to_surviving_type',
      'type_not_declared_covered',
      'outside_declared_period',
      'confidence_defaulted',
      'context_defaulted',
      'non_standard_date',
      'time_ignored',
    ] as const;
    const texts = [
      'possible_statistics',
      'text_too_long_ignored',
      'text_quotation_mark_ignored',
      'possible_citation_marker',
    ] as const;
    await db.insert(eventImportWarnings).values([
      ...causes.map(
        (sourceDropCause) =>
          ({
            ...WARNING,
            kind: 'source_dropped',
            sourceDropCause,
            relatedPosition: 2,
          }) as const,
      ),
      { ...WARNING, kind: 'source_outlet_or_title_missing', relatedPosition: 1 },
      { ...WARNING, kind: 'shared_link', relatedPlayerEventId: OTHER_EVENT_ID },
      ...plain.map((kind) => ({ ...WARNING, kind })),
      ...texts.map((kind) => ({ ...WARNING, kind, field: 'unverified_note' })),
    ]);

    await expect(db.$count(eventImportWarnings)).resolves.toBe(19);
  });

  it.each([
    ['of a kind the glossary does not list', { kind: OUTSIDE }, 'kind'],
    [
      'of a source dropped for no listed cause',
      { kind: 'source_dropped', sourceDropCause: OUTSIDE, relatedPosition: 1 },
      'source_drop_cause',
    ],
    [
      'of a source dropped without its cause',
      { kind: 'source_dropped', relatedPosition: 1 },
      'source_dropped',
    ],
    [
      'of another kind with a cause',
      { kind: 'time_ignored', sourceDropCause: 'home_page' },
      'source_dropped',
    ],
    [
      'of a source dropped without its position',
      { kind: 'source_dropped', sourceDropCause: 'home_page' },
      'source_position',
    ],
    [
      'of a missing outlet without its position',
      { kind: 'source_outlet_or_title_missing' },
      'source_position',
    ],
    [
      'of another kind with a position',
      { kind: 'time_ignored', relatedPosition: 1 },
      'source_position',
    ],
    ['of a shared link without the other event', { kind: 'shared_link' }, 'shared_link'],
    [
      'of another kind naming another event',
      { kind: 'time_ignored', relatedPlayerEventId: OTHER_EVENT_ID },
      'shared_link',
    ],
    ['of a text without its field', { kind: 'possible_statistics' }, 'text_field'],
    ['of another kind with a field', { kind: 'time_ignored', field: 'description' }, 'text_field'],
  ] as const)('[IMP-19] [CL-IMP-02] refuses a warning %s', async (_case, warning, check) => {
    const insert = db.insert(eventImportWarnings).values({ ...WARNING, ...warning });

    await expect(insert).rejects.toMatchObject(violationOf(`event_import_warnings_${check}_check`));
  });

  it('[IMP-17] [IMP-37] drops a shared-link warning with the other event, and keeps what an import added without it', async () => {
    await db.insert(eventSources).values({ ...SOURCE, addedByImportId: PARENTS.importId });
    await db.insert(eventImportWarnings).values([
      { ...WARNING, kind: 'shared_link', relatedPlayerEventId: OTHER_EVENT_ID },
      { ...WARNING, kind: 'time_ignored' },
    ]);

    await db.delete(events).where(eq(events.id, OTHER_EVENT_ID));
    await db.delete(imports).where(eq(imports.id, PARENTS.importId));

    await expect(
      db
        .select({ kind: eventImportWarnings.kind, importId: eventImportWarnings.importId })
        .from(eventImportWarnings),
    ).resolves.toStrictEqual([{ kind: 'time_ignored', importId: null }]);
    await expect(
      db.select({ importId: eventSources.addedByImportId }).from(eventSources),
    ).resolves.toStrictEqual([{ importId: null }]);
  });

  it('[DET-32] [CL-DET-16] marks a detected event once per stored mark, set then lifted', async () => {
    await db.insert(eventMarks).values([
      { playerEventId: PARENTS.eventId, mark: 'dating_to_verify' },
      {
        playerEventId: PARENTS.eventId,
        mark: 'possible_historical_duplicate',
        status: 'lifted',
        resolvedAt: PUBLISHED_AT,
      },
      { playerEventId: PARENTS.eventId, mark: 'description_to_review' },
    ]);

    const again = db
      .insert(eventMarks)
      .values({ playerEventId: PARENTS.eventId, mark: 'dating_to_verify' });
    const derived = db
      .insert(eventMarks)
      .values({ playerEventId: PARENTS.eventId, mark: sql`'detected_after_tip_off'` });
    const status = db
      .insert(eventMarks)
      .values({ playerEventId: OTHER_EVENT_ID, mark: 'dating_to_verify', status: OUTSIDE });

    await expect(
      db.select({ status: eventMarks.status }).from(eventMarks).orderBy(eventMarks.id),
    ).resolves.toStrictEqual([{ status: 'set' }, { status: 'lifted' }, { status: 'set' }]);
    await expect(again).rejects.toMatchObject({
      cause: { code: '23505', constraint: 'event_marks_event_mark_key' },
    });
    await expect(derived).rejects.toMatchObject(violationOf('event_marks_mark_check'));
    await expect(status).rejects.toMatchObject(violationOf('event_marks_status_check'));
  });

  it('[DET-43] [DET-45] [DET-52] records each dismissal with its reason, and each reinstatement', async () => {
    const reasons = [
      'not_an_event',
      'no_validated_type_fits',
      'old_fact',
      'non_public_or_unverifiable',
      'duplicate_of_historical_event',
    ] as const;
    await db.insert(eventStatusChanges).values([
      ...reasons.map(
        (dismissalReason) =>
          ({ playerEventId: PARENTS.eventId, toStatus: 'dismissed', dismissalReason }) as const,
      ),
      {
        playerEventId: PARENTS.eventId,
        toStatus: 'dismissed',
        dismissalReason: 'other',
        dismissalComment: 'A rumor.',
      },
      { playerEventId: PARENTS.eventId, toStatus: 'detected' },
    ]);

    await expect(db.$count(eventStatusChanges)).resolves.toBe(7);
  });

  it.each([
    ['to a withdrawn status', { toStatus: sql`'withdrawn'` }, 'to_status'],
    [
      'for a reason the glossary does not list',
      { toStatus: 'dismissed', dismissalReason: OUTSIDE },
      'dismissal_reason',
    ],
    ['to dismissed without its reason', { toStatus: 'dismissed' }, 'dismissed'],
    [
      'for another reason without a comment',
      { toStatus: 'dismissed', dismissalReason: 'other' },
      'dismissal_comment',
    ],
  ] as const)('[DET-43] refuses a status change %s', async (_case, change, check) => {
    const insert = db
      .insert(eventStatusChanges)
      .values({ playerEventId: PARENTS.eventId, ...change });

    await expect(insert).rejects.toMatchObject(violationOf(`event_status_changes_${check}_check`));
  });

  it('[IMP-32] [DET-52] traces each field a correction changes, and the values of the structured fields of a detected event', async () => {
    // A historical event keeps the fields corrected and never a value (IMP-32, D-20).
    const historical = [
      'event_type',
      'reference_date',
      'description',
      'sources',
      'injury_return',
      'game_stakes',
      'research_confidence',
      'unverified_note',
    ] as const;
    // A detected event keeps its structured fields' values before and after, here those
    // of the second one, moved to the first player, its type and its date corrected
    // (CL-DSN-15), and notes its other corrections and actions without a value.
    const detected = { playerEventId: OTHER_EVENT_ID } as const;
    const noted = [
      'description',
      'sources',
      'article_detached',
      'event_merged_in',
      'player_added',
      'rescued',
    ] as const;
    await db.insert(events).values(HISTORICAL_EVENT);
    await db.insert(eventCorrections).values([
      ...historical.map((field) => ({ playerEventId: HISTORICAL_EVENT_ID, field })),
      {
        ...detected,
        field: 'player',
        beforeValue: PARENTS.otherPlayerId,
        afterValue: PARENTS.playerId,
      },
      { ...detected, field: 'event_type', beforeValue: 'bereavement', afterValue: 'media-storm' },
      {
        ...detected,
        field: 'reference_date',
        beforeValue: '2024-12-03T07:15:00.000Z',
        afterValue: '2024-12-02T07:15:00.000Z',
      },
      { ...detected, field: 'injury_return', beforeValue: 'yes', afterValue: 'unknown' },
      { ...detected, field: 'game_stakes', beforeValue: 'high', afterValue: 'unknown' },
      ...noted.map((field) => ({ ...detected, field })),
    ]);

    await expect(
      db.$count(eventCorrections, isNotNull(eventCorrections.beforeValue)),
    ).resolves.toBe(5);
    await expect(db.$count(eventCorrections)).resolves.toBe(19);
  });

  it.each([
    ['of a field the model does not list', { field: OUTSIDE }, 'field'],
    ...(
      [
        'description',
        'unverified_note',
        'sources',
        'article_detached',
        'event_merged_in',
        'player_added',
        'rescued',
      ] as const
    ).map(
      (field) =>
        [
          `keeping the earlier ${field}`,
          { field, beforeValue: 'An earlier text.' },
          'values',
        ] as const,
    ),
    [
      'keeping the later description',
      { field: 'description', afterValue: 'A later text.' },
      'values',
    ],
  ] as const)(
    '[DET-52] [CL-DSN-15] [D-20] refuses a correction %s',
    async (_case, correction, check) => {
      const insert = db
        .insert(eventCorrections)
        .values({ playerEventId: PARENTS.eventId, ...correction });

      await expect(insert).rejects.toMatchObject(violationOf(`event_corrections_${check}_check`));
    },
  );

  it('[DSN-27] [IMP-37] [CL-TRV-10] erases with an event every row that designates it, and empties the references of the trace and the journal', async () => {
    const event = { playerEventId: PARENTS.eventId } as const;
    const request = { backtestRequestId: PARENTS.requestId } as const;
    await db.insert(eventSources).values(SOURCE);
    await db.insert(eventImportWarnings).values([
      { ...WARNING, kind: 'time_ignored' },
      {
        ...WARNING,
        playerEventId: OTHER_EVENT_ID,
        kind: 'shared_link',
        relatedPlayerEventId: PARENTS.eventId,
      },
    ]);
    await db.insert(eventMarks).values({ ...event, mark: 'dating_to_verify' });
    await db.insert(eventStatusChanges).values({ ...event, toStatus: 'detected' });
    await db.insert(eventCorrections).values({ ...event, field: 'sources' });
    await db.insert(backtestRequestEvents).values({ ...request, ...event });
    await db.insert(restoreReports).values(REPORT);
    await db.insert(restoreReportEvents).values({ restoreReportId: 1, ...event });
    await db.insert(outboxFacts).values({
      kind: 'backtest_request_deadline_changed',
      ...request,
      deadlineGameId: PARENTS.gameId,
      ...event,
    });
    await db
      .insert(importEventOutcomes)
      .values({ importId: PARENTS.importId, outcome: 'added', ...event });
    await db.insert(importPossibleDuplicates).values({
      importId: PARENTS.importId,
      resultPlayerEventId: PARENTS.eventId,
      existingPlayerEventId: PARENTS.eventId,
      answer: 'distinct_facts',
    });
    await db
      .insert(journalEntries)
      .values({ category: 'user_action', level: 'info', messageKey: 'event_corrected', ...event });
    const designating = [
      eventSources,
      eventImportWarnings,
      eventMarks,
      eventStatusChanges,
      eventCorrections,
      backtestRequestEvents,
      restoreReportEvents,
      outboxFacts,
    ];

    await db.delete(events).where(eq(events.id, PARENTS.eventId));

    await expect(
      Promise.all(designating.map(async (table) => db.$count(table))),
    ).resolves.toStrictEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    await expect(
      db.select({ eventId: importEventOutcomes.playerEventId }).from(importEventOutcomes),
    ).resolves.toStrictEqual([{ eventId: null }]);
    await expect(
      db
        .select({
          result: importPossibleDuplicates.resultPlayerEventId,
          existing: importPossibleDuplicates.existingPlayerEventId,
        })
        .from(importPossibleDuplicates),
    ).resolves.toStrictEqual([{ result: null, existing: null }]);
    await expect(
      db.select({ eventId: journalEntries.playerEventId }).from(journalEntries),
    ).resolves.toStrictEqual([{ eventId: null }]);
  });
});
