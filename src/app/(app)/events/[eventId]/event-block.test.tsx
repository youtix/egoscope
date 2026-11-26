import { render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { and, eq, gt, inArray, or } from 'drizzle-orm';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import {
  createTestDatabase,
  eventCorrections,
  events,
  eventSources,
  games,
  parameterOverrides,
  teamSourceRefs,
} from '@/lib/db';
import {
  BIRTHDAY,
  birthdayOnNextGameDay,
  DATABASE_TEST_TIMEOUT_MS,
  insertBoxScores,
  insertCalendarType,
  insertDetectedEvent,
  insertEventType,
  insertHistoricalEvent,
  insertImport,
  insertLeagueSeason,
  insertPlayer,
  insertRequest,
} from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { EventBlock } from './event-block';

import type { Database, DatabaseResult, getDb } from '@/lib/db';

// The database that `getDb()` gives the block: each test serves one of its own.
const harness = vi.hoisted(() => ({ getDb: vi.fn<typeof getDb>() }));

vi.mock(import('@/lib/db'), async (importOriginal) => ({
  ...(await importOriginal()),
  getDb: harness.getDb,
}));

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };
const NOT_FOUND = 'NEXT_HTTP_ERROR_FALLBACK;404';
const AT = toEpochMs(Date.UTC(2026, 10, 26, 9));
const PLAYER = 'Ansel Varga';
// 18:30 UTC on 20 November 2024: 19:30 in Paris, 13:30 in New York.
const TIMED_REFERENCE = new Date(Date.UTC(2024, 10, 20, 18, 30));
const NEW_YORK_OFFSET_MINUTES = -300;
// Two corrections of a historical event, at 10:00 and 11:15 Paris time on 21 November 2024.
const FIRST_CORRECTION = new Date(Date.UTC(2024, 10, 21, 9));
const SECOND_CORRECTION = new Date(Date.UTC(2024, 10, 21, 10, 15));
const FORMER_TEAM = 'former-team';
// The second invented player moves from team 2 to team 3 on 3 November 2025.
const TRADE = new Date(Date.UTC(2025, 10, 3));

/** A database of the test's own, which the block reaches through `getDb()`. */
async function servedDatabase(): Promise<Database> {
  onTestFinished(installFakeClock(fixedClock(AT)));
  const database = await createTestDatabase();
  onTestFinished(database.close);
  harness.getDb.mockResolvedValue({ ok: true, db: database.db });
  return database.db;
}

/** A historical media storm of the first invented player, its columns as `overrides` give them. */
async function historicalEvent(db: Database, overrides: Partial<typeof events.$inferInsert> = {}) {
  const player = await insertPlayer(db);
  await insertEventType(db);
  const request = await insertRequest(db, { playerId: player.id });
  const imported = await insertImport(db, { request });
  const event = await insertHistoricalEvent(db, {
    playerId: player.id,
    originImportId: imported.id,
    overrides: { injuryReturn: 'yes', injuryReturnOrigin: 'research', ...overrides },
  });
  return { player, event };
}

/** The block of the event `eventId`, rendered. */
async function shown(eventId: number | string) {
  return render(await EventBlock({ eventId: String(eventId) }));
}

/** The block's terms or values, in their order, those of its sources left out. */
function outsideSources(role: 'term' | 'definition'): readonly HTMLElement[] {
  return screen.getAllByRole(role).filter((element) => element.closest('li') === null);
}

/** The block's facts, each its label and its value as read, in their order, those of its sources left out. */
function factsShown(): readonly (readonly [string, string])[] {
  const values = outsideSources('definition');
  return outsideSources('term').map((term, index) => [
    term.firstChild?.textContent ?? '',
    values[index]?.textContent ?? '',
  ]);
}

/** The labels of the block's facts, in their order. */
function factLabels(): readonly string[] {
  return factsShown().map(([label]) => label);
}

/** The value of the fact `label`, outside the sources. */
function fact(label: string): HTMLElement {
  const index = factLabels().indexOf(label);
  const value = outsideSources('definition')[index];
  if (value === undefined) {
    throw new Error(`The block shows no fact ${label}.`);
  }
  return value;
}

/** The entries of the correction history, as read. */
function historyEntries(): readonly (string | null)[] {
  return within(fact('Correction history'))
    .getAllByRole('listitem')
    .map((entry) => entry.textContent);
}

/** Every link of the block, its text and its target, in their order. */
function linksShown(): readonly (readonly [string | null, string | null])[] {
  return screen.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')]);
}

