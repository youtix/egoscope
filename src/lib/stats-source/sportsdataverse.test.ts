import { describe, expect, it, onTestFinished } from 'vitest';

import { parseTimestamp, toIsoDate } from '@/lib/time';

import { STATS_SOURCE_CONTRACT } from './contract';
import { open } from './contract-support';
import { createSportsDataverseSource, STATS_SOURCE_ATTRIBUTION } from './sportsdataverse';
import { startReplay } from './sportsdataverse-replay';
import { BOX_SCORE_COUNTS } from './types';

import type { ContractFault, StatsSourceHarness } from './contract-support';
import type { StatsSource, StatsSourceOutcome } from './port';
import type { ReplayFault } from './sportsdataverse-replay';
import type {
  ConditionalRead,
  PlayerMapping,
  PlayerRecord,
  SeasonGames,
  SourceGame,
} from './types';
import type { EpochMs } from '@/lib/time';

const SEASON = '2024-25';
const CURRENT = '2026-27';
// Two players of a 2024-25 box score whom the 2026-27 player file lists, one whom it
// does not and the 2025-26 file does, one whom it lists as a free agent who keeps the
// team id 15, and an id that no file holds.
const PLAYERS = ['9000121', '9000122'];
const FORMER = '9000123';
const RELEASED = '9000273';
const UNKNOWN = '9999999';
const WITHOUT_TEAM: PlayerRecord['currentTeam'] = { kind: 'without_team' };
const SCHEDULE = 'espn_nba_schedules/nba_schedule_2025.csv';
const BOX_SCORES = 'espn_nba_player_boxscores/player_box_2025.csv';

/** The instant that `text` writes with its offset. */
function instant(text: string): EpochMs {
  const parsed = parseTimestamp(text);
  if (!parsed.ok || parsed.timestamp.kind !== 'instant') {
    throw new Error(`Not an instant: ${text}`);
  }
  return parsed.timestamp.at;
}

/** The data that an operation read, failing the test on any other answer. */
async function dataOf<T>(answer: Promise<StatsSourceOutcome<ConditionalRead<T>>>): Promise<T> {
  const outcome = await answer;
  if (!outcome.ok || outcome.value.kind !== 'read') {
    throw new Error(`Not read: ${JSON.stringify(outcome)}`);
  }
  return outcome.value.data;
}

/** The adapter on a local replay of the recorded release, closed when the test ends. */
async function recordedSource(): Promise<
  Readonly<{ source: StatsSource; replay: Awaited<ReturnType<typeof startReplay>> }>
> {
  const replay = await startReplay();
  onTestFinished(async () => replay.close());
  return { source: createSportsDataverseSource(replay.baseUrl), replay };
}

const replayFaultOf = (fault: ContractFault): ReplayFault =>
  fault === 'rate_limited'
    ? { kind: 'quota', status: 429, headers: { 'retry-after': '60' } }
    : { kind: fault };

async function recordedHarness(): Promise<StatsSourceHarness> {
  const { source, replay } = await recordedSource();
  return {
    source,
    season: SEASON,
    currentSeason: CURRENT,
    missingSeason: '2022-23',
    players: PLAYERS,
    formerPlayer: FORMER,
    releasedPlayer: RELEASED,
    // He played for team 15 in the NBA Cup final alone; team 15 is at home in this game.
    playerWithoutLine: { player: '9000355', game: '401705483', isHome: true },
    unknownPlayer: UNKNOWN,
    inject: (fault) => {
      replay.inject(SCHEDULE, replayFaultOf(fault));
    },
  };
}

/** The records that the adapter reads of `players` for `season`. */
async function recordsOf(
  source: StatsSource,
  season: string,
  players: readonly string[],
): Promise<readonly PlayerRecord[]> {
  return dataOf(source.getPlayerRecords(open(), { season, players, knownVersion: null }));
}

