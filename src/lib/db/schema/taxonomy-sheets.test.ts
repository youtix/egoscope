import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';

import { describeColumns, describeForeignKeys, describeIndexes } from '../catalog';
import { createTestDatabase } from '../test-database';
import { followedPlayers } from './players';
import { eventTypes } from './taxonomy';
import {
  typeIllustrationSources,
  typeOccurrences,
  typeSheetChanges,
  typeSheetVersions,
} from './taxonomy-sheets';

import type { Database } from '../types';

// The tables of event-types.md that hang off one type, type_occurrences of Lot 2 included.
const TABLES = [
  'type_illustration_sources',
  'type_occurrences',
  'type_sheet_changes',
  'type_sheet_versions',
];

// Their columns, table by table and each table's in the order of event-types.md, with
// the type, the null and the default that the model gives each, in the words of SQL.
const COLUMNS = [
  'type_illustration_sources.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'type_illustration_sources.event_type_id text NOT NULL',
  'type_illustration_sources.position smallint NOT NULL',
  'type_illustration_sources.url text NOT NULL',
  'type_illustration_sources.outlet text',
  'type_illustration_sources.title text',
  'type_illustration_sources.publication_date_on date NOT NULL',
  'type_illustration_sources.publication_at timestamp with time zone',
  'type_illustration_sources.publication_offset_minutes smallint',
  'type_occurrences.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'type_occurrences.event_type_id text NOT NULL',
  'type_occurrences.player_id uuid NOT NULL',
  'type_occurrences.recorded_at timestamp with time zone NOT NULL DEFAULT now()',
  'type_occurrences.is_originating_fact boolean NOT NULL DEFAULT false',
  'type_occurrences.justification text',
  'type_occurrences.article_url text NOT NULL',
  'type_occurrences.article_outlet text',
  'type_occurrences.article_title text',
  'type_occurrences.article_published_at timestamp with time zone NOT NULL',
  'type_occurrences.article_publication_precision text NOT NULL',
  'type_sheet_changes.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'type_sheet_changes.event_type_id text NOT NULL',
  'type_sheet_changes.changed_at timestamp with time zone NOT NULL DEFAULT now()',
  'type_sheet_changes.change_kind text NOT NULL',
  'type_sheet_changes.substantive_scope text',
  'type_sheet_changes.reason text',
  'type_sheet_changes.content_before jsonb NOT NULL',
  'type_sheet_changes.content_after jsonb NOT NULL',
  'type_sheet_changes.resulting_version_number smallint',
  'type_sheet_versions.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'type_sheet_versions.event_type_id text NOT NULL',
  'type_sheet_versions.version_number smallint NOT NULL',
  'type_sheet_versions.created_at timestamp with time zone NOT NULL DEFAULT now()',
  'type_sheet_versions.kind text NOT NULL',
  'type_sheet_versions.substantive_scope text',
  'type_sheet_versions.merge_covers_union boolean',
  'type_sheet_versions.is_broadening boolean NOT NULL DEFAULT false',
  'type_sheet_versions.reason text',
  'type_sheet_versions.content jsonb NOT NULL',
  'type_sheet_versions.requalified_conforming_count integer NOT NULL DEFAULT 0',
  'type_sheet_versions.reassigned_count integer NOT NULL DEFAULT 0',
  'type_sheet_versions.erased_count integer NOT NULL DEFAULT 0',
  'type_sheet_versions.supplementary_requests_proposed_count integer NOT NULL DEFAULT 0',
];

// Their indexes, primary keys and unique constraints included, in the words of the catalog.
const INDEXES = [
  'CREATE UNIQUE INDEX type_illustration_sources_pkey ON public.type_illustration_sources USING btree (id)',
  'CREATE INDEX type_occurrences_article_idx ON public.type_occurrences USING btree (article_url)',
  'CREATE UNIQUE INDEX type_occurrences_originating_key ON public.type_occurrences USING btree (event_type_id) WHERE is_originating_fact',
  'CREATE UNIQUE INDEX type_occurrences_pkey ON public.type_occurrences USING btree (id)',
  'CREATE INDEX type_occurrences_type_idx ON public.type_occurrences USING btree (event_type_id)',
  'CREATE UNIQUE INDEX type_sheet_changes_pkey ON public.type_sheet_changes USING btree (id)',
  "CREATE INDEX type_sheet_changes_switch_idx ON public.type_sheet_changes USING btree (changed_at) WHERE (change_kind = 'criterion_switch'::text)",
  'CREATE INDEX type_sheet_changes_type_idx ON public.type_sheet_changes USING btree (event_type_id, changed_at)',
  'CREATE UNIQUE INDEX type_sheet_versions_pkey ON public.type_sheet_versions USING btree (id)',
  'CREATE UNIQUE INDEX type_sheet_versions_type_number_key ON public.type_sheet_versions USING btree (event_type_id, version_number)',
];

