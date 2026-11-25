import { eq } from 'drizzle-orm';
import fc from 'fast-check';
import { beforeEach, describe, expect, it, onTestFinished } from 'vitest';

import { createTestDatabase, fetchQueueItems } from '@/lib/db';
import { listOpen } from '@/lib/incidents';
import { getParams, setParam } from '@/lib/params';
import { withQuota } from '@/lib/quotas';
import { createFakeStatsSource } from '@/lib/stats-source';
import { fixedClock, installFakeClock, toEpochMs, toIsoDate } from '@/lib/time';

import {
  classifyAnswer,
  isMissingFileAFault,
  recordRecovery,
  retryAt,
  retryTiming,
  settleUnit,
} from './outage';

import type { AnswerClass, FileFacts, Unit } from './outage';
import type { Database } from '@/lib/db';
import type { Deferred } from '@/lib/quotas';
import type { Result } from '@/lib/result';
import type { FakeStatsSource, StatsSourceError, StatsSourceOutcome } from '@/lib/stats-source';
import type { FixedClock } from '@/lib/time';

const HOUR = 3_600_000;
const QUARTER_HOUR = 900_000;
// Tuesday 24 November 2026, 14:00 UTC, in the season in progress of the invented league.
const START = toEpochMs(Date.UTC(2026, 10, 24, 14));
const NEXT_UTC_DAY = toEpochMs(Date.UTC(2026, 10, 25));
const SEASON = '2026-27';
const PAST_SEASON = '2025-26';
const COMING_SEASON = '2027-28';
const TIMING = { firstDelayMs: HOUR, intervalMs: 4 * HOUR, incidentAfterMs: 12 * HOUR };
const NO_CALL = { httpRequests: 0, bytesReceived: 0, fileRequests: 0 };
const FILE: FileFacts = {
  resource: 'season_games',
  season: SEASON,
  currentSeason: SEASON,
  wasPublished: true,
  firstGameDay: toIsoDate('2026-10-20'),
  cutoff: '20:00',
  timeZone: 'Europe/Paris',
};
const OFF_SEASON: Partial<FileFacts> = {
  season: COMING_SEASON,
  currentSeason: COMING_SEASON,
  wasPublished: false,
};

type Reading = Result<StatsSourceOutcome<unknown>, Deferred>;

const failed = (error: StatsSourceError): Reading => ({
  ok: true,
  value: { ok: false, error, call: NO_CALL },
});
const read: Reading = { ok: true, value: { ok: true, value: null, call: NO_CALL } };
const deferred: Reading = { ok: false, error: { kind: 'deferred', availableAt: NEXT_UTC_DAY } };

describe('the classification of an answer', () => {
  it.each<{ what: string; reading: Reading; expected: AnswerClass }>([
    { what: 'a read file', reading: read, expected: { kind: 'normal' } },
    {
      what: 'a network error, a timeout or a server error',
      reading: failed({ kind: 'unavailable' }),
      expected: { kind: 'outage' },
    },
    {
      what: 'credentials that the source refuses',
      reading: failed({ kind: 'unauthorized' }),
      expected: { kind: 'outage' },
    },
    {
      what: 'a refusal for quota',
      reading: failed({ kind: 'rate_limited', retryAfterMs: 5 }),
      expected: { kind: 'quota', resumeAt: null },
    },
    {
      what: 'a call that the guard deferred',
      reading: deferred,
      expected: { kind: 'quota', resumeAt: NEXT_UTC_DAY },
    },
    {
      what: 'a changed layout',
      reading: failed({ kind: 'schema_changed' }),
      expected: { kind: 'schema_changed' },
    },
    {
      what: 'a file that is not published',
      reading: failed({ kind: 'not_published' }),
      expected: { kind: 'not_published' },
    },
    {
      what: 'players that no file lists, which is data',
      reading: failed({ kind: 'not_found', players: ['p1'] }),
      expected: { kind: 'normal' },
    },
    {
      what: 'a call that its own signal stopped',
      reading: failed({ kind: 'aborted' }),
      expected: { kind: 'interrupted' },
    },
  ])('[STA-36] [CL-STA-15] classifies $what', ({ reading, expected }) => {
    expect(classifyAnswer(reading)).toStrictEqual(expected);
  });
});

