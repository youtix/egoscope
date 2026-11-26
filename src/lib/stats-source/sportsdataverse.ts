// The real adapter of the statistics source (module map §2.3, §5): the SportsDataverse
// release files compiled from ESPN (docs/services/statistics-source.md). One call reads
// one season's file, conditionally on its stored version; the requests are in
// sportsdataverse-http.ts, and the rows, which stream through a CSV splitter so that
// no file is held whole in memory, in sportsdataverse-rows.ts and
// sportsdataverse-schedule.ts (statistics-source evaluation, sections 10 and 12).
import { localOccurrenceInstant, parseTimestamp } from '@/lib/time';

import { CsvReader } from './sportsdataverse-csv';
import { fail, SourceCall, succeed } from './sportsdataverse-http';
import { boxScoreSink, crosswalkSink, playerFileSink } from './sportsdataverse-rows';
import { scheduleSink, withinSeason, yearOf } from './sportsdataverse-schedule';

import type { StatsSourceError } from './errors';
import type { StatsSource, StatsSourceOutcome } from './port';
import type { RowSink } from './sportsdataverse-csv';
import type { BodyReader, Step } from './sportsdataverse-http';
import type { BoxScoreFile } from './sportsdataverse-rows';
import type {
  CallContext,
  ConditionalRead,
  PlayerRecord,
  PlayersRequest,
  Publication,
  Season,
  SeasonBoxScoresRead,
  SeasonRequest,
  SourcePlayerId,
  SourceVersion,
} from './types';
import type { EpochMs } from '@/lib/time';

/** The attribution that the source's CC BY 4.0 license requires, as the service sheet words it (TRV-79). */
export const STATS_SOURCE_ATTRIBUTION =
  'NBA game data: SportsDataverse hoopR NBA data, compiled from ESPN, licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Egoscope computes its own indices from it.';

/** The documented address of the release files, which STATS_SOURCE_BASE_URL may replace. */
const RELEASES_URL = 'https://github.com/sportsdataverse/sportsdataverse-data/releases/download';

/** The players whose records a lookup in earlier player files still has to find. */
type Lookup = Readonly<{ fileYear: number; missing: readonly SourcePlayerId[] }>;

type PlayerRecords = ReadonlyMap<SourcePlayerId, PlayerRecord>;

/** A read of a season's box-score file, which the operations of one call context share. */
type BoxScoreRead = Promise<Step<ConditionalRead<BoxScoreFile>>>;

const FIRST_COVERED_SEASON = '1993-94';
// The publisher writes the refresh time of its probe file in New York time.
const PUBLISHER_ZONE = 'America/New_York';
const LAST_UPDATED = /"last_updated"\s*:\s*"(?<local>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/u;
const PROBE = 'espn_nba_player_boxscores/timestamp.json';
// The other sources whose identifiers the player crosswalk gives, by column (CL-TRV-14).
const OTHER_SOURCES: ReadonlyMap<string, string> = new Map([['nba_stats', 'nba_player_id']]);
const ABORTED: StatsSourceError = { kind: 'aborted' };
const NOT_PUBLISHED: StatsSourceError = { kind: 'not_published' };
const SCHEMA_CHANGED: StatsSourceError = { kind: 'schema_changed' };
const NOT_LISTED = { kind: 'not_listed' } as const;
const NO_CALL = { httpRequests: 0, bytesReceived: 0, fileRequests: 0 };

/** The year that ends `season`, which names its files: `2025` for 2024-25. */
const fileYearOf = (season: Season): number => yearOf(season) + 1;
const FIRST_FILE_YEAR = fileYearOf(FIRST_COVERED_SEASON);

/** The file of each resource of the season that ends in `year`. */
const FILES = {
  schedule: (year: number) => `espn_nba_schedules/nba_schedule_${String(year)}.csv`,
  boxScores: (year: number) => `espn_nba_player_boxscores/player_box_${String(year)}.csv`,
  players: (year: number) => `espn_nba_player_core/player_core_${String(year)}.csv`,
  crosswalk: (year: number) => `nba_crosswalk/nba_player_crosswalk_${String(year)}.csv`,
};

// The box-score file read last in each call context, so that the box scores and the
// directory of one season asked in one context share one download (module map §5),
// while a context that walks the seasons keeps one season's file alive, not each one.
const boxScoreReads = new WeakMap<CallContext, Readonly<{ key: string; read: BoxScoreRead }>>();

/** Reads a CSV body into `sink`; a file it cannot read has a changed layout (section 10, rule 11). */
const csvOf =
  <T>(sink: RowSink<T>): BodyReader<T> =>
  async (call, { body }) => {
    const reader = new CsvReader(sink);
    const drained = await call.drain(body, (text) => reader.push(text));
    if (!drained.ok) {
      return drained;
    }
    const data = drained.value ? reader.end() : undefined;
    return data === undefined ? fail(SCHEMA_CHANGED) : succeed(data);
  };