// Their references, each with the ON DELETE rule of the model.
const FOREIGN_KEYS = [
  'type_illustration_sources FOREIGN KEY (event_type_id) REFERENCES event_types(id) ON DELETE CASCADE',
  'type_occurrences FOREIGN KEY (event_type_id) REFERENCES event_types(id) ON DELETE RESTRICT',
  'type_occurrences FOREIGN KEY (player_id) REFERENCES followed_players(id) ON DELETE CASCADE',
  'type_sheet_changes FOREIGN KEY (event_type_id) REFERENCES event_types(id) ON DELETE RESTRICT',
  'type_sheet_versions FOREIGN KEY (event_type_id) REFERENCES event_types(id) ON DELETE RESTRICT',
];

// A proposal of the scoping, and the same type validated with its complete sheet.
const PROPOSAL = { id: 'media-storm', origin: 'scoping', name: 'Media storm' } as const;
const SHEET = {
  definition: 'Wide coverage of one player in a short time.',
  inclusionCriteria: 'Three outlets within two days.',
  exclusionCriteria: 'The routine coverage of a game.',
  datingRule: 'The day of the first article.',
  genericExample: 'A player leads every sports page for two days.',
  documentationDifficulty: 'medium',
} as const;
const VALIDATED = { ...PROPOSAL, ...SHEET, status: 'validated', currentVersionNumber: 1 } as const;
// A value that no stored set of the model holds.
const OUTSIDE = sql`'outside'`;
// The content of a version, and of a sheet before and after a change.
const CONTENT = { name: 'Media storm', ...SHEET } as const;
const VERSION = {
  eventTypeId: 'media-storm',
  versionNumber: 1,
  kind: 'validation',
  content: CONTENT,
} as const;
const CHANGE = {
  eventTypeId: 'media-storm',
  changeKind: 'formal',
  contentBefore: CONTENT,
  contentAfter: CONTENT,
} as const;
const SUBSTANTIVE = { changeKind: 'substantive', resultingVersionNumber: 2 } as const;
// An occurrence's article, as published on 2026-11-18 at 07:30 UTC.
const ARTICLE = {
  eventTypeId: 'media-storm',
  articleUrl: 'https://news.example.org/2026/11/18/story',
  articlePublishedAt: new Date(toEpochMs(Date.UTC(2026, 10, 18, 7, 30))),
  articlePublicationPrecision: 'exact',
} as const;
// An invented followed player.
const PLAYER = { displayName: 'Tobin Marlowe', displayNameNormalized: 'tobin marlowe' } as const;

/** The error of a query that a CHECK constraint refused. */
const violationOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23514', constraint },
});

/** The error of a query that a unique constraint or index refused. */
const duplicateOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23505', constraint },
});

/** The error of a query that a foreign key refused. */
const referenceOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23503', constraint },
});

