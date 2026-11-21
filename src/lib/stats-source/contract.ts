// The behavior every adapter of the statistics source shares (module map §2.3, §5):
// the port's own tests run each case against the fake, and against the recorded
// fixtures of each real adapter, and expect it to find no problem. A case returns
// the problems it finds, each naming its offenders, so that a failure says what an
// adapter got wrong. The cases that read the games are in contract-games.ts, and the
// harness with what the cases share in contract-support.ts. Never re-exported by
// index.ts.
import { now } from '@/lib/time';

import {
  datesGames,
  listsDirectory,
  namesTeams,
  placesBoxScores,
  scoresGames,
} from './contract-games';
import {
  answerOf,
  context,
  DEADLINE_MS,
  open,
  problem,
  readOf,
  seasonReads,
  versionOf,
} from './contract-support';

import type { ContractFault, Problems, StatsSourceHarness } from './contract-support';
import type { StatsSourceErrorKind } from './errors';

/** One behavior of the contract: its title, and the problems that an adapter shows against it. */
type ContractCase = Readonly<{
  title: string;
  check: (harness: StatsSourceHarness) => Promise<Problems>;
}>;

// A deadline that a slow answer outlasts.
const SHORT_DEADLINE_MS = 20;
// How much earlier than its deadline the clock may read after a slow answer: a timer
// of exactly the time left can end a millisecond early by the clock, since the two
// count whole milliseconds apart.
const CLOCK_TOLERANCE_MS = 1;
const FAULTS: readonly (readonly [ContractFault, StatsSourceErrorKind])[] = [
  ['outage', 'unavailable'],
  ['rate_limited', 'rate_limited'],
  ['schema_changed', 'schema_changed'],
  ['slow', 'unavailable'],
];

async function checksHealth({ source }: StatsSourceHarness): Promise<Problems> {
  const outcome = await source.checkHealth(open());
  return [
    ...problem(
      'health not checked',
      [answerOf(outcome)].filter((answer) => answer !== 'ok'),
    ),
    ...problem(
      'health checked with more than one request',
      [outcome.call].filter((call) => call.httpRequests > 1),
    ),
  ];
}

async function readsPublication({ source }: StatsSourceHarness): Promise<Problems> {
  const first = await source.getPublication(open(), { knownVersion: null });
  const again = await source.getPublication(open(), { knownVersion: versionOf(first) });
  return [
    ...problem(
      'publication not read',
      [answerOf(first)].filter((answer) => answer !== 'read'),
    ),
    ...problem(
      'publication read again for its version',
      [answerOf(again)].filter((answer) => answer !== 'not_modified'),
    ),
  ];
}

/** What a read and its repetition with the version it gave answered, and what the repetition cost. */
type RepeatedRead = Readonly<{
  name: string;
  first: string;
  again: string;
  files: number;
  bytes: number;
}>;

/** A read, then `not_modified` for its version, with one file counted and no bytes received (STA-42). */
const isConditional = ({ first, again, files, bytes }: RepeatedRead): boolean =>
  first === 'read' && again === 'not_modified' && files === 1 && bytes === 0;

async function answersNotModified(harness: StatsSourceHarness): Promise<Problems> {
  const answers = await Promise.all(
    seasonReads(harness, harness.season, harness.currentSeason).map(
      async ([name, read]): Promise<RepeatedRead> => {
        const first = await read(null);
        const again = await read(versionOf(first));
        const { fileRequests: files, bytesReceived: bytes } = again.call;
        return { name, first: answerOf(first), again: answerOf(again), files, bytes };
      },
    ),
  );
  return problem(
    'reads not answered not_modified for their version, with one file counted and no bytes',
    answers.filter((answer) => !isConditional(answer)),
  );
}

async function answersNotPublished(harness: StatsSourceHarness): Promise<Problems> {
  const { missingSeason } = harness;
  const answers = await Promise.all(
    seasonReads(harness, missingSeason, missingSeason).map(async ([name, read]) => ({
      name,
      answer: answerOf(await read(null)),
    })),
  );
  return problem(
    'reads of a season it does not hold that are not not_published',
    answers.filter(({ answer }) => answer !== 'not_published'),
  );
}

async function keepsUnlistedApart(harness: StatsSourceHarness): Promise<Problems> {
  const { source, currentSeason, players, formerPlayer } = harness;
  const requested = [...players, formerPlayer];
  const outcome = await source.getPlayerRecords(open(), {
    season: currentSeason,
    players: requested,
    knownVersion: null,
  });
  const records = (readOf(outcome) ?? []).map(({ player, currentTeam }) => ({
    player,
    listed: currentTeam.kind !== 'not_listed',
  }));
  const expected = requested.map((player) => ({ player, listed: player !== formerPlayer }));
  return problem(
    'records not one per player, a player the current file does not list kept apart',
    JSON.stringify(records) === JSON.stringify(expected) ? [] : [records],
  );
}

