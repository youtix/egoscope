// The scriptable fake of the statistics source (module map §5): it serves the
// invented league of data/fixtures/stats-source/world/ and, on demand, the faults
// that a real source shows. It is the adapter of the tests, of development and of
// the hermetic end-to-end mode, and it reports the cost of each call as an adapter
// of the chosen source would: one HTTP request and one counted file request per
// file answered, none counted for a refused one, and no bytes for `not_modified`.
import { now } from '@/lib/time';

import { buildWorld } from './fake-world';

import type { StatsSourceError } from './errors';
import type { WorldSeason } from './fake-world';
import type { StatsSource, StatsSourceOutcome } from './port';
import type {
  BoxScoreCounts,
  CallContext,
  CallMetadata,
  ConditionalRead,
  PlayerRecord,
  Season,
  SourceGameId,
  SourcePlayerId,
  SourceVersion,
} from './types';
import type { EpochMs } from '@/lib/time';

/** A season resource of the fake, named after the port operation that reads it. */
export type FakeResource =
  'season_games' | 'season_box_scores' | 'season_players' | 'player_records';

/**
 * A fault the fake meets on demand:
 * - `outage`: the next calls that call out answer `unavailable`, `times` of them;
 * - `rate_limited`: once `afterCalls` more calls have been answered, every call answers `rate_limited`;
 * - `slow`: the next calls outlast their deadline, then answer `unavailable`;
 * - `schema_changed` and `not_published`: every read of that season's resource answers so.
 * Each lasts until `clearFaults`, the counted ones until they are used up.
 */
export type FakeFault =
  | Readonly<{ kind: 'outage'; times: number }>
  | Readonly<{ kind: 'rate_limited'; afterCalls: number; retryAfterMs: number | null }>
  | Readonly<{ kind: 'slow'; times: number }>
  | Readonly<{ kind: 'schema_changed' | 'not_published'; resource: FakeResource; season: Season }>;

/** A box score that the source corrects: the counts given replace the ones it held (STA-33). */
export type BoxScoreCorrection = Readonly<{
  game: SourceGameId;
  player: SourcePlayerId;
  counts: Partial<BoxScoreCounts>;
}>;

/** The fake statistics source and its controls. */
export type FakeStatsSource = StatsSource &
  Readonly<{
    inject: (fault: FakeFault) => void;
    clearFaults: () => void;
    /** Changes a box score, and the version of its season's box scores with it. */
    correctBoxScore: (correction: BoxScoreCorrection) => void;
    /** Refreshes the source at `at`, a late refresh for instance (CL-TRV-23). */
    refresh: (at: EpochMs) => void;
  }>;

type Refusal = Readonly<{ error: StatsSourceError; call: CallMetadata }>;
type Answered<T> = Readonly<{ ok: true; value: ConditionalRead<T>; call: CallMetadata }>;
type FileRead = Readonly<{
  version: SourceVersion;
  data: readonly PlayerRecord[];
  call: CallMetadata;
}>;

const NO_CALL: CallMetadata = { httpRequests: 0, bytesReceived: 0, fileRequests: 0 };
const REFUSED_CALL: CallMetadata = { httpRequests: 1, bytesReceived: 0, fileRequests: 0 };
const NOT_MODIFIED_CALL: CallMetadata = { httpRequests: 1, bytesReceived: 0, fileRequests: 1 };
const UNREADABLE_CALL: CallMetadata = NOT_MODIFIED_CALL;
const ABORTED: Refusal = { error: { kind: 'aborted' }, call: NO_CALL };
const UNAVAILABLE: Refusal = { error: { kind: 'unavailable' }, call: REFUSED_CALL };
const NOT_PUBLISHED: Refusal = { error: { kind: 'not_published' }, call: REFUSED_CALL };
const SCHEMA_CHANGED: Refusal = { error: { kind: 'schema_changed' }, call: UNREADABLE_CALL };
const NOT_LISTED = { kind: 'not_listed' } as const;
const UNPUBLISHED = { boxScores: null, sidesWithLines: [] } as const;
const PUBLICATION = 'publication';
// How long past the time left a slow call waits: a timer of exactly that time can end
// a millisecond before the deadline by the clock, as the contract's CLOCK_TOLERANCE_MS
// allows, since the two count whole milliseconds apart.
const CLOCK_TOLERANCE_MS = 1;

const readCall = (data: unknown): CallMetadata => ({
  httpRequests: 1,
  bytesReceived: JSON.stringify(data).length,
  fileRequests: 1,
});

const addCalls = (one: CallMetadata, other: CallMetadata): CallMetadata => ({
  httpRequests: one.httpRequests + other.httpRequests,
  bytesReceived: one.bytesReceived + other.bytesReceived,
  fileRequests: one.fileRequests + other.fileRequests,
});

