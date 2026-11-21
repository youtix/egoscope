import { describe, expect, it } from 'vitest';

import { now, toEpochMs } from '@/lib/time';

import { createFakeStatsSource } from './fake';

import type { FakeStatsSource } from './fake';
import type { StatsSourceOutcome } from './port';
import type { CallContext, ConditionalRead, Season, SourceBoxScore, SourceGame } from './types';

const CURRENT = '2026-27';
const LAST = '2025-26';
const FIRST = '2024-25';
const UNCOVERED = '2023-24';
const DEADLINE_MS = 5000;
const ALL_PLAYERS = ['p01', 'p02', 'p03', 'p04', 'p05', 'p06', 'p07', 'p08', 'p09', 'p10'];

const open = (signal = new AbortController().signal, deadlineMs = DEADLINE_MS): CallContext => ({
  deadline: toEpochMs(now() + deadlineMs),
  signal,
});

/** The data of a read; anything else fails the test that asked for it. */
function dataOf<T>(outcome: StatsSourceOutcome<ConditionalRead<T>>): T {
  if (outcome.ok && outcome.value.kind === 'read') {
    return outcome.value.data;
  }
  throw new Error(`Expected a read, got ${JSON.stringify(outcome)}.`);
}

/** The version of a read, or null for any other answer, which makes the next read unconditional. */
const versionOf = (outcome: StatsSourceOutcome<ConditionalRead<unknown>>): string | null =>
  outcome.ok && outcome.value.kind === 'read' ? outcome.value.version : null;

const answerOf = (outcome: StatsSourceOutcome<unknown>): unknown =>
  outcome.ok ? outcome.value : outcome.error;

/** The team that won a final game. */
const winnerOf = ({ homeTeam, awayTeam, score }: SourceGame): string | null =>
  score !== null && score.home > score.away ? homeTeam : awayTeam;

/** The one item that `isPicked` picks, which the league must hold. */
function only<T>(items: readonly T[], isPicked: (item: T) => boolean): T {
  const [item, ...others] = items.filter((candidate) => isPicked(candidate));
  if (item === undefined || others.length > 0) {
    throw new Error('Expected the invented league to hold exactly one such item.');
  }
  return item;
}

async function gamesOf(
  season: Season,
  fake = createFakeStatsSource(),
): Promise<readonly SourceGame[]> {
  return dataOf(await fake.getSeasonGames(open(), { season, knownVersion: null })).games;
}

async function linesOf(
  season: Season,
  players: readonly string[],
  fake: FakeStatsSource = createFakeStatsSource(),
): Promise<readonly SourceBoxScore[]> {
  return dataOf(await fake.getSeasonBoxScores(open(), { season, players, knownVersion: null }));
}

async function gameOf(season: Season, game: string): Promise<SourceGame | undefined> {
  const games = await gamesOf(season);
  return games.find((candidate) => candidate.game === game);
}

/** The box score that `correctBoxScore` changes in the tests below. */
const isCorrected = ({ game }: SourceBoxScore): boolean => game === '2026-27:r01:h1';

