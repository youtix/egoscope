import { beforeEach, describe, expect, it } from 'vitest';

import {
  createTestDatabase,
  incidents,
  parameterChanges,
  parameterOverrides,
  pressSourceIncidents,
} from '@/lib/db';
import {
  DATABASE_TEST_TIMEOUT_MS,
  insertCollectionRun,
  insertGap,
  insertPressSource,
  insertSourceRead,
} from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { run, runs } from './collection-journal';

import type { CollectionCounters, CollectionRun } from './collection-journal';
import type { Database } from '@/lib/db';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const NOW_MS = Date.UTC(2026, 10, 26, 15);
const at = (ms: number) => new Date(ms);
// The starts and ends of the three runs of the journal: two days ago, yesterday, and now.
const FIRST_START = NOW_MS - 2 * DAY_MS;
const FIRST_END = FIRST_START + 10 * MINUTE_MS;
const SECOND_START = NOW_MS - DAY_MS;
const SECOND_END = SECOND_START + 5 * MINUTE_MS;
const THIRD_START = NOW_MS - 10 * MINUTE_MS;

const NO_COUNTERS: CollectionCounters = {
  itemsRead: 0,
  newArticles: 0,
  duplicates: 0,
  tooOld: 0,
  incomplete: 0,
  unsupportedLanguage: 0,
  dateAnomalies: 0,
};
const BAYSIDE_COUNTERS: CollectionCounters = {
  itemsRead: 10,
  newArticles: 4,
  duplicates: 3,
  tooOld: 1,
  incomplete: 1,
  unsupportedLanguage: 1,
  dateAnomalies: 0,
};

/** A collection incident to write: its kind, when it opened and closed, and its source. */
type IncidentToWrite = Readonly<{
  kind: typeof incidents.$inferInsert.kind;
  openedAtMs: number;
  closedAtMs: number | null;
  pressSourceId?: number;
}>;

/** Writes a collection incident, opened and maybe closed, about the source when given. */
async function insertIncident(
  db: Database,
  { kind, openedAtMs, closedAtMs, pressSourceId }: IncidentToWrite,
): Promise<number> {
  const [row] = await db
    .insert(incidents)
    .values({
      kind,
      causeKey: String(openedAtMs),
      status: closedAtMs === null ? 'open' : 'closed',
      openedAt: at(openedAtMs),
      closedAt: closedAtMs === null ? null : at(closedAtMs),
    })
    .returning({ id: incidents.id });
  const id = row?.id ?? 0;
  if (pressSourceId !== undefined) {
    await db.insert(pressSourceIncidents).values({ incidentId: id, pressSourceId });
  }
  return id;
}

/**
 * Two sources and three runs: a scheduled one two days ago that read both, one failing,
 * and found two gaps; an on-demand one yesterday that caught Bayside up and read
 * Atlantic after its reactivation; a scheduled one still running that read Atlantic.
 * Beside them, a purge run and an on-demand request not yet started.
 */
async function journal(db: Database) {
  const bayside = await insertPressSource(db, {
    overrides: { outletName: 'Bayside Courtside Report' },
  });
  const atlantic = await insertPressSource(db, {
    overrides: { outletName: 'Atlantic Rim Hoops' },
  });
  const first = await insertCollectionRun(db, {
    overrides: { startedAt: at(FIRST_START), finishedAt: at(FIRST_END) },
  });
  const second = await insertCollectionRun(db, {
    overrides: { trigger: 'on_demand', startedAt: at(SECOND_START), finishedAt: at(SECOND_END) },
  });
  const third = await insertCollectionRun(db, {
    overrides: { startedAt: at(THIRD_START), finishedAt: null, result: null },
  });
  const purge = await insertCollectionRun(db, {
    overrides: { taskKey: 'purge', startedAt: at(SECOND_START + MINUTE_MS) },
  });
  const requested = await insertCollectionRun(db, {
    overrides: {
      trigger: 'on_demand',
      startedAt: null,
      finishedAt: null,
      result: null,
      passId: null,
    },
  });
  // Read first, Bayside comes first in the entry, whatever the outlet names.
  await insertSourceRead(db, {
    taskRunId: first.id,
    pressSourceId: bayside.id,
    overrides: { readAt: at(FIRST_START + MINUTE_MS), ...BAYSIDE_COUNTERS },
  });
  await insertSourceRead(db, {
    taskRunId: first.id,
    pressSourceId: atlantic.id,
    overrides: {
      readAt: at(FIRST_START + 2 * MINUTE_MS),
      outcome: 'failure',
      failureReason: 'unreachable',
      readAttempts: 3,
    },
  });
  await insertSourceRead(db, {
    taskRunId: second.id,
    pressSourceId: bayside.id,
    overrides: {
      readAt: at(SECOND_START),
      itemsRead: 2,
      newArticles: 2,
      catchUpReferenceAt: at(SECOND_START - 6 * DAY_MS),
      permanentRedirectUrl: 'https://feeds.example.test/bayside-new.xml',
    },
  });
  await insertSourceRead(db, {
    taskRunId: second.id,
    pressSourceId: atlantic.id,
    overrides: {
      readAt: at(SECOND_START),
      uncollectedPeriodStartAt: at(SECOND_START - 3 * DAY_MS),
      uncollectedPeriodEndAt: at(SECOND_START - HOUR_MS),
      interruptionStartedAt: at(FIRST_START),
    },
  });
  await insertSourceRead(db, {
    taskRunId: third.id,
    pressSourceId: atlantic.id,
    overrides: { readAt: at(NOW_MS) },
  });
  const gapFound = await insertGap(db, {
    pressSourceId: bayside.id,
    overrides: { taskRunId: first.id },
  });
  const gapFoundNext = await insertGap(db, {
    pressSourceId: atlantic.id,
    overrides: { taskRunId: first.id },
  });
  await insertGap(db, { pressSourceId: atlantic.id });
  return {
    bayside,
    atlantic,
    first,
    second,
    third,
    purge,
    requested,
    gaps: [gapFound, gapFoundNext],
  };
}

