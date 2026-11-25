import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { CsvReader } from './sportsdataverse-csv';
import {
  booleanOf,
  boxScoreSink,
  countOf,
  crosswalkSink,
  isFranchise,
  playerFileSink,
} from './sportsdataverse-rows';
import { withinSeason } from './sportsdataverse-schedule';

import type { RowSink } from './sportsdataverse-csv';
import type { CurrentTeam } from './types';

type Fields = Readonly<Record<string, string>>;

const SEASON = '2024-25';

// A line of an invented player, each value under its column's name in camel case, with
// the two columns the adapter never reads: the ejection, which the source never sets,
// and the reason a player did not play.
const LINE: Fields = {
  gameId: '401',
  gameDate: '2025-03-08',
  athleteId: '9000001',
  athleteDisplayName: 'Quorin Applewhistle',
  athleteShortName: 'Q. Applewhistle',
  teamId: '1',
  opponentTeamId: '2',
  homeAway: 'home',
  didNotPlay: 'FALSE',
  minutes: '34',
  points: '21',
  fieldGoalsMade: '8',
  fieldGoalsAttempted: '15',
  threePointFieldGoalsMade: '2',
  freeThrowsMade: '3',
  freeThrowsAttempted: '4',
  offensiveRebounds: '1',
  defensiveRebounds: '6',
  assists: '5',
  steals: '1',
  blocks: '0',
  turnovers: '2',
  fouls: '3',
  ejected: 'true',
  reason: 'REST',
};