async function namesUnknownPlayers(harness: StatsSourceHarness): Promise<Problems> {
  const { source, currentSeason, players, unknownPlayer } = harness;
  const outcome = await source.getPlayerRecords(open(), {
    season: currentSeason,
    players: [...players, unknownPlayer],
    knownVersion: null,
  });
  const named = !outcome.ok && outcome.error.kind === 'not_found' ? outcome.error.players : [];
  return problem(
    'players that no file lists not named by not_found',
    named.join(',') === unknownPlayer ? [] : [named],
  );
}

async function abortsEveryOperation(harness: StatsSourceHarness): Promise<Problems> {
  const { source, season, players } = harness;
  const controller = new AbortController();
  controller.abort();
  const ctx = context(controller.signal);
  const answers = await Promise.all([
    source.checkHealth(ctx),
    source.getPublication(ctx, { knownVersion: null }),
    source.getSeasonGames(ctx, { season, knownVersion: null }),
    source.getSeasonBoxScores(ctx, { season, players, knownVersion: null }),
    source.getSeasonPlayers(ctx, { season, knownVersion: null }),
    source.getPlayerRecords(ctx, { season, players, knownVersion: null }),
  ]);
  return problem(
    'answers to an aborted signal that are not aborted',
    answers.map((outcome) => answerOf(outcome)).filter((answer) => answer !== 'aborted'),
  );
}

/** Each fault answered as the port says, a slow answer no earlier than the call's deadline (CL-STA-15). */
async function meetsFaults(harness: StatsSourceHarness): Promise<Problems> {
  const answers = [];
  for (const [fault, expected] of FAULTS) {
    harness.inject(fault);
    const isSlow = fault === 'slow';
    const ctx = context(new AbortController().signal, isSlow ? SHORT_DEADLINE_MS : DEADLINE_MS);
    const outcome = await harness.source.getSeasonGames(ctx, {
      season: harness.season,
      knownVersion: null,
    });
    const isEarly = isSlow && now() < ctx.deadline - CLOCK_TOLERANCE_MS;
    answers.push({ fault, expected, answer: answerOf(outcome), isEarly });
  }
  return [
    ...problem(
      'faults not answered as the port says',
      answers
        .filter(({ expected, answer }) => answer !== expected)
        .map(({ fault, expected, answer }) => ({ fault, expected, answer })),
    ),
    ...problem(
      'slow answers given before the deadline of their call',
      answers.filter(({ isEarly }) => isEarly).map(({ fault }) => fault),
    ),
  ];
}

async function holdsFirstSeason({ source }: StatsSourceHarness): Promise<Problems> {
  const season = source.firstCoveredSeason();
  const answer = answerOf(await source.getSeasonGames(open(), { season, knownVersion: null }));
  return problem('first covered season not held', answer === 'read' ? [] : [season]);
}

/** The contract of the statistics-source port: each case finds no problem in a sound adapter. */
export const STATS_SOURCE_CONTRACT: readonly ContractCase[] = [
  { title: 'checks its health with one request at most', check: checksHealth },
  {
    title: 'reads the publication, then answers not_modified for its version',
    check: readsPublication,
  },
  { title: 'gives every game the US Eastern date of its tip-off as its day', check: datesGames },
  { title: 'lists among the season teams every team that its games name', check: namesTeams },
  { title: 'scores the final games and holds back rows apart from the games', check: scoresGames },
  {
    title: 'answers not_modified to the version that each season read gave',
    check: answersNotModified,
  },
  { title: 'answers not_published for a season that it does not hold', check: answersNotPublished },
  {
    title: 'returns the requested box scores only, each between a team and its opponent',
    check: placesBoxScores,
  },
  {
    title:
      'lists in each directory every player of the box scores, each team from his first to his last game day with it',
    check: listsDirectory,
  },
  {
    title: 'gives one record per player, and keeps an unlisted one apart',
    check: keepsUnlistedApart,
  },
  { title: 'names in not_found the players that no file lists', check: namesUnknownPlayers },
  {
    title: 'answers aborted to every operation once the signal has aborted',
    check: abortsEveryOperation,
  },
  {
    title:
      'answers outages, quota answers, changed layouts and late answers as the port says, a late one not before its deadline',
    check: meetsFaults,
  },
  { title: 'holds the first season that it covers', check: holdsFirstSeason },
];