/** The entries of the journal, by run. */
async function entries(db: Database) {
  const world = await journal(db);
  const { bayside, atlantic, first, second, third } = world;
  const firstEntry: CollectionRun = {
    taskRunId: first.id,
    origin: 'scheduled',
    withCatchUp: false,
    catchUp: [],
    startedAt: FIRST_START,
    finishedAt: FIRST_END,
    result: 'succeeded',
    reads: [
      {
        outcome: 'success',
        pressSourceId: bayside.id,
        outletName: 'Bayside Courtside Report',
        readAt: FIRST_START + MINUTE_MS,
        readAttempts: 1,
        counters: BAYSIDE_COUNTERS,
        uncollectedPeriod: null,
        permanentRedirectUrl: null,
        interruptionStartedAt: null,
      },
      {
        outcome: 'failure',
        failureReason: 'unreachable',
        pressSourceId: atlantic.id,
        outletName: 'Atlantic Rim Hoops',
        readAt: FIRST_START + 2 * MINUTE_MS,
        readAttempts: 3,
        counters: NO_COUNTERS,
        uncollectedPeriod: null,
        permanentRedirectUrl: null,
        interruptionStartedAt: null,
      },
    ],
    totals: BAYSIDE_COUNTERS,
    gaps: world.gaps,
    incidents: [],
  };
  const secondEntry: CollectionRun = {
    taskRunId: second.id,
    origin: 'on_demand',
    withCatchUp: true,
    catchUp: [
      {
        pressSourceId: bayside.id,
        outletName: 'Bayside Courtside Report',
        admittedAgeMs: 9 * DAY_MS,
      },
    ],
    startedAt: SECOND_START,
    finishedAt: SECOND_END,
    result: 'succeeded',
    reads: [
      {
        outcome: 'success',
        pressSourceId: bayside.id,
        outletName: 'Bayside Courtside Report',
        readAt: SECOND_START,
        readAttempts: 1,
        counters: { ...NO_COUNTERS, itemsRead: 2, newArticles: 2 },
        uncollectedPeriod: null,
        permanentRedirectUrl: 'https://feeds.example.test/bayside-new.xml',
        interruptionStartedAt: null,
      },
      {
        outcome: 'success',
        pressSourceId: atlantic.id,
        outletName: 'Atlantic Rim Hoops',
        readAt: SECOND_START,
        readAttempts: 1,
        counters: NO_COUNTERS,
        uncollectedPeriod: { startAt: SECOND_START - 3 * DAY_MS, endAt: SECOND_START - HOUR_MS },
        permanentRedirectUrl: null,
        interruptionStartedAt: FIRST_START,
      },
    ],
    totals: { ...NO_COUNTERS, itemsRead: 2, newArticles: 2 },
    gaps: [],
    incidents: [],
  };
  const thirdEntry: CollectionRun = {
    taskRunId: third.id,
    origin: 'scheduled',
    withCatchUp: false,
    catchUp: [],
    startedAt: THIRD_START,
    finishedAt: null,
    result: null,
    reads: [
      {
        outcome: 'success',
        pressSourceId: atlantic.id,
        outletName: 'Atlantic Rim Hoops',
        readAt: NOW_MS,
        readAttempts: 1,
        counters: NO_COUNTERS,
        uncollectedPeriod: null,
        permanentRedirectUrl: null,
        interruptionStartedAt: null,
      },
    ],
    totals: NO_COUNTERS,
    gaps: [],
    incidents: [],
  };
  return { world, firstEntry, secondEntry, thirdEntry };
}

