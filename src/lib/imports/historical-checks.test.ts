import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, onTestFinished } from 'vitest';

import { createTestDatabase, eventSources, parameterOverrides, playerIndicators } from '@/lib/db';
import { getEvent } from '@/lib/events';
import {
  DATABASE_TEST_TIMEOUT_MS,
  insertCalendarType,
  insertEventType,
  insertHistoricalEvent,
  insertImport,
  insertLeagueSeason,
  insertPlayer,
  insertRequest,
} from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { checkedCorrection } from './historical-checks';

import type { HistoricalCorrection, TypedDate, TypedSource } from './historical-checks';
import type { Database } from '@/lib/db';

const AT = toEpochMs(Date.UTC(2026, 10, 25, 9, 30));
const VERSION = 1;
const STORED_LINK = 'https://news.example.com/2024/11/20/storm';
const KEPT_LINK = 'https://daily.example.org/storm';
const NEW_LINK = 'https://third.example.net/a';

/** A date-only typed date. */
function day(on: string): TypedDate {
  return { on, time: null, timeZone: null };
}

/** A typed source of `url`, published on the day `on`. */
function typedSource(url: string, on: string): TypedSource {
  return { url, outlet: ' Daily ', title: null, publication: day(on) };
}

const FOUR_SOURCES = ['a', 'b', 'c', 'd'].map((path) =>
  typedSource(`${NEW_LINK}/${path}`, '2024-11-20'),
);