describe('the retry schedule', () => {
  it('[STA-36] [STA-37] reads the delays from the parameters, 1 hour, 4 hours and 12 hours by default', async () => {
    const { db, close } = await createTestDatabase();
    onTestFinished(close);
    expect(retryTiming(await getParams(db))).toStrictEqual(TIMING);
  }, 60_000);

  it('[STA-36] waits the first delay after one failure and the interval after each later one, for any delays', () => {
    const quarters = fc.integer({ min: 1, max: 100 });
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 40 }),
        quarters,
        quarters,
        (failures, first, interval) => {
          const timing = {
            ...TIMING,
            firstDelayMs: first * QUARTER_HOUR,
            intervalMs: interval * QUARTER_HOUR,
          };
          const delay = failures === 1 ? timing.firstDelayMs : timing.intervalMs;
          expect(retryAt(failures, START, timing)).toBe(START + delay);
        },
      ),
    );
  });
});

describe('a file that the source does not publish', () => {
  const october = (day: number, hour: number, minute = 0) => Date.UTC(2026, 9, day, hour, minute);
  const boxScores: Partial<FileFacts> = { wasPublished: false, resource: 'season_box_scores' };

  it.each<{ what: string; facts: Partial<FileFacts>; at: number; isFault: boolean }>([
    {
      what: 'the coming season before 26 October',
      facts: OFF_SEASON,
      at: Date.UTC(2027, 9, 25, 23),
      isFault: false,
    },
    {
      what: 'the schedule once 25 October has passed',
      facts: OFF_SEASON,
      at: Date.UTC(2027, 9, 26, 5),
      isFault: true,
    },
    {
      what: 'a file that the source published before',
      facts: { ...boxScores, wasPublished: true, firstGameDay: null },
      at: october(1, 0),
      isFault: true,
    },
    {
      what: 'a box-score file before the cut-off after the first game day',
      facts: boxScores,
      at: october(21, 17, 59),
      isFault: false,
    },
    {
      what: 'a box-score file at that cut-off, 20:00 in Paris',
      facts: boxScores,
      at: october(21, 18),
      isFault: true,
    },
    {
      what: 'a box-score file while no game is stored',
      facts: { ...boxScores, firstGameDay: null },
      at: october(30, 0),
      isFault: false,
    },
    {
      what: 'a file of a past season',
      facts: { season: PAST_SEASON },
      at: october(30, 0),
      isFault: false,
    },
  ])('[CL-STA-15] [CL-STA-30] judges $what', ({ facts, at, isFault }) => {
    expect(isMissingFileAFault({ ...FILE, ...facts }, toEpochMs(at))).toBe(isFault);
  });
});