describe('the collection journal', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    const restoreClock = installFakeClock(fixedClock(toEpochMs(NOW_MS)));
    return async () => {
      restoreClock();
      await database.close();
    };
  });

  it('[COL-48] [CL-COL-07] lists the collection runs newest first, each with its origin, catch-up, reads, totals and gaps', async () => {
    const { firstEntry, secondEntry, thirdEntry } = await entries(db);

    expect(await runs(db)).toStrictEqual([thirdEntry, secondEntry, firstEntry]);
  });

  it('[COL-49] filters the journal by source and by period, the period including its start only', async () => {
    const { world, firstEntry, secondEntry, thirdEntry } = await entries(db);
    const from = toEpochMs(SECOND_START);
    const to = toEpochMs(THIRD_START);

    expect(await runs(db, { pressSourceId: world.bayside.id })).toStrictEqual([
      secondEntry,
      firstEntry,
    ]);
    expect(await runs(db, { from })).toStrictEqual([thirdEntry, secondEntry]);
    expect(await runs(db, { to: from })).toStrictEqual([firstEntry]);
    expect(await runs(db, { pressSourceId: world.atlantic.id, from, to })).toStrictEqual([
      secondEntry,
    ]);
  });

  it('[COL-48] gives one run as the journal does, and nothing for a run of another task or not yet started', async () => {
    const { world, firstEntry } = await entries(db);

    expect(await run(db, world.first.id)).toStrictEqual(firstEntry);
    expect(await run(db, world.purge.id)).toBeNull();
    expect(await run(db, world.requested.id)).toBeNull();
  });

  it('[COL-48] names the collection incidents that each run opened or closed, its first and last instants included', async () => {
    const { atlantic } = await journal(db);
    const write = async (
      kind: IncidentToWrite['kind'],
      [openedAtMs, closedAtMs]: readonly [number, number | null],
      pressSourceId?: number,
    ) => insertIncident(db, { kind, openedAtMs, closedAtMs, pressSourceId });
    const downAtStart = await write('press_source_down', [FIRST_START, null], atlantic.id);
    const tooShortClosedAtEnd = await write('feed_too_short', [FIRST_START - DAY_MS, FIRST_END]);
    const impossibleWithin = await write('collection_impossible', [
      FIRST_START + 4 * MINUTE_MS,
      FIRST_START + 5 * MINUTE_MS,
    ]);
    // Open across the whole run, opened just after it, and of another kind: in no entry.
    await write('press_source_silent', [FIRST_START - 1, FIRST_END + 1]);
    await write('collection_impossible', [FIRST_END + 1, null]);
    await write('task_not_run', [FIRST_START + MINUTE_MS, null]);
    const downWhileRunning = await write('press_source_down', [THIRD_START + MINUTE_MS, null]);

    const [third, second, first] = await runs(db);

    expect(first?.incidents).toStrictEqual([
      {
        incidentId: tooShortClosedAtEnd,
        kind: 'feed_too_short',
        pressSourceId: null,
        openedAt: FIRST_START - DAY_MS,
        closedAt: FIRST_END,
        openedDuringRun: false,
        closedDuringRun: true,
      },
      {
        incidentId: downAtStart,
        kind: 'press_source_down',
        pressSourceId: atlantic.id,
        openedAt: FIRST_START,
        closedAt: null,
        openedDuringRun: true,
        closedDuringRun: false,
      },
      {
        incidentId: impossibleWithin,
        kind: 'collection_impossible',
        pressSourceId: null,
        openedAt: FIRST_START + 4 * MINUTE_MS,
        closedAt: FIRST_START + 5 * MINUTE_MS,
        openedDuringRun: true,
        closedDuringRun: true,
      },
    ]);
    expect(second?.incidents).toStrictEqual([]);
    expect(third?.incidents.map(({ incidentId }) => incidentId)).toStrictEqual([downWhileRunning]);
  });

  it('[CL-COL-04] [CL-COL-07] admits nine days to a source caught up six days after its last read, under a three-day maximum age', async () => {
    const world = await journal(db);

    const entry = await run(db, world.second.id);

    expect(entry?.catchUp).toStrictEqual([
      {
        pressSourceId: world.bayside.id,
        outletName: 'Bayside Courtside Report',
        admittedAgeMs: 9 * DAY_MS,
      },
    ]);
  });

  it('[COL-45] lengthens the maximum age in force when the run started, not the one in force now', async () => {
    const world = await journal(db);
    const key = 'collection.maxArticleAgeDays';
    await db.insert(parameterChanges).values([
      {
        parameterKey: key,
        changedAt: at(SECOND_START - HOUR_MS),
        oldValue: 3,
        newValue: 5,
        affectsCalculations: false,
      },
      {
        parameterKey: key,
        changedAt: at(NOW_MS - HOUR_MS),
        oldValue: 5,
        newValue: 7,
        affectsCalculations: false,
      },
    ]);
    await db.insert(parameterOverrides).values({ parameterKey: key, value: 7 });

    const entry = await run(db, world.second.id);

    expect(entry?.catchUp).toStrictEqual([
      {
        pressSourceId: world.bayside.id,
        outletName: 'Bayside Courtside Report',
        admittedAgeMs: 11 * DAY_MS,
      },
    ]);
  });
});