/** Reads a box-score file for the days of `season`. */
const boxScoreReader = (season: Season): BodyReader<BoxScoreFile> =>
  csvOf(boxScoreSink(withinSeason(season)));

/** Reads the rows of `players` in a player file. */
const playerFileReader = (players: readonly SourcePlayerId[]): BodyReader<PlayerRecords> =>
  csvOf(playerFileSink(new Set(players)));

/** The refresh instant: the `Last-Modified` header, else the body's time read in New York (evaluation, section 12). */
function refreshedAtOf(lastModified: string | null, text: string): EpochMs | undefined {
  const header = parseTimestamp(lastModified ?? '');
  if (header.ok && header.timestamp.kind === 'instant') {
    return header.timestamp.at;
  }
  const local = parseTimestamp(LAST_UPDATED.exec(text)?.groups?.['local'] ?? '');
  return local.ok && local.timestamp.kind === 'no_offset'
    ? localOccurrenceInstant(local.timestamp.on, local.timestamp.time, PUBLISHER_ZONE)
    : undefined;
}

/** Reads the probe file: its `Last-Modified` header, its body as a fallback (CL-TRV-23). */
const publicationOf: BodyReader<Publication> = async (call, { body, lastModified }) => {
  const chunks: string[] = [];
  const drained = await call.drain(body, (text) => {
    chunks.push(text);
    return true;
  });
  if (!drained.ok) {
    return drained;
  }
  const refreshedAt = refreshedAtOf(lastModified, chunks.join(''));
  return refreshedAt === undefined ? fail(SCHEMA_CHANGED) : succeed({ refreshedAt });
};

/** Runs one operation: `aborted` at once for an aborted signal, else its steps, with what they cost. */
async function run<T>(
  ctx: CallContext,
  work: (call: SourceCall) => Promise<Step<T>>,
): Promise<StatsSourceOutcome<T>> {
  if (ctx.signal.aborted) {
    return { ok: false, error: ABORTED, call: NO_CALL };
  }
  const call = new SourceCall(ctx);
  const step = await work(call);
  return step.ok
    ? { ok: true, value: step.value, call: call.metadata }
    : { ok: false, error: step.error, call: call.metadata };
}

/** A read's data through `pick`; a failure and `not_modified` pass unchanged. */
function pickData<T, U>(
  read: Step<ConditionalRead<T>>,
  pick: (data: T) => U,
): Step<ConditionalRead<U>> {
  if (!read.ok) {
    return read;
  }
  const { value } = read;
  return value.kind === 'read' ? succeed({ ...value, data: pick(value.data) }) : succeed(value);
}

/** The lines of `players` in a box-score file read, with the sides of each of its games that hold lines; a failure and `not_modified` pass unchanged (CL-STA-04). */
function linesOf(
  read: Step<ConditionalRead<BoxScoreFile>>,
  players: ReadonlySet<SourcePlayerId>,
): Step<SeasonBoxScoresRead> {
  if (!read.ok) {
    return read;
  }
  const { value } = read;
  if (value.kind === 'not_modified') {
    return succeed(value);
  }
  const { lines, sidesWithLines } = value.data;
  const data = lines.filter((line) => players.has(line.player));
  return succeed({ kind: 'read', version: value.version, data, sidesWithLines });
}

/** The requested players' records in request order, or `not_found` naming those no file lists. */
function recordsOf(
  players: readonly SourcePlayerId[],
  version: SourceVersion,
  found: PlayerRecords,
): Step<ConditionalRead<readonly PlayerRecord[]>> {
  const missing = players.filter((player) => !found.has(player));
  const records = players.flatMap((player) => found.get(player) ?? []);
  return missing.length > 0
    ? fail({ kind: 'not_found', players: missing })
    : succeed({ kind: 'read', version, data: records });
}

/** The SportsDataverse adapter, reading the release files under `baseUrl`. */
class SportsDataverse implements StatsSource {
  readonly #baseUrl: string;

