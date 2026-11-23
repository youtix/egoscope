import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { parseTimestamp, toIsoDate } from '@/lib/time';

import { CsvReader } from './sportsdataverse-csv';
import { scheduleSink, seasonOfDay, withinSeason } from './sportsdataverse-schedule';

import type { SeasonGames, SourceGame } from './types';
import type { EpochMs } from '@/lib/time';

const SEASON = '2024-25';
// A final game of 8 March 2025 at 19:30 US Eastern, UTC-5 that day, between two invented
// teams, each value under its column's name in camel case.
const GAME = {
  id: '1',
  gameId: '1',
  date: '2025-03-09T00:30Z',
  gameDateTime: '2025-03-08T19:30:00.000000-0500',
  gameDate: '2025-03-08',
  timeValid: 'true',
  seasonType: '2',
  typeAbbreviation: 'STD',
  notesHeadline: '',
  neutralSite: 'false',
  statusTypeName: 'STATUS_FINAL',
  statusPeriod: '4.0',
  formatRegulationPeriods: '4.0',
  playerBox: 'true',
  homeId: '1',
  homeAbbreviation: 'AAA',
  homeName: 'Aces',
  homeLocation: 'Alpha',
  homeScore: '101',
  awayId: '2',
  awayAbbreviation: 'BBB',
  awayName: 'Bolts',
  awayLocation: 'Beta',
  awayScore: '99',
} as const;

type Row = Readonly<Partial<Record<keyof typeof GAME, string>>>;

/** The instant that `text` writes with its offset. */
function instant(text: string): EpochMs {
  const parsed = parseTimestamp(text);
  if (!parsed.ok || parsed.timestamp.kind !== 'instant') {
    throw new Error(`Not an instant: ${text}`);
  }
  return parsed.timestamp.at;
}