describe('checkedCorrection', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let playerId: string;
  let eventId: number;

  /** The checked correction of the stored event with `changes`. */
  async function check(changes: Omit<HistoricalCorrection, 'expectedVersion'>) {
    return db.transaction(async (tx) => {
      const event = await getEvent(tx, eventId);
      if (event?.origin !== 'historical') {
        throw new Error('The historical event is missing.');
      }
      return checkedCorrection(tx, event, { ...changes, expectedVersion: VERSION });
    });
  }

  /** The problems of a correction that fails its checks. */
  async function problemsOf(changes: Omit<HistoricalCorrection, 'expectedVersion'>) {
    const outcome = await check(changes);
    return outcome.ok ? outcome.value : outcome.error.problems;
  }

  beforeEach(async () => {
    onTestFinished(installFakeClock(fixedClock(AT)));
    const database = await createTestDatabase();
    db = database.db;
    onTestFinished(database.close);
    await insertEventType(db);
    ({ id: playerId } = await insertPlayer(db));
    const imported = await insertImport(db, { request: await insertRequest(db, { playerId }) });
    ({ id: eventId } = await insertHistoricalEvent(db, { playerId, originImportId: imported.id }));
    await db.insert(eventSources).values({
      playerEventId: eventId,
      position: 1,
      url: STORED_LINK,
      cleanedUrl: STORED_LINK,
      publicationDateOn: '2024-11-20',
      addedAt: new Date(AT),
    });
  }, DATABASE_TEST_TIMEOUT_MS);

  it('[IMP-32] passes the fields given on, and none of those left out', async () => {
    await expect(
      check({
        description: 'A new description.',
        researchConfidence: 'medium',
        unverifiedNote: null,
      }),
    ).resolves.toStrictEqual({
      ok: true,
      value: {
        description: 'A new description.',
        researchConfidence: 'medium',
        unverifiedNote: null,
        expectedVersion: VERSION,
      },
    });
  });

  it('[IMP-32] [CL-IMP-31] sets the career end at the owner day of the correction', async () => {
    await expect(
      problemsOf({
        publicDate: day('2026-11-26'),
        sources: [typedSource(KEPT_LINK, '2026-11-25')],
      }),
    ).resolves.toStrictEqual([{ kind: 'ignored', reason: 'outside_requested_period' }]);
    await expect(
      problemsOf({
        publicDate: day('2026-11-25'),
        sources: [typedSource(KEPT_LINK, '2026-11-25')],
      }),
    ).resolves.toMatchObject({ publicDate: { on: '2026-11-25', at: null } });
  });

  it('[IMP-32] [CL-IMP-31] has no lower bound while the first NBA game is unknown, and then starts at that game', async () => {
    const ancient = {
      publicDate: day('1990-05-01'),
      sources: [typedSource(KEPT_LINK, '1990-05-01')],
    };
    await expect(check(ancient)).resolves.toMatchObject({ ok: true });

    const games = await insertLeagueSeason(db, '2024-25');
    const [gameId] = games.values();
    await db.insert(playerIndicators).values({
      playerId,
      indicatorSeason: '2024-25',
      gamesPlayedThisSeason: 0,
      firstNbaGameId: gameId,
      firstNbaGameOn: '2024-10-22',
      computedAt: new Date(AT),
    });
    await expect(problemsOf(ancient)).resolves.toStrictEqual([
      { kind: 'ignored', reason: 'before_first_nba_game' },
    ]);
    await expect(
      check({ publicDate: day('2024-10-22'), sources: [typedSource(KEPT_LINK, '2024-10-22')] }),
    ).resolves.toMatchObject({ ok: true });
  });

  it.each([
    [
      'an unknown type',
      { eventTypeId: 'no-such-type' },
      [{ kind: 'refused', refusal: { reason: 'type_unknown' } }],
    ],
    [
      'a description left empty',
      { description: ' '.repeat(3) },
      [{ kind: 'refused', refusal: { reason: 'description_missing' } }],
    ],
    [
      'a source on a disallowed domain beside a kept one',
      {
        sources: [
          typedSource(KEPT_LINK, '2024-11-20'),
          typedSource('https://reddit.com/r/hoops/1', '2024-11-20'),
        ],
      },
      [{ kind: 'source_dropped', position: 2, cause: 'disallowed_domain' }],
    ],
    [
      'a source published after the day of the correction',
      { sources: [typedSource(KEPT_LINK, '2024-11-20'), typedSource(NEW_LINK, '2026-11-27')] },
      [{ kind: 'source_dropped', position: 2, cause: 'publication_date_in_future' }],
    ],
    [
      'a refused description and a dropped source together',
      {
        description: 'He said "never again".',
        sources: [
          typedSource(KEPT_LINK, '2024-11-20'),
          typedSource('https://news.example.com/', '2024-11-20'),
        ],
      },
      [
        { kind: 'refused', refusal: { reason: 'description_quotation_mark', character: '"' } },
        { kind: 'source_dropped', position: 2, cause: 'home_page' },
      ],
    ],
    [
      'more sources than an import keeps',
      { sources: FOUR_SOURCES },
      [{ kind: 'too_many_sources', maxSourcesPerEvent: 3 }],
    ],
    [
      'a refused event with more sources than an import keeps',
      { sources: FOUR_SOURCES, description: '"Quoted"' },
      [
        { kind: 'refused', refusal: { reason: 'description_quotation_mark', character: '"' } },
        { kind: 'too_many_sources', maxSourcesPerEvent: 3 },
      ],
    ],
    [
      'a day that does not exist',
      { publicDate: day('2021-02-30') },
      [{ kind: 'refused', refusal: { reason: 'public_date_nonexistent' } }],
    ],
    [
      'a day in another form',
      { publicDate: day('20/11/2024') },
      [{ kind: 'refused', refusal: { reason: 'public_date_malformed' } }],
    ],
    [
      'a time that no clock shows',
      { publicDate: { on: '2024-11-20', time: '24:00', timeZone: null } },
      [{ kind: 'refused', refusal: { reason: 'public_date_nonexistent' } }],
    ],
    [
      'a time in another form',
      { publicDate: { on: '2024-11-20', time: '8pm', timeZone: null } },
      [{ kind: 'refused', refusal: { reason: 'public_date_malformed' } }],
    ],
    [
      'an unknown zone',
      { publicDate: { on: '2024-11-20', time: '20:30', timeZone: 'Mars/Base' } },
      [{ kind: 'refused', refusal: { reason: 'public_date_malformed' } }],
    ],
    [
      'a source dated in another form',
      { sources: [typedSource(KEPT_LINK, '2024-11-20'), typedSource(NEW_LINK, 'Nov 20')] },
      [{ kind: 'source_dropped', position: 2, cause: 'publication_date_malformed' }],
    ],
  ] as const)(
    '[IMP-32] [IMP-12] [IMP-13] [IMP-14] fails %s with the code of the import',
    async (_case, changes, problems) => {
      await expect(check(changes)).resolves.toStrictEqual({
        ok: false,
        error: { kind: 'failed_checks', problems },
      });
    },
  );

  it('[IMP-32] [IMP-11] fails a type that is not validated today, or calendar-derived, as the import ignores it', async () => {
    await insertEventType(db, { id: 'trade-rumor', status: 'proposed' });
    await insertCalendarType(db);

    await expect(problemsOf({ eventTypeId: 'trade-rumor' })).resolves.toStrictEqual([
      { kind: 'ignored', reason: 'type_not_validated' },
    ]);
    await expect(
      problemsOf({ eventTypeId: 'birthday', sources: FOUR_SOURCES }),
    ).resolves.toStrictEqual([
      { kind: 'ignored', reason: 'calendar_derived_type' },
      { kind: 'too_many_sources', maxSourcesPerEvent: 3 },
    ]);
  });

  it('[CL-IMP-31] reads a typed time in the owner zone by default, or in the zone given, 00:00 being a real time', async () => {
    await db
      .insert(parameterOverrides)
      .values({ parameterKey: 'display.timeZone', value: 'America/Chicago' });

    await expect(
      check({ publicDate: { on: '2024-11-20', time: '20:30', timeZone: null } }),
    ).resolves.toStrictEqual({
      ok: true,
      value: {
        expectedVersion: VERSION,
        publicDate: { on: '2024-11-20', at: Date.UTC(2024, 10, 21, 2, 30), offsetMinutes: -360 },
      },
    });
    await expect(
      check({ publicDate: { on: '2024-11-20', time: '00:00', timeZone: 'Asia/Tokyo' } }),
    ).resolves.toMatchObject({
      value: {
        publicDate: { on: '2024-11-20', at: Date.UTC(2024, 10, 19, 15), offsetMinutes: 540 },
      },
    });
  });

  it('[IMP-32] [CL-IMP-14] [CL-IMP-16] gives the sources trimmed, with their cleaned links and dates, oldest first', async () => {
    const timed = {
      ...typedSource(` ${KEPT_LINK}?utm_source=feed&id=7 `, '2024-11-20'),
      publication: { on: '2024-11-20', time: '18:00', timeZone: 'America/New_York' },
    };

    await expect(
      check({
        sources: [
          typedSource(STORED_LINK, '2024-11-20'),
          timed,
          typedSource(NEW_LINK, '2024-11-19'),
        ],
      }),
    ).resolves.toStrictEqual({
      ok: true,
      value: {
        expectedVersion: VERSION,
        sources: [
          {
            url: NEW_LINK,
            cleanedUrl: NEW_LINK,
            outlet: 'Daily',
            title: null,
            publication: { on: '2024-11-19', at: null },
          },
          {
            url: `${KEPT_LINK}?utm_source=feed&id=7`,
            cleanedUrl: `${KEPT_LINK}?id=7`,
            outlet: 'Daily',
            title: null,
            publication: { on: '2024-11-20', at: Date.UTC(2024, 10, 20, 23), offsetMinutes: -300 },
          },
          {
            url: STORED_LINK,
            cleanedUrl: STORED_LINK,
            outlet: 'Daily',
            title: null,
            publication: { on: '2024-11-20', at: null },
          },
        ],
      },
    });
  });

  it('[IMP-14] [CL-IMP-11] checks a new public date against the stored sources, timed or not', async () => {
    await expect(problemsOf({ publicDate: day('2024-11-25') })).resolves.toStrictEqual([
      { kind: 'refused', refusal: { reason: 'source_before_public_date', sourcePosition: 1 } },
    ]);
    await db
      .update(eventSources)
      .set({ publicationAt: new Date(Date.UTC(2024, 10, 20, 12)), publicationOffsetMinutes: 0 })
      .where(eq(eventSources.playerEventId, eventId));
    await expect(problemsOf({ publicDate: day('2024-11-23') })).resolves.toStrictEqual([
      { kind: 'refused', refusal: { reason: 'source_before_public_date', sourcePosition: 1 } },
    ]);
    await expect(check({ publicDate: day('2024-11-22') })).resolves.toMatchObject({ ok: true });
  });
});