const failure = <T>({ error, call }: Refusal): StatsSourceOutcome<T> => ({
  ok: false,
  error,
  call,
});

const keyOf = (resource: FakeResource, season: Season): string => `${resource} ${season}`;

/** Says whether `signal` has aborted, which it may have done while a call waited. */
const isAborted = (signal: AbortSignal): boolean => signal.aborted;

/**
 * Waits until the call's deadline has passed, or until its signal, which has not
 * aborted yet, aborts it: CLOCK_TOLERANCE_MS past the time left.
 */
async function pastDeadline({ deadline, signal }: CallContext): Promise<void> {
  const waitMs = Math.max(0, deadline - now()) + CLOCK_TOLERANCE_MS;
  const ended = AbortSignal.any([signal, AbortSignal.timeout(waitMs)]);
  await new Promise<void>((resolve) => {
    ended.addEventListener(
      'abort',
      () => {
        resolve();
      },
      { once: true },
    );
  });
}

class Fake implements FakeStatsSource {
  /** The league's seasons, oldest first. */
  #seasons: readonly WorldSeason[];
  readonly #firstCovered: Season;
  #refreshedAt: EpochMs;
  readonly #revisions = new Map<string, number>();
  #outages = 0;
  #slowCalls = 0;
  #rateLimit: { callsLeft: number; retryAfterMs: number | null } | null = null;
  readonly #withheld = new Set<string>();
  readonly #changed = new Set<string>();