describe('the tables that hang off an event type', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    return database.close;
  }, 60_000);

  it('builds the columns, indexes and references that event-types.md gives these tables', async () => {
    await expect(describeColumns(db, TABLES)).resolves.toStrictEqual(COLUMNS);
    await expect(describeIndexes(db, TABLES)).resolves.toStrictEqual(INDEXES);
    await expect(describeForeignKeys(db, TABLES)).resolves.toStrictEqual(FOREIGN_KEYS);
  });

  it('[CL-TAX-06] numbers the versions of a type once each, a substantive one with its scope and a merge with its answer', async () => {
    await db.insert(eventTypes).values(VALIDATED);
    await db.insert(typeSheetVersions).values([
      VERSION,
      {
        ...VERSION,
        versionNumber: 2,
        kind: 'substantive_change',
        substantiveScope: 'both',
        isBroadening: true,
      },
      { ...VERSION, versionNumber: 3, kind: 'merge', mergeCoversUnion: false },
    ]);

    const again = db.insert(typeSheetVersions).values({ ...VERSION, versionNumber: 3 });

    await expect(again).rejects.toMatchObject(duplicateOf('type_sheet_versions_type_number_key'));
    await expect(
      db.select({ content: typeSheetVersions.content }).from(typeSheetVersions),
    ).resolves.toStrictEqual([{ content: CONTENT }, { content: CONTENT }, { content: CONTENT }]);
  });

  it('[CL-TAX-06] qualifies a substantive version, and its history entry, as broadening, narrowing or both', async () => {
    await db.insert(eventTypes).values(VALIDATED);
    const scopes = ['broadens', 'narrows', 'both'] as const;
    await db.insert(typeSheetVersions).values(
      scopes.map((substantiveScope, index) => ({
        ...VERSION,
        versionNumber: index + 2,
        kind: 'substantive_change' as const,
        substantiveScope,
      })),
    );
    await db.insert(typeSheetChanges).values(
      scopes.map((substantiveScope, index) => ({
        ...CHANGE,
        ...SUBSTANTIVE,
        substantiveScope,
        resultingVersionNumber: index + 2,
      })),
    );

    const versions = await db
      .select({ scope: typeSheetVersions.substantiveScope })
      .from(typeSheetVersions)
      .orderBy(typeSheetVersions.id);
    const changes = await db
      .select({ scope: typeSheetChanges.substantiveScope })
      .from(typeSheetChanges)
      .orderBy(typeSheetChanges.id);

    expect(versions).toStrictEqual(scopes.map((scope) => ({ scope })));
    expect(changes).toStrictEqual(versions);
  });

  // Each version breaks one clause of one check of type_sheet_versions.
  it.each([
    [
      'a substantive change without its scope',
      { kind: 'substantive_change' },
      'substantive_change',
    ],
    ['a validation with a scope', { substantiveScope: 'narrows' }, 'substantive_change'],
    ['a merge without its answer', { kind: 'merge' }, 'merge'],
    ['a validation with a merge answer', { mergeCoversUnion: true }, 'merge'],
    ['version 0', { versionNumber: 0 }, 'version_number'],
    ['of another kind', { kind: OUTSIDE }, 'kind'],
    [
      'of another scope',
      { kind: 'substantive_change', substantiveScope: OUTSIDE },
      'substantive_scope',
    ],
  ] as const)('refuses a sheet version that is %s', async (_version, change, check) => {
    await db.insert(eventTypes).values(VALIDATED);

    const insert = db.insert(typeSheetVersions).values({ ...VERSION, ...change });

    await expect(insert).rejects.toMatchObject(violationOf(`type_sheet_versions_${check}_check`));
  });

  it('[CL-TAX-17] keeps each change of a sheet with its content before and after, and a version for a substantive one', async () => {
    await db.insert(eventTypes).values(VALIDATED);
    await db.insert(typeSheetChanges).values([
      CHANGE,
      {
        ...CHANGE,
        changeKind: 'substantive',
        substantiveScope: 'broadens',
        resultingVersionNumber: 2,
      },
      { ...CHANGE, changeKind: 'criterion_switch' },
    ]);

    await expect(
      db.select({ kind: typeSheetChanges.changeKind }).from(typeSheetChanges),
    ).resolves.toStrictEqual([
      { kind: 'formal' },
      { kind: 'substantive' },
      { kind: 'criterion_switch' },
    ]);
  });

  // Each entry breaks one clause of one check of type_sheet_changes.
  it.each([
    [
      'a substantive change without its version',
      { changeKind: 'substantive' },
      'resulting_version',
    ],
    ['a formal change with a version', { resultingVersionNumber: 2 }, 'resulting_version'],
    ['a formal change with a scope', { substantiveScope: 'narrows' }, 'scoped_change'],
    ['of another kind', { changeKind: OUTSIDE }, 'change_kind'],
    ['of another scope', { ...SUBSTANTIVE, substantiveScope: OUTSIDE }, 'substantive_scope'],
  ] as const)('refuses a history entry that is %s', async (_entry, change, check) => {
    await db.insert(eventTypes).values(VALIDATED);

    const insert = db.insert(typeSheetChanges).values({ ...CHANGE, ...change });

    await expect(insert).rejects.toMatchObject(violationOf(`type_sheet_changes_${check}_check`));
  });

  it('[CL-TAX-16] keeps the illustration sources of a proposal with their dates as written, and drops them with it', async () => {
    await db.insert(eventTypes).values(PROPOSAL);
    const source = {
      eventTypeId: PROPOSAL.id,
      url: 'https://news.example.org/a',
      publicationDateOn: '2026-11-17',
    } as const;
    const timed = {
      publicationAt: ARTICLE.articlePublishedAt,
      publicationOffsetMinutes: -300,
    } as const;
    await db.insert(typeIllustrationSources).values([
      { ...source, position: 1, ...timed },
      { ...source, position: 2 },
    ]);

    const stored = await db
      .select({ offset: typeIllustrationSources.publicationOffsetMinutes })
      .from(typeIllustrationSources);
    await db.delete(eventTypes).where(eq(eventTypes.id, PROPOSAL.id));

    expect(stored).toStrictEqual([{ offset: -300 }, { offset: null }]);
    await expect(db.select().from(typeIllustrationSources)).resolves.toStrictEqual([]);
  });

  it.each([
    ['a time without its offset', { publicationAt: ARTICLE.articlePublishedAt }],
    ['an offset without its time', { publicationOffsetMinutes: -300 }],
  ])('[CL-IMP-09] refuses an illustration source dated with %s', async (_case, date) => {
    await db.insert(eventTypes).values(PROPOSAL);

    const insert = db.insert(typeIllustrationSources).values({
      eventTypeId: PROPOSAL.id,
      position: 1,
      url: 'https://news.example.org/a',
      publicationDateOn: '2026-11-17',
      ...date,
    });

    await expect(insert).rejects.toMatchObject(
      violationOf('type_illustration_sources_publication_check'),
    );
  });

  it('[VUE-04] attaches each fact of a type to exactly one followed player, and to none once he is deleted', async () => {
    await db.insert(eventTypes).values({ ...PROPOSAL, origin: 'detection' });
    const [player] = await db.insert(followedPlayers).values(PLAYER).returning();
    const playerId = player?.id ?? '';
    await db.insert(typeOccurrences).values({ ...ARTICLE, playerId, isOriginatingFact: true });

    const nobody = db.insert(typeOccurrences).values({ ...ARTICLE, playerId: sql`NULL` });
    const stranger = db
      .insert(typeOccurrences)
      .values({ ...ARTICLE, playerId: '5b0d2f8e-3c41-4f6a-9d7e-2a1c8b9e4f60' });

    await expect(nobody).rejects.toMatchObject({ cause: { code: '23502', column: 'player_id' } });
    await expect(stranger).rejects.toMatchObject(
      referenceOf('type_occurrences_player_id_followed_players_id_fk'),
    );
    await expect(
      db.select({ playerId: typeOccurrences.playerId }).from(typeOccurrences),
    ).resolves.toStrictEqual([{ playerId }]);
    await db.delete(followedPlayers).where(eq(followedPlayers.id, playerId));
    await expect(db.select().from(typeOccurrences)).resolves.toStrictEqual([]);
  });

  it('keeps one originating fact per type beside its later occurrences, each with a precision of the glossary', async () => {
    await db.insert(eventTypes).values({ ...PROPOSAL, origin: 'detection' });
    const [player] = await db.insert(followedPlayers).values(PLAYER).returning();
    const fact = { ...ARTICLE, playerId: player?.id ?? '' } as const;
    await db.insert(typeOccurrences).values([
      { ...fact, isOriginatingFact: true },
      { ...fact, articlePublicationPrecision: 'approximate' },
      { ...fact, articlePublicationPrecision: 'none' },
    ]);

    const secondOrigin = db.insert(typeOccurrences).values({ ...fact, isOriginatingFact: true });
    const vague = db
      .insert(typeOccurrences)
      .values({ ...fact, articlePublicationPrecision: OUTSIDE });

    await expect(secondOrigin).rejects.toMatchObject(
      duplicateOf('type_occurrences_originating_key'),
    );
    await expect(vague).rejects.toMatchObject(
      violationOf('type_occurrences_article_publication_precision_check'),
    );
  });
});
