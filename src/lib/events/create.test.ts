import { eq, inArray, sql } from 'drizzle-orm';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createTestDatabase, events, games } from '@/lib/db';
import { resetParam, setParam } from '@/lib/params';
import {
  BIRTHDAY,
  DATABASE_TEST_TIMEOUT_MS,
  insertCalendarType,
  insertEventType,
  insertImport,
  insertLeagueSeason,
  insertPlayer,
  insertRequest,
  MEDIA_STORM,
} from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs, toIsoDate } from '@/lib/time';

import { createCalendarDerived, createHistorical } from './create';
import { getEvent } from './queries';

import type { NewCalendarDerivedEvent, NewHistoricalEvent } from './create';
import type { NewSource } from './sources';
import type { Database } from '@/lib/db';
import type { PlayerRow } from '@/lib/testing';

const START = toEpochMs(Date.UTC(2026, 10, 25, 9, 0));
// The default of `events.maxDescriptionLength`.
const MAX_LENGTH = 200;
// The quotation marks of CL-DSN-03, and the apostrophes that pass.
const QUOTATION_MARKS = ['"', '«', '»', '“', '”', '„', '‟'] as const;
const APOSTROPHES = ["'", '’'] as const;
const DESCRIPTION =
  'An opponent publicly says that the player is overrated; a national outlet reports it the day before the game.';
const SOURCE: NewSource = {
  url: 'https://news.example.test/2024/11/20/forward-under-fire?utm_source=feed',
  cleanedUrl: 'https://news.example.test/2024/11/20/forward-under-fire',
  outlet: 'Example News',
  title: 'Forward under fire after a week of headlines',
  publicationDate: { on: toIsoDate('2024-11-20'), at: null },
};
const UNKNOWN_CONTEXT = {
  injuryReturn: { value: 'unknown', origin: null },
  gameStakes: { value: 'unknown', origin: null },
} as const;

// The columns of each table of the event record, grouped by the item of DSN-06, or of
// CL-DSN-20 for a calendar-derived event, that they hold.
const EVENT_COLUMNS = [
  // The followed player, the type and its sheet version.
  ['player_id', 'event_type_id', 'sheet_event_type_id', 'sheet_version_number'],
  // The reference date and its precision, and the rule that dates a detected event.
  ['reference_date_on', 'reference_at', 'reference_offset_minutes'],
  ['reference_date_precision', 'reference_date_rule'],
  // The short description, then the context indicators with their origins.
  ['description', 'injury_return', 'injury_return_origin', 'game_stakes', 'game_stakes_origin'],
  // The detection or research confidence.
  ['detection_confidence', 'research_confidence'],
  // The marks and dating checks: precedence and the reservation (the warnings have a table).
  ['precedence', 'unverified_note'],
  // The game that stands for the sources of a calendar-derived event (CL-DSN-20).
  ['derived_game_id'],
  // Management data: origin, state, instants, classification, dismissal, trace, mentions.
  ['id', 'origin', 'detected_status', 'created_at', 'updated_at', 'row_version', 'case_id'],
  ['classification_origin', 'dismissal_reason', 'dismissal_comment', 'dismissed_at'],
  ['origin_import_id', 'type_link_mark'],
].flat();
const SOURCE_COLUMNS = [
  // Each source reduced to its link, outlet, title and publication date.
  ['url', 'cleaned_url', 'outlet', 'title', 'publication_date_on', 'publication_at'],
  ['publication_offset_minutes', 'publication_precision', 'position'],
  // The dating checks of the import: link check and spot check.
  ['link_status', 'link_checked_at', 'spot_check_verdict'],
  // Management data.
  ['id', 'player_event_id', 'added_by_import_id', 'added_at'],
].flat();
const WARNING_COLUMNS = [
  // The import warnings, naming a source by position and another event by reference.
  ['id', 'player_event_id', 'import_id', 'kind', 'field', 'source_drop_cause'],
  ['related_position', 'related_player_event_id'],
].flat();