describe('the invented league of the fake', () => {
  it('[STA-02] [CL-JOU-18] keeps a relocated team under its id, with the names of each season', async () => {
    const fake = createFakeStatsSource();
    const teamOf = async (season: Season) =>
      dataOf(await fake.getSeasonGames(open(), { season, knownVersion: null })).teams.find(
        ({ team }) => team === '6',
      );

    await expect(teamOf(FIRST)).resolves.toStrictEqual({
      team: '6',
      name: 'Gulls',
      abbreviation: 'SPG',
      location: 'Seaport',
    });
    await expect(teamOf(LAST)).resolves.toStrictEqual({
      team: '6',
      name: 'Gulls',
      abbreviation: 'RVG',
      location: 'Ridgeview',
    });
  });

  it('[STA-03] [JOU-10] lists two namesakes apart in the directory, each with his own teams', async () => {
    const fake = createFakeStatsSource();
    const directory = dataOf(
      await fake.getSeasonPlayers(open(), { season: LAST, knownVersion: null }),
    );

    expect(
      directory
        .filter((entry) => entry.displayName === 'Dario Castell')
        .map(({ player, otherNames, teams }) => ({
          player,
          otherNames,
          teams: teams.map(({ team }) => team),
        })),
    ).toStrictEqual([
      { player: 'p02', otherNames: ['D. Castell'], teams: ['2', '3'] },
      { player: 'p03', otherNames: ['D. Castell'], teams: ['4'] },
    ]);
  });

  it('[JOU-13] gives a player traded within the season each team with his first and last game day for it', async () => {
    const fake = createFakeStatsSource();
    const directory = dataOf(
      await fake.getSeasonPlayers(open(), { season: LAST, knownVersion: null }),
    );

    expect(directory.find(({ player }) => player === 'p02')?.teams).toStrictEqual([
      { team: '2', firstGameDay: '2025-10-21', lastGameDay: '2025-11-02' },
      { team: '3', firstGameDay: '2025-11-05', lastGameDay: '2025-12-05' },
    ]);
  });

  it('[STA-08] [JOU-13] has the traded player meet his former team', async () => {
    const lines = await linesOf(LAST, ['p02']);

    expect(lines.find(({ game }) => game === '2025-26:r10:h3')).toMatchObject({
      team: '3',
      opponent: '2',
      isHome: true,
      didNotPlay: false,
    });
  });

  it('[CL-JOU-16] gives a player his day and month of birth, never a year, which falls on a game day of his team', async () => {
    const fake = createFakeStatsSource();
    const records = dataOf(
      await fake.getPlayerRecords(open(), {
        season: CURRENT,
        players: ['p01'],
        knownVersion: null,
      }),
    );
    const games = await gamesOf(CURRENT, fake);
    const birthdayGame = games.find(({ game }) => game === '2026-27:r03:h1');

    expect(records.map(({ birthday }) => birthday)).toStrictEqual([{ month: 10, day: 26 }]);
    expect(birthdayGame).toMatchObject({ gameDay: '2026-10-26', homeTeam: '1', status: 'final' });
    await expect(linesOf(CURRENT, ['p01'], fake)).resolves.toContainEqual(
      expect.objectContaining({ game: '2026-27:r03:h1', didNotPlay: false }),
    );
  });

  it('[TRV-72] [CL-TRV-03] gives every game the US Eastern date of its tip-off, abroad as in the evening', async () => {
    const games = await gamesOf(LAST);
    const pick = (id: string) => games.find(({ game }) => game === id);

    expect(pick('2025-26:r08:h6')).toMatchObject({
      isNeutralSite: true,
      tipOff: 1_762_887_600_000,
      gameDay: '2025-11-11',
    });
    expect(pick('2025-26:r08:h3')).toMatchObject({
      isNeutralSite: false,
      tipOff: 1_762_907_400_000,
      gameDay: '2025-11-11',
    });
  });

  it('[STA-05] [CL-STA-17] keeps a postponed game, and links its make-up to it', async () => {
    const games = await gamesOf(CURRENT);

    expect(games.find(({ game }) => game === '2026-27:r03:h4')).toMatchObject({
      status: 'postponed',
      score: null,
      overtimes: null,
      makeUpOf: null,
    });
    expect(games.find(({ makeUpOf }) => makeUpOf === '2026-27:r03:h4')).toMatchObject({
      game: '2026-27:r03:h4:make-up',
      gameDay: '2026-11-05',
      homeTeam: '4',
      awayTeam: '2',
      status: 'final',
    });
  });

  it('[STA-05] [CL-STA-18] plays a play-in game, then series that eliminate a team', async () => {
    const games = await gamesOf(FIRST);
    const postseason = games.filter(({ phase }) => phase !== 'regular_season');
    const winners = postseason.map((game) => winnerOf(game));

    expect(
      postseason.map(({ game, phase, homeTeam, awayTeam, series }) => [
        game,
        phase,
        homeTeam,
        awayTeam,
        series?.round,
        series?.gameNumber,
      ]),
    ).toStrictEqual([
      ['2024-25:pi', 'play_in', '4', '5', 'play_in_7_vs_8', null],
      ['2024-25:s1g1', 'playoffs', '1', '4', 'first_round', 1],
      ['2024-25:s1g2', 'playoffs', '4', '1', 'first_round', 2],
      ['2024-25:s1g3', 'playoffs', '1', '4', 'first_round', 3],
      ['2024-25:s2g1', 'playoffs', '2', '3', 'first_round', 1],
      ['2024-25:s2g2', 'playoffs', '3', '2', 'first_round', 2],
      ['2024-25:s3g1', 'playoffs', '1', '2', 'finals', 1],
      ['2024-25:s3g2', 'playoffs', '2', '1', 'finals', 2],
      ['2024-25:s3g3', 'playoffs', '1', '2', 'finals', 3],
    ]);
    expect(winners).toStrictEqual(['4', '1', '4', '1', '2', '2', '2', '1', '1']);
  });

  it('[CL-STA-03] counts the overtimes of a final game, and none of a game not played yet', async () => {
    await expect(gameOf(FIRST, '2024-25:r09:h6')).resolves.toMatchObject({ overtimes: 2 });
    await expect(gameOf(FIRST, '2024-25:r01:h1')).resolves.toMatchObject({ overtimes: 0 });
    await expect(gameOf(CURRENT, '2026-27:r10:h3')).resolves.toMatchObject({
      status: 'scheduled',
      score: null,
      overtimes: null,
    });
  });

  it('[STA-12] gives whole minutes in one season, and minutes with seconds in the others', async () => {
    const [whole] = await linesOf(FIRST, ['p01']);
    const [exact] = await linesOf(LAST, ['p01']);

    expect(whole?.playingTime).toStrictEqual({ precision: 'whole_minutes', minutes: 34 });
    expect(exact?.playingTime).toStrictEqual({ precision: 'seconds', minutes: 34, seconds: 12 });
  });

  it('[STA-31] [CL-STA-14] starts a game whose time is to be determined at 00:00 US Eastern on its day', async () => {
    await expect(gameOf(CURRENT, '2026-27:r10:h5')).resolves.toMatchObject({
      isTimeKnown: false,
      tipOff: 1_794_805_200_000,
      gameDay: '2026-11-16',
      status: 'scheduled',
    });
  });

  it('[STA-35] [CL-STA-04] lists a final game without box scores, of which it has none', async () => {
    const fake = createFakeStatsSource();
    const { coverage } = dataOf(
      await fake.getSeasonGames(open(), { season: LAST, knownVersion: null }),
    );
    const lines = await linesOf(LAST, ALL_PLAYERS, fake);

    expect(coverage).toStrictEqual({
      phasesWithBoxScores: ['regular_season', 'play_in', 'playoffs'],
      gamesWithoutBoxScores: ['2025-26:r04:h4'],
    });
    expect(lines.filter(({ game }) => game === '2025-26:r04:h4')).toStrictEqual([]);
    expect(
      lines.filter(({ game }) => game === '2025-26:r04:h3').map(({ player }) => player),
    ).toStrictEqual(['p09', 'p04']);
  });

  it('[STA-45] [CL-STA-22] holds an uncovered season, before the first covered one, without any box score', async () => {
    const fake = createFakeStatsSource();
    const { games, coverage } = dataOf(
      await fake.getSeasonGames(open(), { season: UNCOVERED, knownVersion: null }),
    );
    const boxScores = await fake.getSeasonBoxScores(open(), {
      season: UNCOVERED,
      players: ALL_PLAYERS,
      knownVersion: null,
    });
    const before = await fake.getSeasonGames(open(), { season: '2022-23', knownVersion: null });

    expect(fake.firstCoveredSeason()).toBe(FIRST);
    expect(coverage).toStrictEqual({
      phasesWithBoxScores: [],
      gamesWithoutBoxScores: games.map(({ game }) => game),
    });
    expect(games).toHaveLength(30);
    expect(answerOf(boxScores)).toStrictEqual({ kind: 'not_published' });
    expect(answerOf(before)).toStrictEqual({ kind: 'not_published' });
  });

  it('[CL-STA-17] holds back a row whose status value it does not recognize, apart from the games', async () => {
    const fake = createFakeStatsSource();
    const { games, heldBack } = dataOf(
      await fake.getSeasonGames(open(), { season: CURRENT, knownVersion: null }),
    );

    expect(heldBack).toStrictEqual([{ game: '2026-27:r09:h6', status: 'Suspended' }]);
    expect(games.map(({ game }) => game)).not.toContain('2026-27:r09:h6');
    // 30 regular-season games, the one held back out and the make-up in, and the play-in placeholder.
    expect(games).toHaveLength(31);
  });

  it('[CL-STA-14] lists a play-in game whose teams are to be determined as a placeholder without teams', async () => {
    await expect(gameOf(CURRENT, '2026-27:pi')).resolves.toMatchObject({
      phase: 'play_in',
      exclusion: null,
      homeTeam: null,
      awayTeam: null,
      status: 'scheduled',
    });
  });

  it('[STA-04] [CL-STA-16] marks the All-Star game as never counting, between no franchises and without box scores', async () => {
    const lines = await linesOf(LAST, ALL_PLAYERS);

    await expect(gameOf(LAST, '2025-26:all-star')).resolves.toMatchObject({
      exclusion: 'all_star',
      homeTeam: null,
      awayTeam: null,
      phase: 'regular_season',
    });
    expect(lines.filter(({ game }) => game === '2025-26:all-star')).toStrictEqual([]);
  });

  it('[STA-08] gives a did-not-play line no playing time and no count, never its reason', async () => {
    const line = only(await linesOf(LAST, ['p08']), ({ game }) => game === '2025-26:r07:h4');

    expect(line).toMatchObject({
      didNotPlay: true,
      playingTime: null,
      team: '4',
      opponent: '5',
      ejected: null,
    });
    expect(Object.values(line.counts)).toStrictEqual(Array.from({ length: 13 }, () => null));
    expect(Object.keys(line)).not.toContain('reason');
  });

  it('[STA-25] [CL-STA-27] keeps a player listed with his team, one listed without, and one not listed apart', async () => {
    const fake = createFakeStatsSource();
    const outcome = await fake.getPlayerRecords(open(), {
      season: CURRENT,
      players: ['p01', 'p08', 'p06'],
      knownVersion: null,
    });

    expect(dataOf(outcome)).toStrictEqual([
      {
        player: 'p01',
        displayName: 'Ansel Varga',
        birthday: { month: 10, day: 26 },
        currentTeam: { kind: 'team', team: '1' },
      },
      {
        player: 'p08',
        displayName: 'Bram Heller',
        birthday: { month: 9, day: 30 },
        currentTeam: { kind: 'without_team' },
      },
      {
        player: 'p06',
        displayName: 'Teodor Quill',
        birthday: { month: 5, day: 21 },
        currentTeam: { kind: 'not_listed' },
      },
    ]);
    // The current season's file, then the two earlier ones until the retired player is found.
    expect(outcome.call).toMatchObject({ httpRequests: 3, fileRequests: 3 });
  });

  it('[CL-STA-30] answers not_published while the season player file is not out, and serves the rest', async () => {
    const fake = createFakeStatsSource();
    fake.inject({ kind: 'not_published', resource: 'player_records', season: CURRENT });
    const records = await fake.getPlayerRecords(open(), {
      season: CURRENT,
      players: ['p01'],
      knownVersion: null,
    });

    expect(answerOf(records)).toStrictEqual({ kind: 'not_published' });
    expect(await gamesOf(CURRENT, fake)).toHaveLength(31);
  });
});