  readonly checkHealth = async (ctx: CallContext): Promise<StatsSourceOutcome<null>> =>
    this.#callOut(ctx, PUBLICATION, () => ({
      ok: true,
      value: null,
      call: readCall(this.#refreshedAt),
    }));

  readonly getPublication: StatsSource['getPublication'] = async (ctx, { knownVersion }) =>
    this.#callOut(ctx, PUBLICATION, () =>
      this.#conditional(PUBLICATION, knownVersion, { refreshedAt: this.#refreshedAt }),
    );

  readonly getSeasonGames: StatsSource['getSeasonGames'] = async (ctx, { season, knownVersion }) =>
    this.#callOut(ctx, keyOf('season_games', season), () => {
      const held = this.#season(season);
      return held === undefined
        ? failure(NOT_PUBLISHED)
        : this.#conditional(keyOf('season_games', season), knownVersion, {
            games: held.games,
            teams: held.teams,
            coverage: held.coverage,
            heldBack: held.heldBack,
          });
    });

  readonly getSeasonBoxScores: StatsSource['getSeasonBoxScores'] = async (ctx, request) => {
    const key = keyOf('season_box_scores', request.season);
    return this.#callOut(ctx, key, () => {
      const { boxScores, sidesWithLines } = this.#season(request.season) ?? UNPUBLISHED;
      if (boxScores === null) {
        return failure(NOT_PUBLISHED);
      }
      const asked = boxScores.filter((line) => request.players.includes(line.player));
      const { value, call } = this.#conditional(key, request.knownVersion, asked);
      const read = value.kind === 'read' ? { ...value, sidesWithLines } : value;
      return { ok: true, value: read, call };
    });
  };

  readonly getSeasonPlayers: StatsSource['getSeasonPlayers'] = async (
    ctx,
    { season, knownVersion },
  ) =>
    this.#callOut(ctx, keyOf('season_players', season), () => {
      const directory = this.#season(season)?.directory ?? null;
      return directory === null
        ? failure(NOT_PUBLISHED)
        : this.#conditional(keyOf('season_players', season), knownVersion, directory);
    });

  readonly getPlayerRecords: StatsSource['getPlayerRecords'] = async (
    ctx,
    { season, players, knownVersion },
  ) =>
    this.#callOut(ctx, keyOf('player_records', season), () => {
      const file = this.#season(season)?.playerFile ?? null;
      if (file === null) {
        return failure(NOT_PUBLISHED);
      }
      const read = this.#conditional(keyOf('player_records', season), knownVersion, file);
      return read.value.kind === 'read'
        ? this.#records(season, players, { ...read.value, call: read.call })
        : read;
    });

  readonly firstCoveredSeason = (): Season => this.#firstCovered;

  readonly inject = (fault: FakeFault): void => {
    switch (fault.kind) {
      case 'outage': {
        this.#outages += fault.times;
        break;
      }
      case 'slow': {
        this.#slowCalls += fault.times;
        break;
      }
      case 'rate_limited': {
        this.#rateLimit = { callsLeft: fault.afterCalls, retryAfterMs: fault.retryAfterMs };
        break;
      }
      case 'schema_changed':
      case 'not_published': {
        (fault.kind === 'schema_changed' ? this.#changed : this.#withheld).add(
          keyOf(fault.resource, fault.season),
        );
        break;
      }
    }
  };

  readonly clearFaults = (): void => {
    this.#outages = 0;
    this.#slowCalls = 0;
    this.#rateLimit = null;
    this.#withheld.clear();
    this.#changed.clear();
  };

  readonly correctBoxScore = ({ game, player, counts }: BoxScoreCorrection): void => {
    const season = this.#seasons.find((held) =>
      (held.boxScores ?? []).some((line) => line.game === game && line.player === player),
    );
    const lines = season?.boxScores ?? null;
    if (season === undefined || lines === null) {
      throw new RangeError(`The invented league holds no box score of ${player} in ${game}.`);
    }
    const boxScores = lines.map((line) =>
      line.game === game && line.player === player
        ? { ...line, counts: { ...line.counts, ...counts } }
        : line,
    );
    this.#seasons = this.#seasons.map((held) => (held === season ? { ...held, boxScores } : held));
    this.#bump(keyOf('season_box_scores', season.season));
  };

  readonly refresh = (at: EpochMs): void => {
    this.#refreshedAt = at;
    this.#bump(PUBLICATION);
  };

  constructor() {
    const world = buildWorld();
    this.#seasons = world.seasons;
    this.#firstCovered = world.firstCoveredSeason;
    this.#refreshedAt = world.refreshedAt;
  }

  #season(season: Season): WorldSeason | undefined {
    return this.#seasons.find((held) => held.season === season);
  }

  /** The player files of the seasons before `season`, newest first. */
  #filesBefore(season: Season): readonly (readonly PlayerRecord[])[] {
    return this.#seasons
      .filter((held) => held.season < season)
      .toReversed()
      .map((held) => held.playerFile)
      .filter((file) => file !== null);
  }

  #bump(key: string): void {
    this.#revisions.set(key, this.#revision(key) + 1);
  }

  #revision(key: string): number {
    return this.#revisions.get(key) ?? 1;
  }

  #conditional<T>(key: string, knownVersion: SourceVersion | null, data: T): Answered<T> {
    const version = `${key} r${String(this.#revision(key))}`;
    return knownVersion === version
      ? { ok: true, value: { kind: 'not_modified' }, call: NOT_MODIFIED_CALL }
      : { ok: true, value: { kind: 'read', version, data }, call: readCall(data) };
  }

  /** The requested players' records: from the season's file, else from the newest earlier file that lists them. */
  #records(
    season: Season,
    players: readonly SourcePlayerId[],
    read: FileRead,
  ): StatsSourceOutcome<ConditionalRead<readonly PlayerRecord[]>> {
    const found = new Map(read.data.map((record) => [record.player, record]));
    let call = read.call;
    for (const file of this.#filesBefore(season)) {
      if (players.every((player) => found.has(player))) {
        break;
      }
      call = addCalls(call, readCall(file));
      for (const record of file) {
        if (!found.has(record.player)) {
          found.set(record.player, { ...record, currentTeam: NOT_LISTED });
        }
      }
    }
    const missing = players.filter((player) => !found.has(player));
    const records = players.flatMap((player) => found.get(player) ?? []);
    return missing.length > 0
      ? { ok: false, error: { kind: 'not_found', players: missing }, call }
      : { ok: true, value: { kind: 'read', version: read.version, data: records }, call };
  }

  async #callOut<T>(
    ctx: CallContext,
    key: string,
    answer: () => StatsSourceOutcome<T>,
  ): Promise<StatsSourceOutcome<T>> {
    if (ctx.signal.aborted) {
      return failure(ABORTED);
    }
    if (this.#slowCalls > 0) {
      this.#slowCalls -= 1;
      await pastDeadline(ctx);
      return failure(isAborted(ctx.signal) ? { ...ABORTED, call: REFUSED_CALL } : UNAVAILABLE);
    }
    const refusal = this.#refusal(key);
    return refusal === null ? answer() : failure(refusal);
  }

  #refusal(key: string): Refusal | null {
    if (this.#outages > 0) {
      this.#outages -= 1;
      return UNAVAILABLE;
    }
    if (this.#rateLimit !== null) {
      if (this.#rateLimit.callsLeft === 0) {
        return {
          error: { kind: 'rate_limited', retryAfterMs: this.#rateLimit.retryAfterMs },
          call: REFUSED_CALL,
        };
      }
      this.#rateLimit.callsLeft -= 1;
    }
    if (this.#withheld.has(key)) {
      return NOT_PUBLISHED;
    }
    return this.#changed.has(key) ? SCHEMA_CHANGED : null;
  }
}

/** A fresh fake serving the invented league, with no fault scripted (STA-02, module map §5). */
export function createFakeStatsSource(): FakeStatsSource {
  return new Fake();
}