/** A player's record, as the fixture row of his invented name and birthday gives it. */
const record = (
  [player, displayName]: readonly [string, string],
  birthday: PlayerRecord['birthday'],
  currentTeam: PlayerRecord['currentTeam'],
): PlayerRecord => ({ player, displayName, birthday, currentTeam });

/** The games of `season`, by id. */
async function gamesOf(source: StatsSource, season: string): Promise<SeasonGames> {
  return dataOf(source.getSeasonGames(open(), { season, knownVersion: null }));
}

const byId = (games: readonly SourceGame[]): ReadonlyMap<string, SourceGame> =>
  new Map(games.map((game) => [game.game, game]));

/** The games of `season`, by id. */
async function gamesById(
  source: StatsSource,
  season: string,
): Promise<ReadonlyMap<string, SourceGame>> {
  const { games } = await gamesOf(source, season);
  return byId(games);
}

/** Each playoff pairing of `games`, whoever is at home, as its rounds and its number of games: `finals 7`. */
function pairingsOf(games: readonly SourceGame[]): readonly string[] {
  const playoffs = games.filter(({ phase }) => phase === 'playoffs');
  const pairings = Map.groupBy(playoffs, ({ homeTeam, awayTeam }) =>
    [Number(homeTeam), Number(awayTeam)].toSorted((left, right) => left - right).join(' '),
  );
  return Array.from(pairings, ([, played]) => {
    const rounds = played.map(({ series }) => series?.round ?? 'unlabeled');
    const distinct = rounds.filter((round, place) => rounds.indexOf(round) === place);
    return `${distinct.join(',')} ${String(played.length)}`;
  }).toSorted((left, right) => left.localeCompare(right, 'en'));
}

/** The mappings that `mapPlayers` gives, failing the test when the adapter has none. */
async function mappingsOf(
  source: StatsSource,
  request: Readonly<{ otherSource: string; season: string }>,
): Promise<StatsSourceOutcome<readonly PlayerMapping[]>> {
  const { mapPlayers } = source;
  if (mapPlayers === undefined) {
    throw new Error('The SportsDataverse adapter maps players.');
  }
  return mapPlayers(open(), request);
}

describe('[TRV-15] [STA-02] [STA-26] [CL-STA-04] [CL-STA-31] the SportsDataverse adapter against the stats-source contract, on the recorded release', () => {
  it.each(STATS_SOURCE_CONTRACT)('$title', async ({ check }) => {
    await expect(check(await recordedHarness())).resolves.toStrictEqual([]);
  });
});