/** The column of a value named in camel case: `gameId` for `game_id`. */
const columnOf = (key: string): string =>
  key.replaceAll(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`);

/** The values of `row` in the order of the game's, but for that of `without`. */
const valuesOf = (row: Row, without: string): readonly (readonly [string, string])[] =>
  Object.entries({ ...GAME, ...row }).filter(([key]) => key !== without);

/** A schedule file of `rows`, each the game above with its own values, without the column of `without`. */
function fileOf(rows: readonly Row[], without: string): string {
  const header = valuesOf({}, without).map(([key]) => columnOf(key));
  const lines = rows.map((row) => valuesOf(row, without).map(([, value]) => value));
  return [header, ...lines].map((fields) => `${fields.join(',')}\n`).join('');
}

/** What the schedule sink of `season` reads of `rows`, nothing for a refused file. */
function read(rows: readonly Row[], season = SEASON, without = ''): SeasonGames | undefined {
  const reader = new CsvReader(scheduleSink(season));
  reader.push(fileOf(rows, without));
  return reader.end();
}

/** The games read of `rows`. */
const gamesOf = (rows: readonly Row[], season = SEASON): readonly SourceGame[] =>
  read(rows, season)?.games ?? [];

/** A game postponed on `day`, in the evening, US Eastern. */
const postponed = (id: string, day: string): Row => ({
  gameId: id,
  statusTypeName: 'STATUS_POSTPONED',
  date: `${day}T23:00Z`,
  gameDateTime: `${day}T18:00:00-0500`,
  gameDate: day,
});

describe('seasonOfDay', () => {
  it.each([
    ['2024-09-30', '2023-24'],
    ['2024-10-01', '2024-25'],
    ['2025-06-22', '2024-25'],
    ['2020-10-11', '2019-20'],
    ['2020-12-21', '2019-20'],
    ['2020-12-22', '2020-21'],
    ['1999-12-31', '1999-00'],
  ])('[CL-STA-28] files a game of %s in %s', (day, season) => {
    expect(seasonOfDay(toIsoDate(day))).toBe(season);
    expect(withinSeason(season)(toIsoDate(day))).toBe(true);
  });

  it('[CL-STA-28] files every day in the season that its first year or the year before starts', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1994, max: 2040 }),
        fc.integer({ min: 1, max: 12 }),
        (year, month) => {
          const day = toIsoDate(`${String(year)}-${String(month).padStart(2, '0')}-15`);
          const firstYear = year !== 2020 && month >= 10 ? year : year - 1;
          const next = String((firstYear + 1) % 100).padStart(2, '0');
          expect(seasonOfDay(day)).toBe(`${String(firstYear)}-${next}`);
        },
      ),
    );
  });
});

describe('[STA-02] the schedule rows of the SportsDataverse release', () => {
  it('[STA-05] [CL-TRV-03] reads a game with its start, its US Eastern day, its teams and its result', () => {
    expect(read([GAME])).toStrictEqual({
      games: [
        {
          game: '1',
          season: SEASON,
          phase: 'regular_season',
          exclusion: null,
          homeTeam: '1',
          awayTeam: '2',
          tipOff: instant('2025-03-09T00:30Z'),
          isTimeKnown: true,
          gameDay: '2025-03-08',
          isNeutralSite: false,
          status: 'final',
          score: { home: 101, away: 99 },
          overtimes: 0,
          series: null,
          makeUpOf: null,
        },
      ],
      teams: [
        { team: '1', name: 'Aces', abbreviation: 'AAA', location: 'Alpha' },
        { team: '2', name: 'Bolts', abbreviation: 'BBB', location: 'Beta' },
      ],
      coverage: { phasesWithBoxScores: ['regular_season'], gamesWithoutBoxScores: [] },
      heldBack: [],
    });
  });

  it('[CL-STA-28] reads each game once, in the season of its day, whatever file lists it (T14)', () => {
    const earlier: Row = {
      gameId: '2',
      date: '2024-04-11T00:00Z',
      gameDateTime: '2024-04-10T20:00:00-0400',
      gameDate: '2024-04-10',
    };
    const rows = [GAME, { ...GAME, homeScore: '50' }, earlier];
    expect(gamesOf(rows).map(({ game, score }) => [game, score])).toStrictEqual([
      ['1', { home: 101, away: 99 }],
    ]);
    expect(gamesOf(rows, '2023-24').map(({ game }) => game)).toStrictEqual(['2']);
  });

  it('[CL-STA-16] [CL-STA-14] excludes the labeled games first whatever their teams, then keeps placeholders, then marks games between no franchises as All-Star', () => {
    const games = gamesOf([
      { gameId: '1', typeAbbreviation: 'ALLSTAR' },
      {
        gameId: '2',
        typeAbbreviation: 'CC',
        homeId: '-1',
        homeAbbreviation: 'TBD',
        awayId: '-2',
        awayAbbreviation: 'TBD',
        statusTypeName: 'STATUS_SCHEDULED',
      },
      {
        gameId: '3',
        homeId: '-1',
        homeAbbreviation: 'TBD',
        statusTypeName: 'STATUS_SCHEDULED',
      },
      { gameId: '4', homeId: '130579', awayId: '130580' },
      { gameId: '5', typeAbbreviation: 'CC' },
    ]);
    const sides = games.map(({ game, exclusion, homeTeam, awayTeam }) => [
      game,
      exclusion,
      homeTeam,
      awayTeam,
    ]);
    expect(sides).toStrictEqual([
      ['1', 'all_star', '1', '2'],
      ['2', 'cup_final', null, null],
      ['3', null, null, null],
      ['4', 'all_star', null, null],
      ['5', 'cup_final', '1', '2'],
    ]);
    expect(read([{ gameId: '4', homeId: '130579', awayId: '130580' }])?.teams).toStrictEqual([]);
  });

  it('[CL-TRV-03] [CL-STA-14] starts a game whose time is to be determined at 00:00 US Eastern on its day', () => {
    const games = gamesOf([
      {
        timeValid: 'False',
        date: '2025-03-08T17:00Z',
        gameDateTime: '2025-03-08T12:00:00-0500',
      },
    ]);
    expect(games[0]).toMatchObject({
      isTimeKnown: false,
      tipOff: instant('2025-03-08T05:00Z'),
      gameDay: '2025-03-08',
    });
  });

  it.each<Readonly<{ name: string; row: Row; without?: string }>>([
    {
      name: 'a game day that is not the US Eastern date of its tip-off',
      row: { gameDate: '2025-03-09' },
    },
    {
      name: 'two writings of its start that disagree',
      row: { gameDateTime: '2025-03-08T20:30:00-0500' },
    },
    { name: 'a start without its offset', row: { date: '2025-03-09 00:30' } },
    { name: 'an unreadable game date', row: { gameDate: '8 March 2025' } },
    { name: 'a boolean that is neither true nor false', row: { neutralSite: 'yes' } },
    { name: 'a season type it does not know, such as the preseason', row: { seasonType: '1' } },
    { name: 'an unreadable final score', row: { homeScore: 'NA' } },
    { name: 'a missing column', row: {}, without: 'gameDate' },
  ])('[CL-STA-14] refuses the whole file for $name', ({ row, without }) => {
    expect(read([GAME, { ...row, gameId: '2' }], SEASON, without)).toBeUndefined();
  });

  it('[STA-29] [STA-31] [CL-STA-17] maps the status values it knows, and holds back alone a row whose status it does not', () => {
    const games = read([
      { gameId: '1', statusTypeName: 'STATUS_IN_PROGRESS' },
      { gameId: '2', statusTypeName: 'STATUS_HALFTIME' },
      { gameId: '3', statusTypeName: 'STATUS_END_PERIOD' },
      { gameId: '4', statusTypeName: 'STATUS_CANCELED' },
      { gameId: '5', statusTypeName: 'STATUS_POSTPONED' },
      { gameId: '6', statusTypeName: 'STATUS_SCHEDULED' },
      { gameId: '7', statusTypeName: 'STATUS_SUSPENDED' },
      { gameId: '8', statusTypeName: 'STATUS_FORFEIT', gameDate: 'unknown' },
      { gameId: '9', statusTypeName: 'STATUS_DELAYED', gameDate: '2024-04-10' },
    ]);
    expect(games?.games.map(({ status, score }) => [status, score])).toStrictEqual([
      ['in_progress', null],
      ['in_progress', null],
      ['in_progress', null],
      ['canceled', null],
      ['postponed', null],
      ['scheduled', null],
    ]);
    expect(games?.heldBack).toStrictEqual([
      { game: '7', status: 'STATUS_SUSPENDED' },
      { game: '8', status: 'STATUS_FORFEIT' },
    ]);
  });

  it('[CL-STA-03] counts the overtimes of a final game only, beyond its four periods', () => {
    const games = gamesOf([
      { gameId: '1', statusPeriod: '6.0' },
      { gameId: '2', statusPeriod: 'NA' },
      { gameId: '3', statusPeriod: '1.0', formatRegulationPeriods: '1.0' },
      { gameId: '4', statusPeriod: '2.0' },
    ]);
    expect(games.map(({ overtimes }) => overtimes)).toStrictEqual([2, null, null, null]);
  });

  it('[CL-STA-18] reads the round and the number of postseason games, a null round for a play-in label of no known kind', () => {
    const games = gamesOf([
      {
        gameId: '1',
        seasonType: '3',
        typeAbbreviation: 'RD16',
        notesHeadline: 'East 1st Round - Game 3',
      },
      {
        gameId: '2',
        seasonType: '3',
        typeAbbreviation: 'QTR',
        notesHeadline: 'West Semifinals - Game 7',
      },
      { gameId: '3', seasonType: '3', typeAbbreviation: 'SEMI', notesHeadline: '' },
      { gameId: '4', seasonType: '3', typeAbbreviation: 'STD', notesHeadline: '' },
      {
        gameId: '5',
        seasonType: '5',
        notesHeadline: 'NBA Play-In - East - 7th Place vs. 8th Place',
      },
      {
        gameId: '6',
        seasonType: '5',
        notesHeadline: 'NBA Play-In - West - 9th Place vs 10th Place',
      },
      { gameId: '7', seasonType: '5', notesHeadline: 'NBA Play-In - West - 8th Seed Game' },
      { gameId: '8', seasonType: '5', notesHeadline: 'WEST PLAY-IN - GAME 1' },
    ]);
    expect(games.map(({ series }) => series)).toStrictEqual([
      { round: 'first_round', gameNumber: 3 },
      { round: 'conference_semifinals', gameNumber: 7 },
      { round: 'conference_finals', gameNumber: null },
      { round: null, gameNumber: null },
      { round: 'play_in_7_vs_8', gameNumber: null },
      { round: 'play_in_9_vs_10', gameNumber: null },
      { round: 'play_in_8th_seed', gameNumber: null },
      { round: null, gameNumber: 1 },
    ]);
  });

  it('[CL-STA-17] links a make-up game to the postponed game of the same two teams on the day it names', () => {
    const games = gamesOf([
      postponed('1', '2025-01-11'),
      postponed('2', '2024-12-05'),
      postponed('3', '2025-01-22'),
      { ...postponed('4', '2025-01-09'), homeId: '3' },
      { gameId: '11', notesHeadline: 'Makeup from Jan 11' },
      { gameId: '12', notesHeadline: 'Makeup from Dec. 5', homeId: '2', awayId: '1' },
      { gameId: '13', notesHeadline: 'Rescheduled from Jan 22' },
      { gameId: '14', notesHeadline: 'Makeup from Jan 9' },
      { gameId: '15', notesHeadline: 'Makeup from Smarch 9' },
      { gameId: '16', notesHeadline: 'Makeup date Jan 11' },
    ]);
    const links = games.map(({ game, makeUpOf }) => [game, makeUpOf]).slice(4);
    expect(links).toStrictEqual([
      ['11', '1'],
      ['12', '2'],
      ['13', '3'],
      ['14', null],
      ['15', null],
      ['16', null],
    ]);
  });

  it('[STA-35] [CL-STA-22] gives the teams of the season under their names, and the coverage of its counted final games', () => {
    const games = read([
      { gameId: '1' },
      { gameId: '2', playerBox: 'FALSE', homeName: 'Renamed' },
      { gameId: '3', seasonType: '3', typeAbbreviation: 'RD16' },
      { gameId: '4', typeAbbreviation: 'ALLSTAR', playerBox: 'false' },
      { gameId: '5', statusTypeName: 'STATUS_SCHEDULED', playerBox: 'false' },
      { gameId: '6', seasonType: '5', playerBox: 'false' },
    ]);
    expect(games?.teams.map(({ name }) => name)).toStrictEqual(['Aces', 'Bolts']);
    expect(games?.coverage).toStrictEqual({
      phasesWithBoxScores: ['regular_season', 'playoffs'],
      gamesWithoutBoxScores: ['2', '6'],
    });
  });
});