describe('the answers of the fake source, settled in the queue', { timeout: 60_000 }, () => {
  let db: Database;
  let clock: FixedClock;
  let source: FakeStatsSource;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    clock = fixedClock(START);
    source = createFakeStatsSource();
    onTestFinished(installFakeClock(clock));
    return database.close;
  }, 60_000);

  const addUnit = async (season = SEASON) => {
    const [row] = await db
      .insert(fetchQueueItems)
      .values({ statsSource: 'sportsdataverse_espn', kind: 'season_games', season, priority: 2 })
      .returning();
    if (row === undefined) {
      throw new RangeError('The unit was not inserted.');
    }
    return row;
  };
  const unitOf = async (id: number) => {
    const [row] = await db.select().from(fetchQueueItems).where(eq(fetchQueueItems.id, id));
    if (row === undefined) {
      throw new RangeError('The unit is gone.');
    }
    return row;
  };
  // One fetch of a season's games, as the queue makes it: guarded, then classified.
  const fetchGames = async (season = SEASON) => {
    const controller = new AbortController();
    const reading = await withQuota(
      db,
      { service: 'statsSource', estimate: { requests: 1 }, priority: false },
      async () =>
        source.getSeasonGames(
          { deadline: clock.now(), signal: controller.signal },
          { season, knownVersion: null },
        ),
    );
    return { reading, answer: classifyAnswer(reading) };
  };
  const answerOf = async (season = SEASON) => {
    const { answer } = await fetchGames(season);
    return answer;
  };
  const settle = async (unit: Unit, answer: AnswerClass, file: Partial<FileFacts> = {}) => {
    if (answer.kind === 'normal') {
      throw new RangeError('A normal answer is recorded with recordRecovery.');
    }
    return settleUnit(db, { unit, answer, file: { ...FILE, ...file } });
  };
  const recover = async (unit: Unit) => {
    await db.transaction(async (tx) => {
      await recordRecovery(tx, unit);
      await tx.delete(fetchQueueItems).where(eq(fetchQueueItems.id, unit.id));
    });
  };
  const openKinds = async () => {
    const open = await listOpen(db);
    return open.map(({ kind }) => kind);
  };
  const dueIn = async (id: number) => {
    const unit = await unitOf(id);
    return unit.nextAttemptAt.getTime() - clock.now();
  };

  it('[STA-36] retries an outage 1 hour later, then every 4 hours, as due instants, until one attempt succeeds', async () => {
    source.inject({ kind: 'outage', times: 3 });
    const { id } = await addUnit();
    const delays: number[] = [];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await settle(await unitOf(id), await answerOf());
      delays.push(await dueIn(id));
      clock.advance(delays.at(-1) ?? 0);
    }
    expect(delays).toStrictEqual([HOUR, 4 * HOUR, 4 * HOUR]);
    expect(await unitOf(id)).toMatchObject({
      attempts: 3,
      waitReason: 'outage',
      failingSince: new Date(START),
    });
    expect(await answerOf()).toStrictEqual({ kind: 'normal' });
    await recover(await unitOf(id));
    expect(await db.select().from(fetchQueueItems)).toStrictEqual([]);
  });

  it('[STA-36] treats a call that outlasts its deadline as an outage', async () => {
    source.inject({ kind: 'slow', times: 1 });
    expect(await answerOf()).toStrictEqual({ kind: 'outage' });
  });

  it('[STA-37] opens "Stats source unavailable" after 12 hours of continuous failure, since it began, and closes it at the first normal answer', async () => {
    source.inject({ kind: 'outage', times: 5 });
    const { id } = await addUnit();
    // Failures at 0, 1, 5, 9 and 13 hours: the incident opens at the fifth.
    const opened: boolean[] = [];
    for (const elapsedHours of [0, 1, 5, 9, 13]) {
      clock.advance(START + elapsedHours * HOUR - clock.now());
      await settle(await unitOf(id), await answerOf());
      const kinds = await openKinds();
      opened.push(kinds.includes('stats_source_unavailable'));
    }
    expect(opened).toStrictEqual([false, false, false, false, true]);
    const [incident] = await listOpen(db);
    expect([incident?.causeKey, incident?.openedAt]).toStrictEqual(['not_answering', START]);
    await recover(await unitOf(id));
    expect(await openKinds()).toStrictEqual([]);
  });

  it('[STA-37] dates the failure from its first attempt, however late the retries run or a call is interrupted, and opens the incident when it has lasted exactly 12 hours', async () => {
    const { id } = await addUnit();
    // Each retry runs 2 hours after it was due, and one call is stopped by its own signal.
    for (const elapsedHours of [0, 3, 9]) {
      clock.advance(START + elapsedHours * HOUR - clock.now());
      await settle(await unitOf(id), { kind: 'outage' });
    }
    await settle(await unitOf(id), { kind: 'interrupted' });
    expect(await openKinds()).toStrictEqual([]);
    clock.advance(START + 12 * HOUR - clock.now());
    await settle(await unitOf(id), { kind: 'outage' });
    const [incident] = await listOpen(db);
    expect([incident?.kind, incident?.openedAt]).toStrictEqual(['stats_source_unavailable', START]);
    expect(await unitOf(id)).toMatchObject({ attempts: 4, failingSince: new Date(START) });
  });

  it('[STA-36] [STA-37] starts the failures in a row again after a quota answer, with the first delay', async () => {
    const { id } = await addUnit();
    for (const elapsedHours of [0, 1, 5]) {
      clock.advance(START + elapsedHours * HOUR - clock.now());
      await settle(await unitOf(id), { kind: 'outage' });
    }
    await settle(await unitOf(id), { kind: 'quota', resumeAt: toEpochMs(START + 7 * HOUR) });
    expect(await unitOf(id)).toMatchObject({
      attempts: 3,
      waitReason: 'quota',
      failingSince: null,
    });
    clock.advance(START + 7 * HOUR - clock.now());
    expect(await settle(await unitOf(id), { kind: 'outage' })).toStrictEqual({
      kind: 'waiting',
      nextAttemptAt: START + 8 * HOUR,
    });
    expect(await unitOf(id)).toMatchObject({
      attempts: 1,
      waitReason: 'outage',
      failingSince: new Date(START + 7 * HOUR),
    });
  });

  it('[STA-36] [STA-37] makes every unit that waited after an outage due at once when the source answers', async () => {
    source.inject({ kind: 'outage', times: 2 });
    const first = await addUnit(SEASON);
    const second = await addUnit(PAST_SEASON);
    await settle(first, await answerOf());
    await settle(second, await answerOf(PAST_SEASON));
    clock.advance(HOUR);
    await recover(await unitOf(first.id));
    expect(await unitOf(second.id)).toMatchObject({
      attempts: 0,
      waitReason: null,
      failingSince: null,
    });
    expect(await dueIn(second.id)).toBe(0);
  });

  it('[STA-39] [TRV-06] makes a refusal for quota wait for the reset the answer gives, and counts it as "quota reached"', async () => {
    source.inject({ kind: 'rate_limited', afterCalls: 1, retryAfterMs: 2 * HOUR });
    const unit = await addUnit();
    expect(await answerOf()).toStrictEqual({ kind: 'normal' });
    const answer = await answerOf();
    expect(answer).toStrictEqual({ kind: 'quota', resumeAt: null });
    expect(await settle(unit, answer)).toStrictEqual({
      kind: 'waiting',
      nextAttemptAt: START + 2 * HOUR,
    });
    expect(await unitOf(unit.id)).toMatchObject({ attempts: 0, waitReason: 'quota' });
    const [incident] = await listOpen(db);
    expect([incident?.kind, incident?.serviceRole]).toStrictEqual([
      'quota_reached',
      'stats_source',
    ]);
  });

  it('[STA-39] makes a call that a quota entered by the owner defers wait for the next period', async () => {
    const entered = await db.transaction(async (tx) =>
      setParam(tx, { key: 'quotas.statsSource.requestsPerDay', value: 10, expectedVersion: 0 }),
    );
    const unit = await addUnit();
    // The owner's limit of 10 requests a day leaves 9 to non-priority calls.
    const answers = [];
    for (let call = 1; call <= 9; call += 1) {
      const { kind } = await answerOf();
      answers.push(kind);
    }
    const { reading, answer } = await fetchGames();
    expect([entered.ok, ...answers]).toStrictEqual([
      true,
      ...Array.from({ length: 9 }, () => 'normal'),
    ]);
    expect(reading).toStrictEqual(deferred);
    expect(await settle(unit, answer)).toStrictEqual({
      kind: 'waiting',
      nextAttemptAt: NEXT_UTC_DAY,
    });
    expect(await openKinds()).toContain('quota_reached');
  });

  it('[STA-39] makes a quota answer with no reset to come wait the retry interval', async () => {
    const unit = await addUnit();
    expect(await settle(unit, { kind: 'quota', resumeAt: null })).toStrictEqual({
      kind: 'waiting',
      nextAttemptAt: START + 4 * HOUR,
    });
  });

  it('[CL-STA-15] stops a file whose layout changed, retries it at the retry interval and opens "Stats source format changed"', async () => {
    source.inject({ kind: 'schema_changed', resource: 'season_games', season: SEASON });
    const { id } = await addUnit();
    const answer = await answerOf();
    expect(answer).toStrictEqual({ kind: 'schema_changed' });
    expect(await settle(await unitOf(id), answer)).toStrictEqual({
      kind: 'waiting',
      nextAttemptAt: START + 4 * HOUR,
    });
    expect(await unitOf(id)).toMatchObject({
      attempts: 1,
      waitReason: null,
      schemaChangedAt: new Date(START),
    });
    expect(await openKinds()).toStrictEqual(['stats_source_schema_changed']);
  });

  it('[CL-STA-15] closes "Stats source format changed" when the file reads again', async () => {
    source.inject({ kind: 'schema_changed', resource: 'season_games', season: SEASON });
    const { id } = await addUnit();
    await settle(await unitOf(id), await answerOf());
    source.clearFaults();
    clock.advance(4 * HOUR);
    expect(await answerOf()).toStrictEqual({ kind: 'normal' });
    await recover(await unitOf(id));
    expect(await openKinds()).toStrictEqual([]);
  });

  it('[CL-STA-15] keeps "Stats source format changed" open while another file still has a changed layout', async () => {
    const first = await addUnit(SEASON);
    const second = await addUnit(PAST_SEASON);
    await settle(first, { kind: 'schema_changed' });
    await settle(second, { kind: 'schema_changed' });
    await recover(await unitOf(first.id));
    expect(await openKinds()).toStrictEqual(['stats_source_schema_changed']);
    await recover(await unitOf(second.id));
    expect(await openKinds()).toStrictEqual([]);
  });

  it.each<{ what: string; between: AnswerClass }>([
    { what: 'an outage', between: { kind: 'outage' } },
    { what: 'a quota answer', between: { kind: 'quota', resumeAt: toEpochMs(START + 10 * HOUR) } },
  ])(
    '[CL-STA-15] closes "Stats source format changed" when the file reads again after $what',
    async ({ between }) => {
      const { id } = await addUnit();
      await settle(await unitOf(id), { kind: 'schema_changed' });
      clock.advance(4 * HOUR);
      await settle(await unitOf(id), between);
      clock.advance(2 * HOUR);
      await recover(await unitOf(id));
      expect(await openKinds()).toStrictEqual([]);
    },
  );

  it('[CL-STA-15] keeps "Stats source format changed" open when another file reads and wakes the changed one after an outage', async () => {
    const changed = await addUnit(SEASON);
    const other = await addUnit(PAST_SEASON);
    await settle(changed, { kind: 'schema_changed' });
    clock.advance(4 * HOUR);
    await settle(await unitOf(changed.id), { kind: 'outage' });
    await recover(await unitOf(other.id));
    expect(await unitOf(changed.id)).toMatchObject({ attempts: 0, waitReason: null });
    expect(await openKinds()).toStrictEqual(['stats_source_schema_changed']);
    await recover(await unitOf(changed.id));
    expect(await openKinds()).toStrictEqual([]);
  });

  it.each<{ what: string; answer: AnswerClass }>([
    { what: 'a changed layout', answer: { kind: 'schema_changed' } },
    { what: 'a current-season file that went missing', answer: { kind: 'not_published' } },
  ])(
    '[STA-37] [CL-STA-15] closes "Stats source unavailable" when the source answers with $what, and makes the units that waited after an outage due',
    async ({ answer }) => {
      source.inject({ kind: 'outage', times: 5 });
      const failing = await addUnit(SEASON);
      const changed = await addUnit(PAST_SEASON);
      for (const elapsedHours of [0, 1, 5, 9, 13]) {
        clock.advance(START + elapsedHours * HOUR - clock.now());
        await settle(await unitOf(failing.id), await answerOf());
      }
      expect(await openKinds()).toStrictEqual(['stats_source_unavailable']);
      clock.advance(4 * HOUR);
      await settle(changed, answer);
      expect(await openKinds()).toStrictEqual(['stats_source_schema_changed']);
      expect(await unitOf(failing.id)).toMatchObject({ attempts: 0, waitReason: null });
      expect(await dueIn(failing.id)).toBe(0);
    },
  );

  it('[CL-STA-15] opens the format incident for a current-season file that went missing', async () => {
    source.inject({ kind: 'not_published', resource: 'season_games', season: SEASON });
    const unit = await addUnit();
    const answer = await answerOf();
    expect(answer).toStrictEqual({ kind: 'not_published' });
    expect(await settle(unit, answer)).toMatchObject({ kind: 'waiting' });
    expect(await openKinds()).toStrictEqual(['stats_source_schema_changed']);
  });

  it('[CL-STA-30] opens no incident for a coming-season file before its due date, drops the unit, and opens one after the due date', async () => {
    const unit = await addUnit(COMING_SEASON);
    expect(await settle(unit, { kind: 'not_published' }, OFF_SEASON)).toStrictEqual({
      kind: 'done',
    });
    expect(await db.select().from(fetchQueueItems)).toStrictEqual([]);
    expect(await openKinds()).toStrictEqual([]);
    clock.advance(Date.UTC(2027, 9, 26, 5) - START);
    const late = await addUnit(COMING_SEASON);
    expect(await settle(late, { kind: 'not_published' }, OFF_SEASON)).toMatchObject({
      kind: 'waiting',
    });
    expect(await openKinds()).toStrictEqual(['stats_source_schema_changed']);
  });

  it('[STA-36] leaves a call that its own signal stopped due at once, with no failure counted', async () => {
    const unit = await addUnit();
    const controller = new AbortController();
    controller.abort();
    const outcome = await source.getSeasonGames(
      { deadline: clock.now(), signal: controller.signal },
      { season: SEASON, knownVersion: null },
    );
    const answer = classifyAnswer({ ok: true, value: outcome });
    expect(answer).toStrictEqual({ kind: 'interrupted' });
    expect(await settle(unit, answer)).toStrictEqual({ kind: 'waiting', nextAttemptAt: START });
    expect(await unitOf(unit.id)).toMatchObject({ attempts: 0, leaseExpiresAt: null });
  });
});
