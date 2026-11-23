import 'server-only';

import { adapterFor, readServerEnv } from '@/lib/env';

import { createFakeStatsSource } from './fake';
import { createSportsDataverseSource } from './sportsdataverse';

import type { StatsSourceError } from './errors';
import type { FakeStatsSource } from './fake';
import type {
  CallContext,
  CallMetadata,
  ConditionalRead,
  DirectoryEntry,
  PlayerMapping,
  PlayerRecord,
  PlayersRequest,
  Publication,
  Season,
  SeasonGames,
  SeasonRequest,
  SourceBoxScore,
  SourceVersion,
} from './types';

/** An operation's answer, with what the call cost whether it succeeded or failed (module map §5). */
export type StatsSourceOutcome<T> = Readonly<
  | { ok: true; value: T; call: CallMetadata }
  | { ok: false; error: StatsSourceError; call: CallMetadata }
>;

/** An operation that calls out: it takes a call context, and answers with its outcome. */
type Operation<Request, T> = (ctx: CallContext, request: Request) => Promise<StatsSourceOutcome<T>>;

/**
 * The statistics source, whatever serves it (STA-01, STA-02, TRV-15). One call reads
 * at most one season's resources, except `getPlayerRecords`, which looks up in earlier
 * seasons' player files a requested player that the season's own does not list; every
 * read is conditional on the version stored from the last one (STA-42).
 */
export type StatsSource = Readonly<{
  /** One conditional request, for the installation check (TRV-47). */
  checkHealth: (ctx: CallContext) => Promise<StatsSourceOutcome<null>>;
  /** The source's last refresh instant and its version, and nothing more (CL-TRV-23). */
  getPublication: Operation<
    Readonly<{ knownVersion: SourceVersion | null }>,
    ConditionalRead<Publication>
  >;
  /** Every game of the season, past and upcoming, with its teams, coverage and held-back rows (STA-05, CL-STA-17). */
  getSeasonGames: Operation<SeasonRequest, ConditionalRead<SeasonGames>>;
  /** The requested players' box scores of the season, did-not-play lines included (STA-08). */
  getSeasonBoxScores: Operation<PlayersRequest, ConditionalRead<readonly SourceBoxScore[]>>;
  /** The season's player directory, in which candidate search runs (STA-03, JOU-10, JOU-13). */
  getSeasonPlayers: Operation<SeasonRequest, ConditionalRead<readonly DirectoryEntry[]>>;
  /**
   * The requested players' records from the season's player file, read for the current
   * season: `not_published` while that file is not out (CL-STA-30); a player it does not
   * list is looked up in earlier seasons' files for his name and birthday, and his team
   * is no observation (CL-STA-27); `not_found` names the players no file lists.
   */
  getPlayerRecords: Operation<PlayersRequest, ConditionalRead<readonly PlayerRecord[]>>;
  /** The oldest season the source covers: a constant of the adapter, which costs no request (CL-STA-22). */
  firstCoveredSeason: () => Season;
  /** Each player's identifier in another source, where the source publishes a crosswalk (CL-TRV-14). */
  mapPlayers?: Operation<
    Readonly<{ otherSource: string; season: Season }>,
    readonly PlayerMapping[]
  >;
}>;

/** The statistics source that this deployment uses, or why it has none. */
export type StatsSourceAccess =
  | Readonly<{ ok: true; source: StatsSource }>
  | Readonly<{ ok: false; error: Readonly<{ kind: 'not_configured' }> }>;

const NOT_CONFIGURED: StatsSourceAccess = { ok: false, error: { kind: 'not_configured' } };

// The fake of the whole process lives on globalThis under a registered symbol, so
// that every copy of this module (a bundle of the server, a reload of `next dev`)
// serves the same league and the same scripted faults.
const SHARED_FAKE = Symbol.for('egoscope.stats-source.fake');

const isFake = (value: unknown): value is FakeStatsSource =>
  typeof value === 'object' && value !== null && 'inject' in value;

/**
 * The fake that the whole process shares, which the accessor serves under
 * EGOSCOPE_FAKES, and which the hermetic end-to-end controls script (STA-01, TRV-15).
 */
export function fakeStatsSource(): FakeStatsSource {
  const existing: unknown = Reflect.get(globalThis, SHARED_FAKE);
  if (isFake(existing)) {
    return existing;
  }
  const fake = createFakeStatsSource();
  Reflect.set(globalThis, SHARED_FAKE, fake);
  return fake;
}

/**
 * The statistics source that `env.adapterFor` names (module map §5): the shared fake
 * under EGOSCOPE_FAKES, else the SportsDataverse adapter, at STATS_SOURCE_BASE_URL
 * when it is set, and "not configured" while the configuration is invalid (STA-01,
 * TRV-15).
 */
export function statsSource(): StatsSourceAccess {
  if (adapterFor('stats-source') === 'fake') {
    return { ok: true, source: fakeStatsSource() };
  }
  const env = readServerEnv();
  return env.ok
    ? { ok: true, source: createSportsDataverseSource(env.env.STATS_SOURCE_BASE_URL) }
    : NOT_CONFIGURED;
}