const columnRow = z.object({ name: z.string() });
const columnRows = z.object({ rows: z.array(columnRow) });

describe('the creation of events', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let close: () => Promise<void>;
  let restoreClock: () => void;
  let player: PlayerRow;
  let importId: number;

  beforeAll(async () => {
    const database = await createTestDatabase();
    ({ db, close } = database);
    restoreClock = installFakeClock(fixedClock(START));
    player = await insertPlayer(db);
    await insertEventType(db);
    const request = await insertRequest(db, { playerId: player.id });
    ({ id: importId } = await insertImport(db, { request }));
  }, DATABASE_TEST_TIMEOUT_MS);

  afterAll(async () => {
    restoreClock();
    await close();
  });

  /** A historical media storm of the player, dated to the day, with one source. */
  function historical(overrides: Partial<NewHistoricalEvent> = {}): NewHistoricalEvent {
    return {
      playerId: player.id,
      eventTypeId: MEDIA_STORM,
      sheetEventTypeId: MEDIA_STORM,
      sheetVersionNumber: 1,
      referenceDate: { on: toIsoDate('2024-11-20'), at: null },
      description: DESCRIPTION,
      context: UNKNOWN_CONTEXT,
      researchConfidence: 'high',
      unverifiedNote: null,
      precedence: 'to_verify',
      sources: [SOURCE],
      warnings: [],
      ...overrides,
    };
  }

  /** Saves `batch` as the events of the import, in a transaction of its own. */
  async function save(batch: readonly NewHistoricalEvent[]) {
    return db.transaction(async (tx) => createHistorical(tx, { importId, events: batch }));
  }

  /** Saves `batch` and gives the identifiers of its events. */
  async function saveIds(batch: readonly NewHistoricalEvent[]): Promise<readonly number[]> {
    const saved = await save(batch);
    expect(saved.ok).toBe(true);
    return saved.ok ? saved.value.map(({ playerEventId }) => playerEventId) : [];
  }

  /** Creates a calendar-derived event in a transaction of its own. */
  async function derive(event: NewCalendarDerivedEvent) {
    return db.transaction(async (tx) => createCalendarDerived(tx, event));
  }

  async function columnsOf(table: string): Promise<ReadonlySet<string>> {
    const result = await db.execute(
      sql`SELECT column_name AS name FROM information_schema.columns WHERE table_name = ${table}`,
    );
    const { rows } = columnRows.parse(result);
    return new Set(rows.map((row) => row.name));
  }

  it('[DSN-06] [CA-DSN-02] gives the event record no column outside the DSN-06 list', async () => {
    expect(await columnsOf('events')).toStrictEqual(new Set(EVENT_COLUMNS));
    expect(await columnsOf('event_sources')).toStrictEqual(new Set(SOURCE_COLUMNS));
    expect(await columnsOf('event_import_warnings')).toStrictEqual(new Set(WARNING_COLUMNS));
  });

  it('[DSN-06] [DSN-07] [CA-DSN-02] reads back a historical event holding its DSN-06 items and nothing else', async () => {
    const timed = {
      on: toIsoDate('2024-11-20'),
      at: toEpochMs(Date.UTC(2024, 10, 21, 1, 30)),
      offsetMinutes: -300,
    };
    const context = {
      injuryReturn: { value: 'yes', origin: 'research' },
      gameStakes: { value: 'high', origin: 'user' },
    } as const;
    const note = 'The date of the second article could not be confirmed.';
    const saved = await save([
      historical({
        referenceDate: timed,
        context,
        researchConfidence: 'medium',
        unverifiedNote: note,
        precedence: 'established',
        sources: [{ ...SOURCE, publicationDate: timed }],
      }),
    ]);
    const [created] = saved.ok ? saved.value : [];
    const playerEvent = await getEvent(db, created?.playerEventId ?? 0);

    expect(created?.sourceIds).toHaveLength(1);
    expect(playerEvent).toStrictEqual({
      playerEventId: created?.playerEventId,
      origin: 'historical',
      playerId: player.id,
      eventTypeId: MEDIA_STORM,
      sheetEventTypeId: MEDIA_STORM,
      sheetVersionNumber: 1,
      typeLinkMark: null,
      referenceDate: timed,
      description: DESCRIPTION,
      context,
      researchConfidence: 'medium',
      unverifiedNote: note,
      precedence: 'established',
      originImportId: importId,
      caseId: null,
      createdAt: START,
      updatedAt: START,
      rowVersion: 1,
      sources: [
        {
          sourceId: created?.sourceIds[0],
          position: 1,
          ...SOURCE,
          publicationDate: timed,
          addedByImportId: importId,
          addedAt: START,
          linkStatus: null,
          linkCheckedAt: null,
          spotCheckVerdict: null,
        },
      ],
      importWarnings: [],
    });
  });

  it('[DSN-07] stores the context as indicators only, never the narrative the result may hold', async () => {
    const narrative = 'He played with a brace on his left knee after three weeks out.';
    const [playerEventId = 0, otherId = 0] = await saveIds([
      historical({
        context: {
          // @ts-expect-error -- an indication has no field for the result's precision.
          injuryReturn: { value: 'yes', origin: 'research', detail: narrative },
          gameStakes: { value: 'normal', origin: 'classification' },
        },
      }),
      historical({
        precedence: 'uncertain',
        // @ts-expect-error -- an event has no field for a context narrative.
        detail: narrative,
      }),
    ]);
    const rows = await db
      .select()
      .from(events)
      .where(inArray(events.id, [playerEventId, otherId]));
    const playerEvent = await getEvent(db, playerEventId);

    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toContain(narrative);
    expect(playerEvent?.context).toStrictEqual({
      injuryReturn: { value: 'yes', origin: 'research' },
      gameStakes: { value: 'normal', origin: 'classification' },
    });
  });

  it('[DSN-20] refuses a description or an unverified note longer than events.maxDescriptionLength, writing nothing', async () => {
    const before = await db.$count(events);
    const tooLong = await save([historical({ description: 'a'.repeat(MAX_LENGTH + 1) })]);
    const noteTooLong = await save([
      historical(),
      historical({ unverifiedNote: ` ${'b'.repeat(MAX_LENGTH + 1)} ` }),
    ]);
    const atTheLimit = await save([historical({ description: 'c'.repeat(MAX_LENGTH) })]);
    const breaches = [{ kind: 'too_long', length: MAX_LENGTH + 1, maxLength: MAX_LENGTH }];

    expect(tooLong).toStrictEqual({
      ok: false,
      error: { kind: 'text_refused', field: 'description', breaches, eventIndex: 0 },
    });
    expect(noteTooLong).toStrictEqual({
      ok: false,
      error: { kind: 'text_refused', field: 'unverified_note', breaches, eventIndex: 1 },
    });
    expect(atTheLimit.ok).toBe(true);
    expect(await db.$count(events)).toBe(before + 1);
  });

  it('[DSN-20] applies a changed maximum length from the next call', async () => {
    const shorter = 150;
    const description = 'd'.repeat(shorter + 1);
    const before = await save([historical({ description })]);
    await db.transaction(async (tx) =>
      setParam(tx, { key: 'events.maxDescriptionLength', value: shorter, expectedVersion: 0 }),
    );
    const after = await save([historical({ description })]);
    const reset = await db.transaction(async (tx) =>
      resetParam(tx, { key: 'events.maxDescriptionLength', expectedVersion: 1 }),
    );

    expect(reset.ok).toBe(true);
    expect(before.ok).toBe(true);
    expect(after).toStrictEqual({
      ok: false,
      error: {
        kind: 'text_refused',
        field: 'description',
        breaches: [{ kind: 'too_long', length: shorter + 1, maxLength: shorter }],
        eventIndex: 0,
      },
    });
  });

  // Words of a description, with no quotation mark.
  const words = fc.string({
    unit: fc.constantFrom('a', 'B', 'z', '1', ' ', '.', ',', ';', '-', '(', ')', 'é'),
    minLength: 1,
    maxLength: 40,
  });
  const quoted = fc.record({
    head: words,
    apostrophe: fc.constantFrom(...APOSTROPHES),
    mark: fc.constantFrom(...QUOTATION_MARKS),
    tail: words,
    inNote: fc.boolean(),
  });

  it('[DSN-21] refuses a description or a note holding a quotation mark of CL-DSN-03, naming it', async () => {
    await fc.assert(
      fc.asyncProperty(quoted, async ({ head, apostrophe, mark, tail, inNote }) => {
        const text = `${head}${apostrophe}${mark}${tail}`;
        const refused = await save([
          historical(inNote ? { unverifiedNote: text } : { description: text }),
        ]);
        expect(refused).toStrictEqual({
          ok: false,
          error: {
            kind: 'text_refused',
            field: inNote ? 'unverified_note' : 'description',
            breaches: [{ kind: 'quotation_mark', character: mark }],
            eventIndex: 0,
          },
        });
      }),
      { numRuns: 40 },
    );
  });

  it('[DSN-21] accepts straight and typographic apostrophes', async () => {
    await fc.assert(
      fc.asyncProperty(words, fc.constantFrom(...APOSTROPHES), words, async (head, mark, tail) => {
        const text = `${head}${mark}${tail}`;
        const saved = await save([historical({ description: text, unverifiedNote: text })]);
        expect(saved.ok).toBe(true);
      }),
      { numRuns: 15 },
    );
  });

  it('[DSN-06] stores the import warnings once every event is saved, a shared link naming the other event', async () => {
    const [recorded = 0] = await saveIds([historical()]);
    const [first = 0, second = 0] = await saveIds([
      historical({
        warnings: [
          { kind: 'source_dropped', sourceDropCause: 'home_page', relatedPosition: 2 },
          { kind: 'text_too_long_ignored', field: 'unverified_note' },
        ],
      }),
      historical({
        warnings: [
          { kind: 'shared_link', sharedWith: { eventIndex: 0 } },
          { kind: 'shared_link', sharedWith: { playerEventId: recorded } },
          { kind: 'confidence_defaulted' },
        ],
      }),
    ]);
    const none = { importId, field: null, sourceDropCause: null, relatedPosition: null };
    const unrelated = { ...none, relatedPlayerEventId: null };
    const [withDrop, withLinks] = [await getEvent(db, first), await getEvent(db, second)];

    expect(withDrop?.origin === 'historical' ? withDrop.importWarnings : null).toStrictEqual([
      { ...unrelated, kind: 'source_dropped', sourceDropCause: 'home_page', relatedPosition: 2 },
      { ...unrelated, kind: 'text_too_long_ignored', field: 'unverified_note' },
    ]);
    expect(withLinks?.origin === 'historical' ? withLinks.importWarnings : null).toStrictEqual([
      { ...none, kind: 'shared_link', relatedPlayerEventId: first },
      { ...none, kind: 'shared_link', relatedPlayerEventId: recorded },
      { ...unrelated, kind: 'confidence_defaulted' },
    ]);
  });

  it('refuses, as a bug, a shared link to an event outside the import', async () => {
    await expect(
      save([historical({ warnings: [{ kind: 'shared_link', sharedWith: { eventIndex: 1 } }] })]),
    ).rejects.toThrow(new RangeError('No event of the import has the index 1.'));
  });

  it('saves nothing for an import without events', async () => {
    expect(await save([])).toStrictEqual({ ok: true, value: [] });
  });

  describe('of calendar-derived events', () => {
    let birthdayGame: number;
    let otherGame: number;
    let gameDay: string;

    beforeAll(async () => {
      await insertCalendarType(db);
      const season = await insertLeagueSeason(db, '2024-25');
      [birthdayGame = 0, otherGame = 0] = season.values();
      const [game] = await db
        .select({ day: games.gameDayOn })
        .from(games)
        .where(eq(games.id, birthdayGame));
      gameDay = game?.day ?? '';
    }, DATABASE_TEST_TIMEOUT_MS);

    function derived(overrides: Partial<NewCalendarDerivedEvent> = {}): NewCalendarDerivedEvent {
      return {
        playerId: player.id,
        eventTypeId: BIRTHDAY,
        sheetVersionNumber: 1,
        derivedGameId: birthdayGame,
        description: { template: 'birthday', player: player.displayName },
        ...overrides,
      };
    }

    it('[DSN-06] [CA-DSN-02] holds only what CL-DSN-20 lists, dated by its game and with an unknown context', async () => {
      const created = await derive(derived());
      const playerEventId = created.ok ? created.value.playerEvent.playerEventId : 0;
      const expected = {
        playerEventId,
        origin: 'calendar',
        playerId: player.id,
        eventTypeId: BIRTHDAY,
        sheetEventTypeId: BIRTHDAY,
        sheetVersionNumber: 1,
        referenceDate: gameDay,
        derivedGameId: birthdayGame,
        description: `${player.displayName} plays on his birthday.`,
        context: UNKNOWN_CONTEXT,
        caseId: null,
        createdAt: START,
        updatedAt: START,
        rowVersion: 1,
      };

      expect(created).toStrictEqual({ ok: true, value: { playerEvent: expected, created: true } });
      expect(await getEvent(db, playerEventId)).toStrictEqual(expected);
    });

    it('[DSN-06] is idempotent per player, type and game, giving back the event recorded', async () => {
      const first = await derive(derived({ derivedGameId: otherGame }));
      const again = await derive(derived({ derivedGameId: otherGame }));
      const rows = await db.$count(events, eq(events.derivedGameId, otherGame));

      expect(first.ok).toBe(true);
      expect(again).toStrictEqual(
        first.ok ? { ok: true, value: { ...first.value, created: false } } : first,
      );
      expect(rows).toBe(1);
    });

    it('[DSN-06] writes the former-team template, naming the player and that team only', async () => {
      const former = await insertCalendarType(db, {
        id: 'former-team',
        name: 'First game against a former team',
        calendarDerivation: 'former_team',
      });
      const created = await derive(
        derived({
          eventTypeId: former.id,
          description: {
            template: 'former_team',
            player: player.displayName,
            team: 'Harbor Pilots',
          },
        }),
      );

      expect(created.ok ? created.value.playerEvent.description : null).toBe(
        `${player.displayName} faces his former team Harbor Pilots for the first time since leaving it.`,
      );
    });

    it('[DSN-20] [DSN-21] checks the template description like any other', async () => {
      const longName = 'e'.repeat(MAX_LENGTH);
      const tooLong = await derive(
        derived({ description: { template: 'birthday', player: longName } }),
      );
      const nickname = `${player.displayName} “The Wall”`;
      const withQuote = await derive(
        derived({ description: { template: 'birthday', player: nickname } }),
      );
      const length = `${longName} plays on his birthday.`.length;

      expect(tooLong).toStrictEqual({
        ok: false,
        error: {
          kind: 'text_refused',
          field: 'description',
          breaches: [{ kind: 'too_long', length, maxLength: MAX_LENGTH }],
        },
      });
      expect(withQuote).toStrictEqual({
        ok: false,
        error: {
          kind: 'text_refused',
          field: 'description',
          breaches: [{ kind: 'quotation_mark', character: '“' }],
        },
      });
    });
  });
});