/** The events rows' writes of a test, its sources and corrections. */
const insertSources = (db: Database, values: (typeof eventSources.$inferInsert)[]) =>
  db.insert(eventSources).values(values);
const insertCorrections = (db: Database, values: (typeof eventCorrections.$inferInsert)[]) =>
  db.insert(eventCorrections).values(values);

describe('EventBlock', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  it('[IHM-67] [CA-VUE-04] shows a historical event: its one player, type, sheet version, date, description, sources, context, case and corrections', async () => {
    const db = await servedDatabase();
    const { player, event } = await historicalEvent(db);
    await insertSources(db, [
      {
        playerEventId: event.id,
        position: 1,
        url: 'https://news.example.com/herons/storm',
        cleanedUrl: 'https://news.example.com/herons/storm',
        outlet: 'Harbor Daily',
        title: 'Herons guard in every headline',
        publicationDateOn: '2024-11-20',
      },
      {
        playerEventId: event.id,
        position: 2,
        url: 'https://wire.example.org/a/1',
        cleanedUrl: 'https://wire.example.org/a/1',
        publicationDateOn: '2024-11-20',
        publicationAt: new Date(Date.UTC(2024, 10, 20, 20, 5)),
        publicationOffsetMinutes: 0,
      },
    ]);
    await insertCorrections(db, [
      { playerEventId: event.id, correctedAt: SECOND_CORRECTION, field: 'description' },
      { playerEventId: event.id, correctedAt: FIRST_CORRECTION, field: 'reference_date' },
    ]);

    await shown(event.id);

    const id = String(event.id);
    expect(factsShown()).toStrictEqual([
      ['Player', PLAYER],
      ['Type', 'Media storm'],
      ['Sheet version', '1'],
      ['Origin', 'Historical'],
      ['Reference date', 'Wednesday 20 November 2024'],
      ['Precision', 'Approximate'],
      ['Description', 'Every outlet covered the player on the same day.'],
      [
        'Sources',
        'Linkhttps://news.example.com/herons/stormOutletHarbor DailyTitleHerons guard in every headlinePublishedWed 20 Nov 2024' +
          'Linkhttps://wire.example.org/a/1PublishedWed 20 Nov 2024, 21:05',
      ],
      ['Return from injury', 'Yes (origin: Research)'],
      ['Game stakes', 'Unknown'],
      ['Case', 'Not in a case yet'],
      [
        'Correction history',
        'Thu 21 Nov 2024, 10:00 — Reference dateThu 21 Nov 2024, 11:15 — Description',
      ],
    ]);
    expect(linksShown()).toStrictEqual([
      [PLAYER, `/players/${player.id}`],
      ['Media storm', '/types/media-storm'],
      ['https://news.example.com/herons/storm', 'https://news.example.com/herons/storm'],
      ['https://wire.example.org/a/1', 'https://wire.example.org/a/1'],
      ['Correct the event', `/events/${id}/edit`],
      ['Withdraw and erase this event', `/events/${id}/withdraw`],
    ]);
    expect(historyEntries()).toStrictEqual([
      'Thu 21 Nov 2024, 10:00 — Reference date',
      'Thu 21 Nov 2024, 11:15 — Description',
    ]);
  });

  it('[IHM-67] [CL-IHM-04] dates a timed reference date in full in the owner’s zone, named, as exact', async () => {
    const db = await servedDatabase();
    const { event } = await historicalEvent(db, {
      referenceAt: TIMED_REFERENCE,
      referenceOffsetMinutes: NEW_YORK_OFFSET_MINUTES,
      referenceDatePrecision: 'exact',
    });
    await db
      .insert(parameterOverrides)
      .values({ parameterKey: 'display.timeZone', value: 'America/New_York' });

    await shown(event.id);

    expect(fact('Reference date')).toHaveTextContent(
      'Wednesday 20 November 2024, 13:30 New York time',
    );
    expect(fact('Precision')).toHaveTextContent('Exact');
  });

  it('[CA-DSN-03] [DSN-07] reads a return from injury as yes with its origin, and nothing about the injury', async () => {
    const db = await servedDatabase();
    const { event } = await historicalEvent(db, { gameStakes: 'high', gameStakesOrigin: 'user' });

    await shown(event.id);

    expect(fact('Return from injury')).toHaveTextContent(/^Yes \(origin: Research\)$/u);
    expect(fact('Game stakes')).toHaveTextContent(/^High \(origin: You\)$/u);
    expect(screen.queryByText(/injur/iu, { ignore: 'dt, dt *' })).not.toBeInTheDocument();
  });

  it('[IHM-15] renders the first label of a defined term as the glossary term that opens its definition', async () => {
    const db = await servedDatabase();
    const { event } = await historicalEvent(db);

    await shown(event.id);

    const button = screen.getByRole('button', { name: 'Player' });
    const opened = screen.getByText('An NBA player you put on the follow list.', { exact: true });
    expect(button).toHaveAttribute('popovertarget', opened.id);
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules', async () => {
    const db = await servedDatabase();
    const { event } = await historicalEvent(db);

    const { container } = await shown(event.id);

    await expect(axe.run(container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});

/** The first invented player's birthday game, with his box scores, so that his team games place him in it. */
async function birthdayEvent(db: Database) {
  const birthday = await birthdayOnNextGameDay(db);
  await insertBoxScores(db, { playerId: birthday.player.id, source: 'p01', season: '2026-27' });
  return birthday;
}

describe('EventBlock of a calendar-derived event', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  it('[IHM-67] [CA-VUE-04] [CL-IHM-21] [CL-VUE-15] shows the derived game and the basis of the derivation in place of sources, with only the context to correct', async () => {
    const db = await servedDatabase();
    const { player, event, tracked } = await birthdayEvent(db);
    await db
      .update(events)
      .set({ injuryReturn: 'yes', injuryReturnOrigin: 'user' })
      .where(eq(events.id, event.id));
    await insertCorrections(db, [
      {
        playerEventId: event.id,
        correctedAt: FIRST_CORRECTION,
        field: 'injury_return',
        beforeValue: 'unknown',
        afterValue: 'yes',
      },
    ]);

    await shown(event.id);

    const id = String(event.id);
    expect(factsShown()).toStrictEqual([
      ['Player', PLAYER],
      ['Type', "Player's birthday"],
      ['Sheet version', '1'],
      ['Origin', 'Derived from the calendar'],
      ['Reference date', 'Monday 26 October 2026, before tip-off'],
      ['Description', 'The player plays on his birthday.'],
      ['Derived game', 'Tuesday 27 October 2026, 00:30 Paris time — Monday evening in the US'],
      ['Opponent', 'Redstone Comets'],
      ['Home or away', 'Home'],
      ['Basis of the derivation', 'His recorded birthday, 26 October'],
      ['Return from injury', 'Yes (origin: You)'],
      ['Game stakes', 'Unknown'],
      ['Case', 'Awaiting game'],
      ['Correction history', 'Thu 21 Nov 2024, 10:00 — Return from injury, from Unknown to Yes'],
    ]);
    expect(linksShown()).toStrictEqual([
      [PLAYER, `/players/${player.id}`],
      ["Player's birthday", `/types/${BIRTHDAY}`],
      ['Awaiting game', `/cases/${String(tracked.id)}`],
      ['Correct the context', `/events/${id}/edit`],
      ['Withdraw and erase this event', `/events/${id}/withdraw`],
    ]);
  });

  it('[CL-VUE-15] shows a game without opponent nor side once his team games no longer place him in it', async () => {
    const db = await servedDatabase();
    const { event } = await birthdayOnNextGameDay(db);

    await shown(event.id);

    expect(fact('Derived game')).toHaveTextContent('Tuesday 27 October 2026, 00:30 Paris time');
    expect(factLabels()).not.toContain('Opponent');
    expect(factLabels()).not.toContain('Home or away');
    expect(fact('Basis of the derivation')).toHaveTextContent('His recorded birthday, 26 October');
  });

  it('[CL-VUE-15] [CL-TAX-18] bases a former-team event on his last game for that team', async () => {
    const db = await servedDatabase();
    await insertLeagueSeason(db, '2025-26');
    const player = await insertPlayer(db, { source: 'p02' });
    await insertBoxScores(db, { playerId: player.id, source: 'p02', season: '2025-26' });
    const type = await insertCalendarType(db, {
      id: FORMER_TEAM,
      name: 'First game against a former team',
      calendarDerivation: 'former_team',
    });
    const team = (ref: string) =>
      db
        .select({ id: teamSourceRefs.teamId })
        .from(teamSourceRefs)
        .where(eq(teamSourceRefs.sourceTeamRef, ref));
    const withComets = or(
      inArray(games.homeTeamId, team('3')),
      inArray(games.awayTeamId, team('3')),
    );
    const withLynx = or(inArray(games.homeTeamId, team('2')), inArray(games.awayTeamId, team('2')));
    // His first game with team 3 against team 2, after his trade of 3 November 2025.
    const [game] = await db
      .select({ id: games.id, on: games.gameDayOn })
      .from(games)
      .where(and(withComets, withLynx, gt(games.scheduledStartAt, TRADE)))
      .orderBy(games.scheduledStartAt);
    const [event] = await db
      .insert(events)
      .values({
        playerId: player.id,
        eventTypeId: FORMER_TEAM,
        sheetEventTypeId: FORMER_TEAM,
        sheetVersionNumber: type.currentVersionNumber ?? 1,
        origin: 'calendar',
        referenceDateOn: game?.on ?? '',
        description: 'The player faces his former team for the first time since leaving it.',
        derivedGameId: game?.id ?? 0,
      })
      .returning();

    await shown(event?.id ?? 0);

    expect(fact('Opponent')).toHaveTextContent('Pine Valley Lynx');
    expect(fact('Basis of the derivation')).toHaveTextContent(
      'His last game for Pine Valley Lynx, LAST',
    );
  });
});

describe('EventBlock of a detected event', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  it('[IHM-67] [CA-VUE-04] [CL-DSN-15] shows a detected event with the values its structured corrections kept, offering only its withdrawal', async () => {
    const db = await servedDatabase();
    const player = await insertPlayer(db);
    await insertEventType(db);
    await insertCalendarType(db);
    const event = await insertDetectedEvent(db, {
      playerId: player.id,
      overrides: { referenceAt: TIMED_REFERENCE, referenceDatePrecision: 'approximate' },
    });
    const at = FIRST_CORRECTION;
    await insertCorrections(db, [
      {
        playerEventId: event.id,
        correctedAt: at,
        field: 'event_type',
        beforeValue: BIRTHDAY,
        afterValue: 'media-storm',
      },
      {
        playerEventId: event.id,
        correctedAt: at,
        field: 'player',
        beforeValue: player.id,
        afterValue: player.id,
      },
      {
        playerEventId: event.id,
        correctedAt: at,
        field: 'reference_date',
        beforeValue: '2024-11-21T18:30:00.000Z exact earliest_source',
        afterValue: '2024-11-20T18:30:00.000Z approximate earliest_source',
      },
      {
        playerEventId: event.id,
        correctedAt: at,
        field: 'game_stakes',
        beforeValue: 'normal',
        afterValue: 'high',
      },
      { playerEventId: event.id, correctedAt: at, field: 'article_detached' },
    ]);

    await shown(event.id);

    const id = String(event.id);
    expect(factsShown()).toStrictEqual([
      ['Player', PLAYER],
      ['Type', 'Media storm'],
      ['Sheet version', '1'],
      ['Origin', 'Detected'],
      ['Reference date', 'Wednesday 20 November 2024, 19:30 Paris time'],
      ['Precision', 'Approximate'],
      ['Description', 'Every outlet covered the player on the same day.'],
      ['Return from injury', 'Unknown'],
      ['Game stakes', 'Unknown'],
      ['Case', 'Not in a case yet'],
      ['Correction history', historyEntries().join('')],
    ]);
    expect(linksShown()).toStrictEqual([
      [PLAYER, `/players/${player.id}`],
      ['Media storm', '/types/media-storm'],
      ['Withdraw and erase this event', `/events/${id}/withdraw`],
    ]);
    expect(historyEntries()).toStrictEqual([
      "Thu 21 Nov 2024, 10:00 — Type, from Player's birthday to Media storm",
      `Thu 21 Nov 2024, 10:00 — Player, from ${PLAYER} to ${PLAYER}`,
      'Thu 21 Nov 2024, 10:00 — Reference date, from Thu 21 Nov 2024, 19:30 (Exact) to Wed 20 Nov 2024, 19:30 (Approximate)',
      'Thu 21 Nov 2024, 10:00 — Game stakes, from Normal to High',
      'Thu 21 Nov 2024, 10:00 — Article detached',
    ]);
  });
});

describe(
  'EventBlock of an identifier that matches no event',
  { timeout: DATABASE_TEST_TIMEOUT_MS },
  () => {
    it.each(['12', 'twelve', '0', '012', '2147483648', '1.5'])(
      '[CL-DSN-05] [CL-IHM-19] shows the generic page for %s',
      async (eventId) => {
        await servedDatabase();

        await expect(EventBlock({ eventId })).rejects.toHaveProperty('digest', NOT_FOUND);
      },
    );

    it('says the event cannot be read while the database cannot be reached', async () => {
      const unreachable: DatabaseResult = { ok: false, error: { kind: 'database-not-configured' } };
      harness.getDb.mockResolvedValue(unreachable);

      await shown(12);

      expect(
        screen.getByText('The app cannot read this event right now: try again in a few minutes.'),
      ).toBeVisible();
    });
  },
);