  readonly checkHealth: StatsSource['checkHealth'] = async (ctx) =>
    run(ctx, async (call) => call.probe(this.#url(PROBE)));

  readonly getPublication: StatsSource['getPublication'] = async (ctx, { knownVersion }) =>
    run(ctx, async (call) => call.read({ address: this.#url(PROBE), knownVersion }, publicationOf));

  readonly getSeasonGames: StatsSource['getSeasonGames'] = async (ctx, { season, knownVersion }) =>
    run(ctx, async (call) => {
      const address = this.#url(FILES.schedule(fileYearOf(season)));
      return call.read({ address, knownVersion }, csvOf(scheduleSink(season)));
    });

  readonly getSeasonBoxScores: StatsSource['getSeasonBoxScores'] = async (ctx, request) =>
    run(ctx, async (call) => {
      const read = await this.#boxScores(ctx, call, request);
      return linesOf(read, new Set(request.players));
    });

  readonly getSeasonPlayers: StatsSource['getSeasonPlayers'] = async (ctx, request) =>
    run(ctx, async (call) => {
      const read = await this.#boxScores(ctx, call, request);
      return pickData(read, ({ directory }) => directory);
    });

  readonly getPlayerRecords: StatsSource['getPlayerRecords'] = async (ctx, request) =>
    run(ctx, async (call) => this.#records(call, request));

  readonly mapPlayers: NonNullable<StatsSource['mapPlayers']> = async (ctx, request) =>
    run(ctx, async (call) => {
      const column = OTHER_SOURCES.get(request.otherSource);
      if (column === undefined) {
        return fail(NOT_PUBLISHED);
      }
      const address = this.#url(FILES.crosswalk(fileYearOf(request.season)));
      return call.readFile(address, csvOf(crosswalkSink(column)));
    });

  readonly firstCoveredSeason = (): Season => FIRST_COVERED_SEASON;

  constructor(baseUrl: string) {
    this.#baseUrl = baseUrl;
  }

  /** The address of `file`. */
  #url(file: string): string {
    return `${this.#baseUrl}/${file}`;
  }

  /**
   * The season's box-score file, downloaded once while the call context asks for that
   * season, and kept until it asks for another (evaluation, section 12).
   */
  async #boxScores(
    ctx: CallContext,
    call: SourceCall,
    { season, knownVersion }: SeasonRequest,
  ): Promise<Step<ConditionalRead<BoxScoreFile>>> {
    const address = this.#url(FILES.boxScores(fileYearOf(season)));
    const key = `${address} ${knownVersion ?? ''}`;
    const kept = boxScoreReads.get(ctx);
    if (kept?.key === key) {
      return kept.read;
    }
    const read = call.read({ address, knownVersion }, boxScoreReader(season));
    boxScoreReads.set(ctx, { key, read });
    return read;
  }

  /**
   * The records of the season's player file, read for the current season (CL-STA-27):
   * a listed player's row gives his team, or none for a release, which its free-agent
   * status or its empty team id reports (CL-STA-31). A player it does not list is looked
   * up in earlier files, newest first, for his name and birthday, and is `not_listed`
   * whatever an earlier row says, a free-agent status included: no observation, never
   * a release (evaluation, section 12, `getPlayerRecords`).
   */
  async #records(
    call: SourceCall,
    { season, players, knownVersion }: PlayersRequest,
  ): Promise<Step<ConditionalRead<readonly PlayerRecord[]>>> {
    const fileYear = fileYearOf(season);
    const address = this.#url(FILES.players(fileYear));
    const read = await call.read({ address, knownVersion }, playerFileReader(players));
    if (!read.ok) {
      return read;
    }
    const { value } = read;
    if (value.kind === 'not_modified') {
      return succeed(value);
    }
    const missing = players.filter((player) => !value.data.has(player));
    const earlier = await this.#recordsBefore(call, { fileYear, missing });
    return earlier.ok
      ? recordsOf(players, value.version, new Map([...value.data, ...earlier.value]))
      : earlier;
  }

  /** What the player files before `fileYear` give of `missing`, down to the first covered season; a missing file is skipped. */
  async #recordsBefore(
    call: SourceCall,
    { fileYear, missing }: Lookup,
  ): Promise<Step<PlayerRecords>> {
    const found = new Map<SourcePlayerId, PlayerRecord>();
    for (
      let year = fileYear - 1;
      year >= FIRST_FILE_YEAR && found.size < missing.length;
      year -= 1
    ) {
      const wanted = missing.filter((player) => !found.has(player));
      const address = this.#url(FILES.players(year));
      const read = await call.readFile(address, playerFileReader(wanted));
      if (!read.ok && read.error.kind !== 'not_published') {
        return read;
      }
      const records = read.ok ? read.value.values() : [];
      for (const record of records) {
        found.set(record.player, { ...record, currentTeam: NOT_LISTED });
      }
    }
    return succeed(found);
  }
}

/**
 * The SportsDataverse adapter of the statistics source, reading the release files at
 * `baseUrl` (STA-01, STA-02, TRV-15; the statistics service sheet and the
 * evaluation, sections 10 and 12): one season's file per call, every read
 * conditional on its stored version, the box scores and the directory of a season
 * asked in one call context read from one download.
 */
export function createSportsDataverseSource(baseUrl: string = RELEASES_URL): StatsSource {
  return new SportsDataverse(baseUrl);
}