describe('the faults of the fake', () => {
  it('[CL-STA-15] fails as an outage as many times as asked, then answers', async () => {
    const fake = createFakeStatsSource();
    fake.inject({ kind: 'outage', times: 2 });
    const probe = async () => answerOf(await fake.getPublication(open(), { knownVersion: null }));

    await expect(probe()).resolves.toStrictEqual({ kind: 'unavailable' });
    await expect(probe()).resolves.toStrictEqual({ kind: 'unavailable' });
    await expect(probe()).resolves.toMatchObject({
      kind: 'read',
      data: { refreshedAt: 1_794_141_000_000 },
    });
  });

  it('[STA-39] [CL-STA-15] answers rate_limited with its delay once the calls allowed are used, until cleared', async () => {
    const fake = createFakeStatsSource();
    fake.inject({ kind: 'rate_limited', afterCalls: 1, retryAfterMs: 3_600_000 });
    const probe = async () => answerOf(await fake.checkHealth(open()));

    await expect(probe()).resolves.toBeNull();
    await expect(probe()).resolves.toStrictEqual({ kind: 'rate_limited', retryAfterMs: 3_600_000 });
    await expect(probe()).resolves.toStrictEqual({ kind: 'rate_limited', retryAfterMs: 3_600_000 });
    fake.clearFaults();
    await expect(probe()).resolves.toBeNull();
  });

  it('[CL-STA-15] outlasts the deadline as an outage, and stops at once when its call aborts', async () => {
    const fake = createFakeStatsSource();
    fake.inject({ kind: 'slow', times: 2 });
    const controller = new AbortController();
    const late = fake.getSeasonGames(open(undefined, 20), { season: LAST, knownVersion: null });
    const stopped = fake.getSeasonGames(open(controller.signal), {
      season: LAST,
      knownVersion: null,
    });
    controller.abort();

    expect(await stopped).toMatchObject({
      ok: false,
      error: { kind: 'aborted' },
      call: { httpRequests: 1 },
    });
    expect(await late).toMatchObject({
      ok: false,
      error: { kind: 'unavailable' },
      call: { httpRequests: 1 },
    });
    await expect(gamesOf(LAST, fake)).resolves.toHaveLength(40);
  });

  it('[CL-STA-15] answers schema_changed for the changed resource of that season only', async () => {
    const fake = createFakeStatsSource();
    fake.inject({ kind: 'schema_changed', resource: 'season_games', season: LAST });
    const changed = await fake.getSeasonGames(open(), { season: LAST, knownVersion: null });

    expect(answerOf(changed)).toStrictEqual({ kind: 'schema_changed' });
    expect(await gamesOf(FIRST, fake)).toHaveLength(39);
    expect(await linesOf(LAST, ['p01'], fake)).not.toHaveLength(0);
  });

  it('[STA-33] changes a corrected box score between two reads, and the version of its season', async () => {
    const fake = createFakeStatsSource();
    const request = { season: CURRENT, players: ['p01'] };
    const first = await fake.getSeasonBoxScores(open(), { ...request, knownVersion: null });
    fake.correctBoxScore({
      game: '2026-27:r01:h1',
      player: 'p01',
      counts: { points: 40, assists: null },
    });
    const second = await fake.getSeasonBoxScores(open(), {
      ...request,
      knownVersion: versionOf(first),
    });
    const third = await fake.getSeasonBoxScores(open(), {
      ...request,
      knownVersion: versionOf(second),
    });

    expect(only(dataOf(first), isCorrected).counts).toMatchObject({ points: 21, assists: 5 });
    expect(only(dataOf(second), isCorrected).counts).toMatchObject({
      points: 40,
      assists: null,
      fieldGoalsMade: 8,
    });
    expect(versionOf(second)).not.toBe(versionOf(first));
    expect(answerOf(third)).toStrictEqual({ kind: 'not_modified' });
  });

  it('refuses to correct a box score that the league does not hold', () => {
    const fake = createFakeStatsSource();

    expect(() => {
      fake.correctBoxScore({ game: '2026-27:r01:h1', player: 'p07', counts: { points: 1 } });
    }).toThrow('The invented league holds no box score of p07 in 2026-27:r01:h1.');
  });

  it('[CL-TRV-23] reports a late refresh with its instant and a new version', async () => {
    const fake = createFakeStatsSource();
    const first = await fake.getPublication(open(), { knownVersion: null });
    const unchanged = await fake.getPublication(open(), { knownVersion: versionOf(first) });
    fake.refresh(toEpochMs(1_794_236_400_000));
    const refreshed = await fake.getPublication(open(), { knownVersion: versionOf(first) });

    expect(dataOf(first)).toStrictEqual({ refreshedAt: 1_794_141_000_000 });
    expect(answerOf(unchanged)).toStrictEqual({ kind: 'not_modified' });
    expect(dataOf(refreshed)).toStrictEqual({ refreshedAt: 1_794_236_400_000 });
  });

  it('[CL-STA-15] counts one file per file answered, no bytes when not modified, and no file when refused', async () => {
    const fake = createFakeStatsSource();
    const read = await fake.getSeasonPlayers(open(), { season: LAST, knownVersion: null });
    const again = await fake.getSeasonPlayers(open(), {
      season: LAST,
      knownVersion: versionOf(read),
    });
    const controller = new AbortController();
    controller.abort();
    const refused = await fake.getSeasonPlayers(open(), { season: '2022-23', knownVersion: null });
    const aborted = await fake.getSeasonPlayers(open(controller.signal), {
      season: LAST,
      knownVersion: null,
    });

    expect(read.call).toMatchObject({ httpRequests: 1, fileRequests: 1 });
    expect(read.call.bytesReceived).toBeGreaterThan(0);
    expect(again.call).toStrictEqual({ httpRequests: 1, bytesReceived: 0, fileRequests: 1 });
    expect(refused.call).toStrictEqual({ httpRequests: 1, bytesReceived: 0, fileRequests: 0 });
    expect(aborted.call).toStrictEqual({ httpRequests: 0, bytesReceived: 0, fileRequests: 0 });
  });
});