describe('[TRV-15] [STA-02] the SportsDataverse adapter on the recorded release', () => {
  it('[STA-02] [STA-05] [CL-STA-18] reads every official game, with its start, teams, status, score and series', async () => {
    const { source } = await recordedSource();
    const { games } = await gamesOf(source, SEASON);
    const games2025 = byId(games);
    expect(new Set(games.map(({ phase }) => phase))).toStrictEqual(
      new Set(['regular_season', 'play_in', 'playoffs']),
    );
    expect(games2025.get('401766128')).toStrictEqual({
      game: '401766128',
      season: SEASON,
      phase: 'playoffs',
      exclusion: null,
      tipOff: instant('2025-06-23T00:00Z'),
      isTimeKnown: true,
      gameDay: toIsoDate('2025-06-22'),
      homeTeam: '25',
      awayTeam: '11',
      isNeutralSite: false,
      status: 'final',
      score: { home: 103, away: 91 },
      overtimes: 0,
      series: { round: 'finals', gameNumber: 7 },
      makeUpOf: null,
    });
    expect(games2025.get('401766462')).toMatchObject({
      phase: 'play_in',
      overtimes: 1,
      series: { round: 'play_in_8th_seed', gameNumber: null },
    });
    expect(games2025.get('401766458')?.series).toStrictEqual({
      round: 'play_in_7_vs_8',
      gameNumber: null,
    });
    expect(games2025.get('401766461')?.series?.round).toBe('play_in_9_vs_10');
  });

  it('[STA-02] [CL-TRV-03] dates each game by its US Eastern tip-off across the change to daylight time of March 2025 (T11)', async () => {
    const { source } = await recordedSource();
    const games = await gamesById(source, SEASON);
    const timingOf = (id: string) => {
      const game = games.get(id);
      return { tipOff: game?.tipOff, gameDay: game?.gameDay };
    };
    // 18:00 and 19:30 at UTC-5 on 8 March, 22:00 at UTC-4 on 14 March.
    expect(timingOf('401705478')).toStrictEqual({
      tipOff: instant('2025-03-08T23:00Z'),
      gameDay: toIsoDate('2025-03-08'),
    });
    expect(timingOf('401705480')).toStrictEqual({
      tipOff: instant('2025-03-09T00:30Z'),
      gameDay: toIsoDate('2025-03-08'),
    });
    expect(timingOf('401705533')).toStrictEqual({
      tipOff: instant('2025-03-15T02:00Z'),
      gameDay: toIsoDate('2025-03-14'),
    });
  });

  it('[STA-02] [CL-STA-16] marks the All-Star games and the NBA Cup final by their labels, and never a preseason game', async () => {
    const { source } = await recordedSource();
    const seasons = await Promise.all(
      ['1993-94', '2001-02', SEASON, CURRENT].map(async (season) => gamesOf(source, season)),
    );
    const games = byId(seasons[2]?.games ?? []);
    expect(games.get('401752957')).toMatchObject({
      exclusion: 'all_star',
      homeTeam: null,
      awayTeam: null,
      overtimes: null,
    });
    expect(games.get('401734908')).toMatchObject({
      exclusion: 'cup_final',
      homeTeam: '25',
      awayTeam: '15',
      score: { home: 81, away: 97 },
    });
    const exclusions = seasons.flatMap((season) => season.games.map(({ exclusion }) => exclusion));
    expect(new Set(exclusions)).toStrictEqual(new Set([null, 'all_star', 'cup_final']));
  });

  it('[STA-02] [CL-STA-14] keeps the placeholders of 2026-27 without teams, at 00:00 US Eastern while their time is to be determined', async () => {
    const { source } = await recordedSource();
    const games = await gamesById(source, CURRENT);
    expect(games.get('401909456')).toMatchObject({
      exclusion: 'cup_final',
      homeTeam: null,
      awayTeam: null,
      isTimeKnown: false,
      tipOff: instant('2026-12-11T05:00Z'),
      gameDay: toIsoDate('2026-12-11'),
      status: 'scheduled',
      score: null,
    });
    expect(games.get('401909454')).toMatchObject({ exclusion: null, homeTeam: null });
  });

  it('[STA-02] [CL-STA-17] links each make-up game to the postponed game it replaces', async () => {
    const { source } = await recordedSource();
    const { games } = await gamesOf(source, SEASON);
    const links = games.flatMap(({ game, makeUpOf }) =>
      makeUpOf === null ? [] : [[game, makeUpOf] as const],
    );
    expect(new Map(links)).toStrictEqual(
      new Map([
        ['401754706', '401705183'],
        ['401754705', '401705103'],
        ['401748706', '401705104'],
        ['401748704', '401705090'],
        ['401748705', '401705098'],
      ]),
    );
    expect(byId(games).get('401705183')).toMatchObject({ status: 'postponed', score: null });
  });

  it('[STA-02] [STA-35] [CL-STA-22] gives the season teams under their names and the coverage of the box scores', async () => {
    const { source } = await recordedSource();
    const { teams, coverage, heldBack } = await gamesOf(source, SEASON);
    expect(teams).toHaveLength(29);
    expect(teams.find(({ team }) => team === '25')).toStrictEqual({
      team: '25',
      name: 'Thunder',
      abbreviation: 'OKC',
      location: 'Oklahoma City',
    });
    expect(coverage).toStrictEqual({
      phasesWithBoxScores: ['regular_season', 'play_in', 'playoffs'],
      gamesWithoutBoxScores: [],
    });
    expect(heldBack).toStrictEqual([]);
  });

  it('[STA-02] [STA-08] [STA-10] [STA-12] reads every element of a box score, and a did-not-play line without zeros', async () => {
    const { source } = await recordedSource();
    const lines = await dataOf(
      source.getSeasonBoxScores(open(), {
        season: SEASON,
        players: ['9000121', '9000131'],
        knownVersion: null,
      }),
    );
    expect(lines).toStrictEqual([
      {
        game: '401705478',
        player: '9000121',
        team: '17',
        opponent: '30',
        isHome: false,
        didNotPlay: false,
        playingTime: { precision: 'whole_minutes', minutes: 32 },
        counts: {
          points: 19,
          fieldGoalsMade: 6,
          fieldGoalsAttempted: 11,
          threePointersMade: 4,
          freeThrowsMade: 3,
          freeThrowsAttempted: 3,
          offensiveRebounds: 2,
          defensiveRebounds: 1,
          assists: 1,
          steals: 0,
          blocks: 2,
          turnovers: 2,
          personalFouls: 3,
        },
        ejected: null,
      },
      {
        game: '401705478',
        player: '9000131',
        team: '17',
        opponent: '30',
        isHome: false,
        didNotPlay: true,
        playingTime: null,
        counts: Object.fromEntries(BOX_SCORE_COUNTS.map((count) => [count, null])),
        ejected: null,
      },
    ]);
  });

  it('[STA-03] [JOU-13] lists each player of the box scores with his teams, never one of the All-Star games alone', async () => {
    const { source } = await recordedSource();
    const directory = await dataOf(
      source.getSeasonPlayers(open(), { season: SEASON, knownVersion: null }),
    );
    const current = await dataOf(
      source.getSeasonPlayers(open(), { season: CURRENT, knownVersion: null }),
    );
    expect(directory).toHaveLength(234);
    expect(directory.find(({ player }) => player === '9000121')).toStrictEqual({
      player: '9000121',
      displayName: 'Aras Bragen',
      otherNames: ['A. Bragen'],
      teams: [{ team: '17', firstGameDay: '2025-03-08', lastGameDay: '2025-03-08' }],
    });
    expect(directory.find(({ player }) => player === '9000335')).toBeUndefined();
    expect(current.find(({ player }) => player === '9000481')?.teams).toStrictEqual([
      { team: '23', firstGameDay: '2026-10-21', lastGameDay: '2026-11-06' },
      { team: '25', firstGameDay: '2026-11-10', lastGameDay: '2026-11-20' },
    ]);
  });

  it('[STA-02] [STA-26] [CL-STA-27] [CL-STA-31] [CL-JOU-16] reads the records of the current player file, a free agent released whatever team id he keeps, and of an earlier one for a player it does not list', async () => {
    const { source } = await recordedSource();
    await expect(recordsOf(source, CURRENT, ['9000121', RELEASED, FORMER])).resolves.toStrictEqual([
      record(['9000121', 'Aras Bragen'], { month: 5, day: 27 }, { kind: 'team', team: '13' }),
      record([RELEASED, 'Ivas Morgel'], { month: 9, day: 2 }, WITHOUT_TEAM),
      record([FORMER, 'Coras Drogek'], { month: 9, day: 25 }, { kind: 'not_listed' }),
    ]);
  });

  it('[STA-02] [STA-26] [CL-STA-27] [CL-STA-31] reads the three statuses of the 2025-26 player file: a free agent released, an inactive player on his team', async () => {
    const { source } = await recordedSource();
    await expect(
      recordsOf(source, '2025-26', ['9000279', '9000141', '9000121']),
    ).resolves.toStrictEqual([
      record(['9000279', 'Corus Dropol'], { month: 6, day: 24 }, WITHOUT_TEAM),
      record(['9000141', 'Ivus Morpok'], { month: 12, day: 25 }, { kind: 'team', team: '23' }),
      record(['9000121', 'Aras Bragen'], { month: 5, day: 27 }, { kind: 'team', team: '13' }),
    ]);
  });

  it('[STA-02] holds every season back to 1993-94, its first covered one', async () => {
    const { source } = await recordedSource();
    expect(source.firstCoveredSeason()).toBe('1993-94');
    const { games } = await gamesOf(source, '1993-94');
    expect(games.map(({ gameDay }) => gameDay)).toStrictEqual(
      Array.from({ length: 5 }, () => '1993-11-07'),
    );
    const lines = await dataOf(
      source.getSeasonBoxScores(open(), {
        season: '1993-94',
        players: ['9000001'],
        knownVersion: null,
      }),
    );
    expect(lines).toMatchObject([
      { game: '131107005', playingTime: { minutes: 37 }, counts: { points: 19 } },
    ]);
  });

  it('[STA-02] keeps the ids of games, teams and players stable across reads and across files', async () => {
    const first = await recordedSource();
    const second = await recordedSource();
    const ids = async (source: StatsSource) => {
      const { games } = await gamesOf(source, SEASON);
      return games.map(({ game, homeTeam, awayTeam }) => [game, homeTeam, awayTeam]);
    };
    expect(await ids(first.source)).toStrictEqual(await ids(second.source));
    const lines = await dataOf(
      first.source.getSeasonBoxScores(open(), {
        season: SEASON,
        players: PLAYERS,
        knownVersion: null,
      }),
    );
    const games = await gamesById(first.source, SEASON);
    expect(lines.map(({ game }) => games.get(game)?.homeTeam)).toStrictEqual(['30', '30']);
  });

  it('[STA-02] [STA-33] reads an official correction again, under a new version', async () => {
    const { source, replay } = await recordedSource();
    const request = { season: SEASON, players: ['9000121'] };
    const first = await source.getSeasonBoxScores(open(), { ...request, knownVersion: null });
    const version = first.ok && first.value.kind === 'read' ? first.value.version : null;
    // The source corrects his 19 points to 21.
    const lines = replay.text(BOX_SCORES).split('\n');
    const corrected19 = lines.map((line) =>
      line.includes(',9000121,Aras Bragen,') ? line.replace(',-2,19,true,', ',-2,21,true,') : line,
    );
    replay.publish(BOX_SCORES, corrected19.join('\n'));
    const corrected = await source.getSeasonBoxScores(open(), {
      ...request,
      knownVersion: version,
    });
    expect(corrected).toMatchObject({
      ok: true,
      value: { kind: 'read', data: [{ counts: { points: 21 } }] },
    });
    const newVersion =
      corrected.ok && corrected.value.kind === 'read' ? corrected.value.version : '';
    expect(newVersion).not.toBe(version);
    await expect(
      source.getSeasonBoxScores(open(), { ...request, knownVersion: newVersion }),
    ).resolves.toMatchObject({ ok: true, value: { kind: 'not_modified' } });
  });

  it('[STA-05] [CL-STA-18] gives each recorded playoff series its games: one labeled round per pairing in 2024-25, and the two three-game series of the unlabeled 2001-02 playoffs', async () => {
    const { source } = await recordedSource();
    const recent = await gamesOf(source, SEASON);
    const older = await gamesOf(source, '2001-02');
    expect(pairingsOf(recent.games)).toStrictEqual([
      'conference_finals 5',
      'conference_finals 6',
      'conference_semifinals 5',
      'conference_semifinals 5',
      'conference_semifinals 6',
      'conference_semifinals 7',
      'finals 7',
      'first_round 4',
      'first_round 4',
      'first_round 5',
      'first_round 5',
      'first_round 5',
      'first_round 6',
      'first_round 7',
      'first_round 7',
    ]);
    expect(pairingsOf(older.games)).toStrictEqual([
      'unlabeled 3',
      'unlabeled 3',
      'unlabeled 4',
      'unlabeled 4',
      'unlabeled 4',
      ...Array.from({ length: 8 }, () => 'unlabeled 5'),
      'unlabeled 6',
      'unlabeled 7',
    ]);
  });

  it('[STA-03] [STA-08] reads the box-score file once for the box scores and the directory asked in one call context', async () => {
    const { source, replay } = await recordedSource();
    const ctx = open();
    const request = { season: SEASON, knownVersion: null };
    const lines = await source.getSeasonBoxScores(ctx, { ...request, players: PLAYERS });
    const directory = await source.getSeasonPlayers(ctx, request);
    expect([lines.call.fileRequests, directory.call]).toStrictEqual([
      1,
      { httpRequests: 0, bytesReceived: 0, fileRequests: 0 },
    ]);
    expect(directory).toMatchObject({ ok: true, value: { kind: 'read' } });
    await source.getSeasonPlayers(open(), request);
    expect(replay.requests.filter(({ path }) => path.endsWith('player_box_2025.csv'))).toHaveLength(
      4,
    );
  });

  it('[STA-03] [STA-08] keeps in a call context only the box-score file of the season it asked for last', async () => {
    const { source, replay } = await recordedSource();
    const ctx = open();
    const read = async (season: string): Promise<number> => {
      const { call } = await source.getSeasonPlayers(ctx, { season, knownVersion: null });
      return call.fileRequests;
    };
    expect([
      await read(SEASON),
      await read(SEASON),
      await read(CURRENT),
      await read(SEASON),
    ]).toStrictEqual([1, 0, 1, 1]);
    expect(replay.requests.filter(({ path }) => path.endsWith('player_box_2025.csv'))).toHaveLength(
      4,
    );
  });

  it('[STA-26] [STA-42] [CL-STA-27] [CL-STA-30] reads the current player file once, conditionally, and earlier ones for unlisted players only', async () => {
    const { source, replay } = await recordedSource();
    const files = () => replay.requests.flatMap(({ path }) => /player_core_\d+/u.exec(path) ?? []);
    const listed = { season: CURRENT, players: PLAYERS };
    const first = await source.getPlayerRecords(open(), { ...listed, knownVersion: null });
    const version = first.ok && first.value.kind === 'read' ? first.value.version : null;
    await expect(
      source.getPlayerRecords(open(), { ...listed, knownVersion: version }),
    ).resolves.toMatchObject({ ok: true, value: { kind: 'not_modified' } });
    expect(files()).toStrictEqual(Array.from({ length: 4 }, () => 'player_core_2027'));
    await source.getPlayerRecords(open(), { ...listed, players: [FORMER], knownVersion: null });
    expect(files().slice(4)).toStrictEqual([
      'player_core_2027',
      'player_core_2027',
      'player_core_2026',
      'player_core_2026',
    ]);
    replay.withdraw('espn_nba_player_core/player_core_2027.csv');
    await expect(
      source.getPlayerRecords(open(), { ...listed, knownVersion: null }),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'not_published' } });
  });

  it('[TRV-12] [CL-TRV-14] maps the players of a season to their NBA Stats ids through the crosswalk', async () => {
    const { source } = await recordedSource();
    const mapped = await mappingsOf(source, { otherSource: 'nba_stats', season: SEASON });
    const mappings = mapped.ok ? mapped.value : [];
    expect(mappings).toHaveLength(370);
    expect(mappings).toContainEqual({ player: '9000192', otherPlayer: '8000001' });
    await expect(mappingsOf(source, { otherSource: 'fox', season: SEASON })).resolves.toMatchObject(
      { ok: false, error: { kind: 'not_published' } },
    );
    await expect(
      mappingsOf(source, { otherSource: 'nba_stats', season: CURRENT }),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'not_published' } });
  });

  it('[TRV-79] gives the attribution that the source license requires, for the Help screen', () => {
    expect(STATS_SOURCE_ATTRIBUTION).toBe(
      'NBA game data: SportsDataverse hoopR NBA data, compiled from ESPN, licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Egoscope computes its own indices from it.',
    );
  });
});