/** The column of a value named in camel case: `gameId` for `game_id`. */
const columnOf = (key: string): string =>
  key.replaceAll(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`);

/** What `sink` reads of a file of `rows` under the columns of the first one, nothing for a refused file. */
function read<T>(sink: RowSink<T>, rows: readonly Fields[]): T | undefined {
  const keys = Object.keys(rows[0] ?? {});
  const lines = rows.map((row) => keys.map((key) => row[key] ?? '').join(','));
  const reader = new CsvReader(sink);
  reader.push(`${[keys.map((key) => columnOf(key)).join(','), ...lines].join('\n')}\n`);
  return reader.end();
}

/** The box-score file of `rows`, read for the 2024-25 season. */
const boxScoresOf = (rows: readonly Fields[]) => read(boxScoreSink(withinSeason(SEASON)), rows);

/** `LINE` without the values of `keys`. */
const lineWithout = (...keys: readonly string[]): Fields =>
  Object.fromEntries(Object.entries(LINE).filter(([key]) => !keys.includes(key)));

/** `text` with the letters that `upper` marks in upper case. */
const withCase = (text: string, upper: readonly boolean[]): string =>
  Array.from(text, (char, place) => (upper[place] === true ? char.toUpperCase() : char)).join('');

// Five letters, each in upper case or not.
const ANY_CASE = fc.array(fc.boolean(), { minLength: 5, maxLength: 5 });

describe('the values of the SportsDataverse release', () => {
  it('[STA-02] reads a boolean written in any case, and nothing else', () => {
    fc.assert(
      fc.property(fc.boolean(), ANY_CASE, (value, upper) => {
        const written = withCase(String(value), upper);
        expect(booleanOf(written)).toBe(value);
      }),
    );
    for (const value of ['', 'yes', '1', 'truth', ' true', 'NA']) {
      expect(booleanOf(value)).toBeUndefined();
    }
  });

  it('[STA-10] reads a whole count as such, an absent one as null, never as 0', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1000, max: 1000 }), (count) => {
        expect(countOf(String(count))).toBe(count);
        expect(countOf(`${String(count)}.0`)).toBe(count);
      }),
    );
    expect([countOf(''), countOf('NA'), countOf('0')]).toStrictEqual([null, null, 0]);
    expect([countOf('5.5'), countOf('five'), countOf('Infinity')]).toStrictEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('[CL-STA-16] counts the thirty teams numbered 1 to 30 as franchises, and no other', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 30 }), (team) => {
        expect(isFranchise(String(team))).toBe(true);
      }),
    );
    fc.assert(
      fc.property(fc.integer({ min: 31, max: 200_000 }), (team) => {
        expect(isFranchise(String(team))).toBe(false);
      }),
    );
    for (const team of ['0', '-1', '1.0', '', 'TBD']) {
      expect(isFranchise(team)).toBe(false);
    }
  });
});

describe('[STA-02] the box-score lines of the SportsDataverse release', () => {
  it('[STA-08] [STA-12] [SEN-16] reads a line with its thirteen counts, its whole minutes and an unknown ejection', () => {
    expect(boxScoresOf([LINE])).toStrictEqual({
      lines: [
        {
          game: '401',
          player: '9000001',
          team: '1',
          opponent: '2',
          isHome: true,
          didNotPlay: false,
          playingTime: { precision: 'whole_minutes', minutes: 34 },
          counts: {
            points: 21,
            fieldGoalsMade: 8,
            fieldGoalsAttempted: 15,
            threePointersMade: 2,
            freeThrowsMade: 3,
            freeThrowsAttempted: 4,
            offensiveRebounds: 1,
            defensiveRebounds: 6,
            assists: 5,
            steals: 1,
            blocks: 0,
            turnovers: 2,
            personalFouls: 3,
          },
          ejected: null,
        },
      ],
      sidesWithLines: [{ game: '401', home: true, away: false }],
      directory: [
        {
          player: '9000001',
          displayName: 'Quorin Applewhistle',
          otherNames: ['Q. Applewhistle'],
          teams: [{ team: '1', firstGameDay: '2025-03-08', lastGameDay: '2025-03-08' }],
        },
      ],
    });
  });

  it('[STA-08] [CL-STA-04] gives each game of its lines the sides that hold one, a did-not-play line included, and no skipped line', () => {
    const away = { athleteId: '9000002', teamId: '2', opponentTeamId: '1', homeAway: 'away' };
    const file = boxScoresOf([
      LINE,
      { ...LINE, ...away },
      { ...LINE, ...away, gameId: '402', didNotPlay: 'TRUE', minutes: '' },
      { ...LINE, gameId: '403', teamId: '130579' },
      { ...LINE, gameId: '404', gameDate: '2024-04-10' },
    ]);
    expect(file?.sidesWithLines).toStrictEqual([
      { game: '401', home: true, away: true },
      { game: '402', home: false, away: true },
    ]);
  });

  it('[STA-10] [DSN-15] reads a did-not-play line without its reason, and fills no count it lacks', () => {
    const counts = Object.fromEntries(
      ['points', 'assists', 'fouls', 'blocks'].map((column) => [column, 'NA']),
    );
    const file = boxScoresOf([
      { ...lineWithout('reason', 'ejected'), didNotPlay: 'True', minutes: '', ...counts },
    ]);
    expect(file?.lines[0]).toMatchObject({
      didNotPlay: true,
      playingTime: null,
      counts: { points: null, assists: null, personalFouls: null, blocks: null, steals: 1 },
    });
  });

  it('[CL-STA-16] [CL-STA-28] reads each line once, of its season only, and skips the lines of an All-Star game unread', () => {
    const file = boxScoresOf([
      LINE,
      { ...LINE, points: '50' },
      { ...LINE, gameId: '402', gameDate: '2024-04-10' },
      { ...LINE, gameId: '403', athleteId: '9000002', teamId: '130579', minutes: 'x' },
      { ...LINE, gameId: '404', athleteId: '9000003', opponentTeamId: '-2' },
    ]);
    expect(file?.lines.map(({ game, counts }) => [game, counts.points])).toStrictEqual([
      ['401', 21],
    ]);
    expect(file?.directory.map(({ player }) => player)).toStrictEqual(['9000001']);
  });

  it('[STA-03] [JOU-13] gives each player his names and, team by team from the earliest, his first and last game days', () => {
    const file = boxScoresOf([
      { ...LINE, gameId: '1', gameDate: '2025-02-20', teamId: '3' },
      { ...LINE, gameId: '2', gameDate: '2025-01-05', athleteDisplayName: 'Other Name' },
      { ...LINE, gameId: '3', gameDate: '2024-11-02' },
      { ...LINE, gameId: '4', gameDate: '2025-03-01', teamId: '3' },
      { ...LINE, gameId: '5', athleteId: '9000002', athleteShortName: 'Quorin Applewhistle' },
      { ...LINE, gameId: '6', athleteId: '9000003', athleteShortName: '' },
    ]);
    expect(file?.directory).toStrictEqual([
      {
        player: '9000001',
        displayName: 'Quorin Applewhistle',
        otherNames: ['Q. Applewhistle'],
        teams: [
          { team: '1', firstGameDay: '2024-11-02', lastGameDay: '2025-01-05' },
          { team: '3', firstGameDay: '2025-02-20', lastGameDay: '2025-03-01' },
        ],
      },
      {
        player: '9000002',
        displayName: 'Quorin Applewhistle',
        otherNames: [],
        teams: [{ team: '1', firstGameDay: '2025-03-08', lastGameDay: '2025-03-08' }],
      },
      {
        player: '9000003',
        displayName: 'Quorin Applewhistle',
        otherNames: [],
        teams: [{ team: '1', firstGameDay: '2025-03-08', lastGameDay: '2025-03-08' }],
      },
    ]);
  });

  it.each<Readonly<{ name: string; row: Fields }>>([
    { name: 'an unreadable game date', row: { ...LINE, gameDate: 'NA' } },
    { name: 'a side that is neither home nor away', row: { ...LINE, homeAway: 'neutral' } },
    { name: 'a did-not-play value that is no boolean', row: { ...LINE, didNotPlay: 'no' } },
    { name: 'minutes that are not whole', row: { ...LINE, minutes: '34.5' } },
    { name: 'an unreadable count', row: { ...LINE, steals: '1+' } },
    { name: 'a missing column', row: lineWithout('opponentTeamId') },
  ])('[CL-STA-14] refuses the whole file for $name', ({ row }) => {
    expect(boxScoresOf([row])).toBeUndefined();
  });
});

describe('[STA-02] the player files and the crosswalk of the SportsDataverse release', () => {
  const players = new Set(['9000001', '9000002']);
  const PLAYER: Fields = {
    athleteId: '9000001',
    displayName: 'Quorin Applewhistle',
    dateOfBirth: '1997-05-27T07:00Z',
    currentTeamId: '13',
    statusType: 'active',
    headshotHref: '',
  };
  const WITHOUT_TEAM: CurrentTeam = { kind: 'without_team' };

  it('[STA-26] [CL-STA-27] [CL-JOU-16] reads the requested players once, with a birthday without its year, an empty team being a release', () => {
    const records = read(playerFileSink(players), [
      PLAYER,
      { ...PLAYER, currentTeamId: '14' },
      { ...PLAYER, athleteId: '9000002', dateOfBirth: '', currentTeamId: '' },
      { ...PLAYER, athleteId: '9000003', dateOfBirth: 'unknown' },
    ]);
    expect(records).toStrictEqual(
      new Map([
        [
          '9000001',
          {
            player: '9000001',
            displayName: 'Quorin Applewhistle',
            birthday: { month: 5, day: 27 },
            currentTeam: { kind: 'team', team: '13' },
          },
        ],
        [
          '9000002',
          {
            player: '9000002',
            displayName: 'Quorin Applewhistle',
            birthday: null,
            currentTeam: { kind: 'without_team' },
          },
        ],
      ]),
    );
  });

  it.each<Readonly<{ name: string; statusType: string; currentTeamId: string; team: CurrentTeam }>>(
    [
      {
        name: 'a free-agent row that keeps a team id',
        statusType: 'free-agent',
        currentTeamId: '14',
        team: WITHOUT_TEAM,
      },
      {
        name: 'an inactive row',
        statusType: 'inactive',
        currentTeamId: '5',
        team: { kind: 'team', team: '5' },
      },
      {
        name: 'an active row with an empty team id',
        statusType: 'active',
        currentTeamId: '',
        team: WITHOUT_TEAM,
      },
      {
        name: 'a free-agent row with an empty team id',
        statusType: 'free-agent',
        currentTeamId: '',
        team: WITHOUT_TEAM,
      },
      {
        name: 'an active row',
        statusType: 'active',
        currentTeamId: '13',
        team: { kind: 'team', team: '13' },
      },
      {
        name: 'a row of another status',
        statusType: 'retired',
        currentTeamId: '7',
        team: { kind: 'team', team: '7' },
      },
    ],
  )(
    '[STA-26] [CL-STA-27] [CL-STA-31] reads the release by its status: $name',
    ({ statusType, currentTeamId, team }) => {
      expect(
        read(playerFileSink(players), [{ ...PLAYER, statusType, currentTeamId }]),
      ).toStrictEqual(
        new Map([
          [
            '9000001',
            {
              player: '9000001',
              displayName: 'Quorin Applewhistle',
              birthday: { month: 5, day: 27 },
              currentTeam: team,
            },
          ],
        ]),
      );
    },
  );

  it('[CL-STA-14] [CL-STA-31] refuses a player file without the status column', () => {
    const withoutStatus = Object.fromEntries(
      Object.entries(PLAYER).filter(([key]) => key !== 'statusType'),
    );
    expect(read(playerFileSink(players), [withoutStatus])).toBeUndefined();
    expect(read(playerFileSink(players), [PLAYER])?.size).toBe(1);
  });

  it('[CL-STA-14] refuses a player file whose requested player has an unreadable birth date', () => {
    expect(
      read(playerFileSink(players), [{ ...PLAYER, dateOfBirth: '27/05/1997' }]),
    ).toBeUndefined();
  });

  it('[TRV-12] [CL-TRV-14] maps each matched player to his identifier in the other source', () => {
    const row = { espnAthleteId: '9000001', matchMethod: 'exact', nbaPlayerId: '8000001' };
    const mappings = read(crosswalkSink('nba_player_id'), [
      row,
      { ...row, espnAthleteId: '9000002', matchMethod: 'unmatched' },
      { ...row, espnAthleteId: '9000003', nbaPlayerId: '' },
      { ...row, espnAthleteId: '9000004', matchMethod: 'fuzzy', nbaPlayerId: '8000004' },
    ]);
    expect(mappings).toStrictEqual([
      { player: '9000001', otherPlayer: '8000001' },
      { player: '9000004', otherPlayer: '8000004' },
    ]);
    expect(read(crosswalkSink('fox_athlete_id'), [row])).toBeUndefined();
  });
});
