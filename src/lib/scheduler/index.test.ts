// A model-based scenario test of the scheduler (module map §4; TRV-28 to TRV-31, CA-TRV-09,
// CA-TRV-10, CL-TRV-07, CL-TRV-08, CL-TRV-23): random sequences of steps on one test database
// — time that passes across the schedule times, the margins and the 23- and 25-hour days of
// the clock changes; passes at a tick, at an owner's request, at an opening of the app, and two
// at once; handlers that succeed, fail, or stop after writing a cursor, by the budget or by a
// cut; a ready guard that lets go, waits or throws; a task that becomes active; schedule times
// that change. After each step the database must keep the invariants of those documents,
// which a small model of the schedule and of the handlers' calls checks.
import { and, asc, eq, sql } from 'drizzle-orm';
import fc from 'fast-check';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { createTestDatabase, incidents, journalEntries, schedulerLease, taskRuns } from '@/lib/db';
import { getParams } from '@/lib/params';
import { DATABASE_TEST_TIMEOUT_MS } from '@/lib/testing';
import {
  fixedClock,
  installFakeClock,
  localOccurrenceInstant,
  toEpochMs,
  userDay,
} from '@/lib/time';

import { PASS_BUDGET_MS, STALE_AFTER_MS } from './limits';

import type { ChunkOutcome, ReadyGuard, Registry, ScheduledTask, TaskContext } from './types';
import type { Database } from '@/lib/db';
import type { FixedClock } from '@/lib/time';

// An on-demand run asked in a step starts in the step's own pass, not after a response.
vi.mock(import('next/server'), () => ({ after: vi.fn() }));

const PROCESS_FAKE = Symbol.for('egoscope.runtime-cache.process-fake');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// The sequences that one run of the suite tries, as many as its timeout allows.
const SEQUENCES = 12;
// The statistics update's cut-off, five hours after its start, as 20:00 is after 15:00.
const CUTOFF_MS = 5 * HOUR;
// 22:00 UTC two days before the 23-hour day of 29 March 2026 and the 25-hour day of
// 25 October 2026 in Paris, and before a day without a clock change.
const STARTS = [Date.UTC(2026, 2, 27, 22), Date.UTC(2026, 9, 23, 22), Date.UTC(2026, 10, 23, 22)];
// The purge's times: its default, one that a clock change skips or repeats, two a day.
const PURGE_TIMES = [['04:00'], ['02:30'], ['04:00', '16:00']] as const;
const KEYS = ['purge', 'statistics-update', 'backup'] as const;
// The statistics update at 15:00 and the backup, which becomes active, at 05:00 in Paris.
const FIXED_TIMES = { 'statistics-update': ['15:00'], backup: ['05:00'] } as const;
const RESULTS = { succeeds: 'succeeded', fails: 'failed', late: 'source_late' } as const;
// What a handler does in a pass step: success weighs three times as much.
const OUTCOMES = ['succeeds', 'succeeds', 'succeeds', 'fails', 'more', 'cut'] as const;
// The calls of a pass step: a tick, twice as often as the others; an opening's check; two at
// once; an owner's request, then the tick.
const CALLS = [['tick'], ['opening'], ['tick', 'tick'], ['opening', 'tick'], ['request']] as const;
const ANSWERS = ['ready', 'ready', 'waits', 'throws'] as const;
// From a task's next occurrence: at it, or just before, at or after the end of its margin, two
// hours, or of the statistics update's cut-off plus the margin, seven hours.
const UNTIL_MINUTES = [0, 1, 119, 120, 121, 420, 421] as const;
const END = /^task_run_(?:succeeded|failed|source_late|interrupted)$/u;
const SOURCE = 'stats-source-refresh';
const PASS = '00000000-0000-4000-8000-000000000002';

type Key = (typeof KEYS)[number];
/** The values that an arbitrary gives. */
type ValueOf<A> = A extends fc.Arbitrary<infer T> ? T : never;
type Scenario = ValueOf<typeof anyScenario>;
type Step = Scenario['steps'][number];
type PassStep = Extract<Step, { kind: 'pass' }>;
/** A handler's call: its run, the cursor it was given, and the one it wrote, if any. */
type Call = { readonly run: number; readonly cursor: string | null; returned: string | null };
/** What the model knows: the clock, the margin and zone, the schedule, the calls, the last cut. */
type World = Readonly<{
  clock: FixedClock;
  margin: number;
  zone: string;
  times: readonly string[];
  timesSince: number;
  isBackupActive: boolean;
  calls: Call[];
  cutAt: number | null;
}>;
/** A pass step as its handlers play it: the tasks that wrote a cursor or spent the budget. */
type Turn = { step: PassStep; wrote: Set<Key>; spent: Set<Key>; cut: (value: 'cut') => void };

/** The scheduler as a deployment loads it, over the process's fake cache. */
async function load() {
  vi.resetModules();
  vi.stubEnv('EGOSCOPE_FAKES', 'runtime-cache');
  vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'dpl_test');
  vi.stubGlobal(PROCESS_FAKE, undefined);
  return import('.');
}

type Env = Readonly<{ db: Database; api: Awaited<ReturnType<typeof load>> }>;

/** A migrated database of its own and the scheduler, for one test. */
async function envOf(): Promise<Env> {
  const database = await createTestDatabase();
  onTestFinished(database.close);
  return { db: database.db, api: await load() };
}

const timesOf = (world: World, key: Key) => (key === 'purge' ? world.times : FIXED_TIMES[key]);
const keysOf = (world: World) => (world.isBackupActive ? KEYS : KEYS.slice(0, 2));

/** The occurrences of `key` from `from` to `to`, as the model counts them (TRV-27, CL-TRV-18). */
function occurrencesOf(world: World, key: Key, [from, to]: readonly [number, number]) {
  const first = Math.floor(from / DAY) - 1;
  const days = Array.from({ length: Math.floor(to / DAY) - first + 2 }, (_, index) =>
    userDay(toEpochMs((first + index) * DAY), 'UTC'),
  );
  const local = days.flatMap((day) =>
    timesOf(world, key).map((time) => localOccurrenceInstant(day, time, world.zone)),
  );
  return [...new Set(local)].filter((at) => at >= from && at <= to).toSorted((a, b) => a - b);
}

/** The latest occurrence of `key` that has come at `at`. */
const latestOf = (world: World, key: Key, at: number) =>
  occurrencesOf(world, key, [at - 2 * DAY, at]).at(-1) ?? -Infinity;

/** The handler of `key` in `turn`: it does what the step says, and the model notes each call. */
function handlerOf(world: World, turn: Turn, key: Key) {
  return async ({ runId, cursor }: TaskContext): Promise<ChunkOutcome> => {
    await Promise.resolve();
    // A chunk takes a millisecond: a run never starts and ends at one instant.
    world.clock.advance(1);
    const call: Call = { run: runId, cursor, returned: null };
    world.calls.push(call);
    const outcome = turn.step.outcomes[key];
    if (outcome === 'cut' && turn.wrote.has(key)) {
      turn.cut('cut');
      // The function stops: this call never returns, and its pass never ends.
      return new Promise<never>(() => undefined);
    }
    if (outcome !== 'more' && outcome !== 'cut') {
      return { kind: 'done', result: RESULTS[outcome] };
    }
    turn.wrote.add(key);
    call.returned = String(world.calls.length);
    if (outcome === 'more') {
      // A chunk that spends the pass's budget: the run stays running, its cursor written.
      turn.spent.add(key);
      world.clock.advance(PASS_BUDGET_MS + MINUTE);
    }
    return { kind: 'more', cursor: call.returned };
  };
}

/** The statistics update's ready guard, which answers what the step says (CL-TRV-23). */
function guardOf(turn: Turn): ReadyGuard {
  return {
    probe: SOURCE,
    call: async () => {
      await Promise.resolve();
      return { found: true };
    },
    check: async (_db, _run, at) => {
      await Promise.resolve();
      if (turn.step.answer === 'throws') {
        throw new Error('The connection was lost.');
      }
      const probe = { kind: SOURCE, dueAt: toEpochMs(at + HOUR), state: {} } as const;
      return turn.step.answer === 'ready' ? { ready: true } : { ready: false, probe };
    },
    cutoff: (dueAt) => toEpochMs(dueAt + CUTOFF_MS),
  };
}

/** The active tasks, in registry order, as the world schedules them in `turn`. */
function registryOf(world: World, turn: Turn): Registry {
  const task = (key: Key): ScheduledTask => ({
    key,
    schedules: [{ kind: 'daily', times: () => timesOf(world, key) }],
    run: handlerOf(world, turn, key),
  });
  const update = { ...task('statistics-update'), readyGuard: guardOf(turn) };
  return [task('purge'), update, ...(world.isBackupActive ? [task('backup')] : [])];
}

/** What the database holds after a step: the runs, the journal, the open "task not run", the lease. */
async function see(db: Database) {
  const params = journalEntries.messageParams;
  const notRun = and(eq(incidents.kind, 'task_not_run'), eq(incidents.status, 'open'));
  const open = await db.select({ key: incidents.causeKey }).from(incidents).where(notRun);
  const lease = await db.select({ expiresAt: schedulerLease.expiresAt }).from(schedulerLease);
  return {
    runs: await db.select().from(taskRuns).orderBy(asc(taskRuns.startedAt), asc(taskRuns.id)),
    entries: await db
      .select({
        id: journalEntries.id,
        key: journalEntries.messageKey,
        task: sql<string | null>`${params}->>'task'`,
        dueAt: sql<string | null>`${params}->>'dueAt'`,
        runId: journalEntries.taskRunId,
        at: journalEntries.occurredAt,
      })
      .from(journalEntries)
      .orderBy(asc(journalEntries.id)),
    open: open.map(({ key }) => key),
    expiresAt: lease[0]?.expiresAt?.getTime() ?? null,
  };
}

type Seen = Awaited<ReturnType<typeof see>>;
type Run = Seen['runs'][number];
type Entry = Seen['entries'][number];
/** Where a step began: its last journal entry, and the runs that had started. */
type Mark = Readonly<{ entry: number; started: ReadonlySet<number> }>;

const startOf = (run: Run) => run.startedAt?.getTime() ?? Infinity;
const isEndedBy = (run: Run, by: number) =>
  run.finishedAt !== null && run.finishedAt.getTime() <= by;
const runsOf = (seen: Seen, key: Key) =>
  seen.runs.filter((run) => run.taskKey === key && run.startedAt !== null);
const missesOf = (seen: Seen, key: Key) =>
  seen.entries
    .filter((entry) => entry.key === 'task_run_missed' && entry.task === key)
    .map(({ id, dueAt, at }) => ({ id, dueAt: Number(dueAt), at: at.getTime() }));

/** Expects every fact about `subject` to hold, and names those that do not. */
function expectFacts(subject: object, facts: Readonly<Record<string, boolean>>): void {
  const broken = Object.keys(facts).filter((name) => facts[name] !== true);
  expect({ ...subject, broken }).toStrictEqual({ ...subject, broken: [] });
}

/** An occurrence of a task, judged at an instant by the runs that its check could read. */
type Judged = Readonly<{ key: Key; due: number; at: number; runs: readonly Run[] }>;

/**
 * Whether occurrence `due` of `key` is missed at `at` (CL-TRV-08): no run that started at or
 * after it succeeded by it plus the margin; for the statistics update (CL-TRV-23), the day's
 * run, a scheduled one or a manual one that succeeded, did not start by then, or none has a
 * result by the cut-off plus the margin, once that has come.
 */
function isMissed(world: World, { key, due, at, runs }: Judged) {
  const after = runs.filter((run) => startOf(run) >= due);
  if (key !== 'statistics-update') {
    return after.every((run) => run.result !== 'succeeded' || !isEndedBy(run, due + world.margin));
  }
  const inTime = after.filter(
    (run) =>
      startOf(run) <= due + world.margin &&
      (run.trigger === 'scheduled' || run.result === 'succeeded'),
  );
  const deadline = due + CUTOFF_MS + world.margin;
  return (
    inTime.length === 0 || (at >= deadline && inTime.every((run) => !isEndedBy(run, deadline)))
  );
}

/**
 * The last missed occurrence of `key` while nothing stands for it yet (CL-TRV-08, CL-TRV-23):
 * no success that started at or after it, nor, for the statistics update, a scheduled run that
 * started then and ended with a result; with its catch-up run, the first scheduled run that
 * started once it was missed, if one did.
 */
function pendingOf(seen: Seen, world: World, key: Key) {
  const misses = missesOf(seen, key);
  const latest = Math.max(...misses.map(({ dueAt }) => dueAt));
  const missedAt = Math.min(latest + world.margin, misses.at(-1)?.at ?? 0);
  const runs = runsOf(seen, key).filter((run) => startOf(run) >= latest);
  const scheduled = runs.filter((run) => run.trigger === 'scheduled');
  const isStoodFor =
    runs.some((run) => run.result === 'succeeded') ||
    (key === 'statistics-update' &&
      scheduled.some((run) => run.result !== null && run.result !== 'interrupted'));
  const catchUp = scheduled.find((run) => startOf(run) >= missedAt);
  return isStoodFor || misses.length === 0 ? null : { latest, catchUp };
}

/** What makes `entry` one of a kind: its missed or postponed occurrence, or its run's end. */
function onceOf({ key, task, dueAt, runId, at }: Entry): readonly string[] {
  if (key === 'task_run_missed' || key === 'task_run_postponed') {
    return [JSON.stringify([key, task, key === 'task_run_missed' ? dueAt : at.getTime()])];
  }
  return END.test(key) ? [JSON.stringify([key, runId])] : [];
}

/**
 * No journal entry comes twice for one missed occurrence, one postponed occurrence or one
 * run's end, and the lease is free after a pass, or held by a cut one until it expires
 * (TRV-28, TRV-31, CL-TRV-07, CL-TRV-08).
 */
function expectOnce(seen: Seen, world: World) {
  const keys = seen.entries.flatMap((entry) => onceOf(entry));
  const twice = keys.filter((key, index) => keys.indexOf(key) !== index);
  const cutLease = world.cutAt === null ? null : world.cutAt + STALE_AFTER_MS;
  const isLeaseFree = seen.expiresAt === null || seen.expiresAt === cutLease;
  expectFacts({ twice, expiresAt: seen.expiresAt }, { isOnce: twice.length === 0, isLeaseFree });
}

/**
 * "Task not run" is open from a miss until a run succeeds, and no scheduled run stands again
 * for an occurrence that an earlier one ended, unless that one failed or was cut (TRV-28,
 * TRV-31, CL-TRV-07, CL-TRV-08).
 */
function expectIncidents(seen: Seen) {
  for (const key of KEYS) {
    const misses = missesOf(seen, key);
    const last = misses.at(-1) ?? { id: 0, at: 0 };
    const lastDue = Math.max(
      ...misses.filter(({ at }) => at === last.at).map(({ dueAt }) => dueAt),
    );
    const endOf = (run: Run) =>
      seen.entries.find((entry) => entry.key === 'task_run_succeeded' && entry.runId === run.id);
    const isClosed = runsOf(seen, key).some(
      (run) =>
        run.result === 'succeeded' && (startOf(run) >= lastDue || (endOf(run)?.id ?? 0) > last.id),
    );
    const scheduled = runsOf(seen, key).filter((run) => run.trigger === 'scheduled');
    const again = scheduled.flatMap((later, index) =>
      scheduled
        .slice(0, index)
        .filter((earlier) => earlier.result !== 'failed' && earlier.result !== 'interrupted')
        .filter((earlier) => later.dueAt.getTime() <= earlier.dueAt.getTime())
        .map((earlier) => [earlier.id, later.id]),
    );
    const isOpenUntilSuccess = seen.open.includes(key) === (misses.length > 0 && !isClosed);
    expectFacts({ key, again }, { isOpenUntilSuccess, isRunOnce: again.length === 0 });
  }
}

/** The cursor that the last of `calls` to write one wrote. */
const lastWritten = (calls: readonly Call[]) =>
  calls.findLast((call) => call.returned !== null)?.returned;

/**
 * Each call of a run's handler is given the cursor that the run's previous calls last wrote,
 * and a run that follows a cut one resumes it, from its cursor, with its trigger and its pass
 * (TRV-30, CA-TRV-09, CL-TRV-07).
 */
function expectResumptions(seen: Seen, world: World) {
  for (const key of KEYS) {
    const runs = runsOf(seen, key);
    for (const [index, run] of runs.entries()) {
      const previous = runs[index - 1];
      const resumed = previous?.result === 'interrupted' ? previous : null;
      const calls = world.calls.filter((call) => call.run === run.id);
      const cursors = calls.map((call) => call.cursor);
      const written = calls.map((_, at) => lastWritten(calls.slice(0, at)) ?? resumed?.cursor);
      const isSame =
        resumed === null || (run.trigger === resumed.trigger && run.passId === resumed.passId);
      const isFromItsCursor = cursors.every((cursor, at) => cursor === (written[at] ?? null));
      expectFacts({ key, run: run.id, cursors, written }, { isFromItsCursor, isSame });
    }
  }
}

/**
 * A miss journaled in the step is an occurrence of the times in force, at or after the task's
 * first run, judged once its margin has passed, and missed by the runs that its check could
 * read: those started before it, or in an earlier step (TRV-31, CL-TRV-08, CL-TRV-23).
 */
function expectNewMisses(seen: Seen, world: World, mark: Mark) {
  for (const key of KEYS) {
    const all = runsOf(seen, key);
    for (const miss of missesOf(seen, key)) {
      if (miss.id <= mark.entry) {
        continue;
      }
      const runs = all.filter((run) => startOf(run) < miss.at || mark.started.has(run.id));
      expectFacts(miss, {
        isOccurrence: occurrencesOf(world, key, [miss.dueAt, miss.dueAt]).length === 1,
        isAfterFirstRun: Math.min(...all.map((run) => startOf(run))) <= miss.dueAt,
        isLate: miss.dueAt + world.margin <= miss.at,
        isMissed: isMissed(world, { key, due: miss.dueAt, at: miss.at, runs }),
      });
    }
  }
}

/**
 * After a check at `at`, each occurrence missed since the task's first run, and for the purge
 * since its times last changed, is journaled (TRV-31, CL-TRV-08, CL-TRV-23).
 */
function expectComplete(seen: Seen, world: World, at: number) {
  for (const key of keysOf(world)) {
    const runs = runsOf(seen, key);
    const first = Math.min(...runs.map((run) => startOf(run)));
    const from = key === 'purge' ? Math.max(first, world.timesSince) : first;
    const journaled = new Set(missesOf(seen, key).map(({ dueAt }) => dueAt));
    const due = runs.length === 0 ? [] : occurrencesOf(world, key, [from, at - world.margin]);
    const unjournaled = due.filter(
      (one) => !journaled.has(one) && isMissed(world, { key, due: one, at, runs }),
    );
    expectFacts({ key, unjournaled }, { isJournaled: unjournaled.length === 0 });
  }
}

/** A scheduled run of `key` that started, with the task's runs that started before it. */
type Started = Readonly<{ key: Key; run: Run; earlier: readonly Run[] }>;

/**
 * The occurrence that a scheduled run must be due for, given what came before its start: the
 * latest that has come; while the task's catch-up run is still to start, its last missed
 * occurrence at least, so that it stands for every occurrence up to its start; for a run that
 * resumes a cut one, that one's occurrence, or the catch-up run's when later (TRV-28, TRV-30,
 * TRV-31, CL-TRV-08).
 */
function dueOf(seen: Seen, world: World, { key, run, earlier }: Started) {
  const start = startOf(run);
  const entries = seen.entries.filter(({ at }) => at.getTime() <= start);
  const pending = pendingOf({ ...seen, runs: [...earlier], entries }, world, key);
  const latest = latestOf(world, key, start);
  const isCatchUp = pending !== null && pending.catchUp === undefined;
  const catchUp = isCatchUp ? Math.max(pending.latest, latest) : null;
  const previous = earlier.at(-1);
  const own = previous?.result === 'interrupted' ? previous.dueAt.getTime() : null;
  return own === null ? (catchUp ?? latest) : Math.max(own, catchUp ?? own);
}

/** Each scheduled run started in the step is due for its occurrence (TRV-28, TRV-31, CL-TRV-08). */
function expectDueAt(seen: Seen, world: World, mark: Mark) {
  for (const key of KEYS) {
    const runs = runsOf(seen, key);
    for (const [index, run] of runs.entries()) {
      if (run.trigger !== 'scheduled' || mark.started.has(run.id)) {
        continue;
      }
      const due = dueOf(seen, world, { key, run, earlier: runs.slice(0, index) });
      const dueAt = run.dueAt.getTime();
      expectFacts({ key, run: run.id, dueAt, due }, { isDueRight: dueAt === due });
    }
  }
}

/** A pass step that ran with its whole budget, from `at`. */
type Whole = Readonly<{ at: number; step: PassStep }>;

/**
 * After a pass with its whole budget, no task that runs nothing still has its catch-up run to
 * start, and each occurrence inside its margin that no run tried before has a run that
 * succeeded, when its handler succeeds and its guard lets it go (TRV-28, TRV-30, TRV-31,
 * CL-TRV-08).
 */
function expectPassDone([before, seen]: readonly [Seen, Seen], world: World, { at, step }: Whole) {
  for (const key of keysOf(world)) {
    const runs = runsOf(seen, key);
    const pending = pendingOf(seen, world, key);
    const due = latestOf(world, key, at);
    const isTimely =
      at < due + world.margin &&
      runsOf(before, key).every((run) => startOf(run) < due) &&
      step.outcomes[key] === 'succeeds' &&
      (key !== 'statistics-update' || step.answer === 'ready');
    const isCaughtUp =
      runs.at(-1)?.result === null || pending === null || pending.catchUp !== undefined;
    const isRun =
      !isTimely || runs.some((run) => run.result === 'succeeded' && startOf(run) >= due);
    expectFacts({ key, due }, { isCaughtUp, isRun });
  }
}

/** What a step did: its instant, whether a check ran then, the pass step with its whole budget. */
type Played = Readonly<{ at: number; isChecked: boolean; whole: PassStep | null }>;

/** Checks every invariant after a step that began with `before` and did `played`. */
function expectInvariants(world: World, [before, seen]: readonly [Seen, Seen], played: Played) {
  const started = before.runs.filter((run) => run.startedAt !== null).map(({ id }) => id);
  const mark = { entry: before.entries.at(-1)?.id ?? 0, started: new Set(started) };
  expectOnce(seen, world);
  expectIncidents(seen);
  expectResumptions(seen, world);
  expectNewMisses(seen, world, mark);
  expectDueAt(seen, world, mark);
  if (played.isChecked) {
    expectComplete(seen, world, played.at);
  }
  if (played.whole !== null) {
    expectPassDone([before, seen], world, { at: played.at, step: played.whole });
  }
}

/**
 * Empties what the passes write and, for a scenario with a history, records a scheduled
 * success of the purge and of the statistics update half a day before its start.
 */
async function reset(db: Database, world: World, scenario: Scenario): Promise<void> {
  const tables = sql.raw('task_runs, journal_entries, incidents, outbox_facts, scheduler_lease');
  await db.execute(sql`truncate ${tables} restart identity cascade`);
  const keys = scenario.hasHistory ? (['purge', 'statistics-update'] as const) : [];
  const rows = keys.map((key) => {
    const due = new Date(latestOf(world, key, scenario.start - 12 * HOUR));
    const run = { taskKey: key, trigger: 'scheduled', result: 'succeeded', passId: PASS } as const;
    return { ...run, dueAt: due, startedAt: due, finishedAt: new Date(due.getTime() + MINUTE) };
  });
  await (rows.length === 0 ? Promise.resolve() : db.insert(taskRuns).values(rows));
}

/** The calls of a pass step: a tick, an opening's check, two at once, or a request then a tick. */
function callsOf({ db, api }: Env, world: World, turn: Turn) {
  const registry = registryOf(world, turn);
  const tick = async () => api.execute(db, registry);
  const opening = async () => api.checkMissedRuns(db, registry, world.clock.now());
  const request = async () => {
    await api.requestRun(db, registry, turn.step.asked);
    return tick();
  };
  const calls = { tick, opening, request };
  return turn.step.calls.map(async (call) => calls[call]());
}

/** Plays a pass step until its calls end, the cut one left hanging as a function that stops. */
async function pass(env: Env, world: World, step: PassStep): Promise<readonly [World, Played]> {
  const at = world.clock.now();
  const cut = Promise.withResolvers<'cut'>();
  const turn: Turn = { step, wrote: new Set(), spent: new Set(), cut: cut.resolve };
  const calls = callsOf(env, world, turn);
  const ended = await Promise.all(calls.map(async (call) => Promise.race([call, cut.promise])));
  const isCut = ended.includes('cut');
  const ran = ended.flatMap((outcome) => (outcome !== 'cut' && outcome.ok ? [outcome] : []));
  const isWhole = !isCut && turn.spent.size === 0 && ran.some((outcome) => 'passId' in outcome);
  const played = { at, isChecked: isCut || ran.length > 0, whole: isWhole ? step : null };
  return [isCut ? { ...world, cutAt: at } : world, played];
}

/** Plays one step of a scenario: the world after it, and what it did. */
async function play(env: Env, world: World, step: Step): Promise<readonly [World, Played]> {
  const at = world.clock.now();
  if (step.kind === 'pass') {
    return pass(env, world, step);
  }
  const quiet = { at, isChecked: false, whole: null };
  if (step.kind === 'times') {
    return [{ ...world, times: step.times, timesSince: at }, quiet];
  }
  if (step.kind === 'activate') {
    return [{ ...world, isBackupActive: true }, quiet];
  }
  const next =
    step.kind === 'wait' ? at : (occurrencesOf(world, step.task, [at + 1, at + 3 * DAY])[0] ?? at);
  world.clock.advance(Math.max(MINUTE, next + step.minutes * MINUTE - at));
  return [world, quiet];
}

/** Plays `scenario` on the database of `env`, checking the invariants after each step. */
async function playScenario(env: Env, scenario: Scenario): Promise<void> {
  const params = await getParams(env.db);
  let world: World = {
    clock: fixedClock(toEpochMs(scenario.start)),
    margin: params.get('scheduler.missedRunMarginHours') * HOUR,
    zone: params.get('display.timeZone'),
    times: scenario.times,
    timesSince: -Infinity,
    isBackupActive: false,
    calls: [],
    cutAt: null,
  };
  const restore = installFakeClock(world.clock);
  try {
    await reset(env.db, world, scenario);
    let seen = await see(env.db);
    for (const step of scenario.steps) {
      const before = seen;
      const [next, played] = await play(env, world, step);
      world = next;
      seen = await see(env.db);
      expectInvariants(world, [before, seen], played);
    }
  } finally {
    restore();
  }
}

const anyOutcome = fc.constantFrom(...OUTCOMES);
const anyPassStep = fc.record({
  kind: fc.constant('pass' as const),
  calls: fc.constantFrom(CALLS[0], ...CALLS),
  outcomes: fc.record({
    purge: anyOutcome,
    'statistics-update': fc.constantFrom(...OUTCOMES, 'late' as const),
    backup: anyOutcome,
  }),
  answer: fc.constantFrom(...ANSWERS),
  asked: fc.constantFrom(...KEYS),
});
// Waits of up to twenty minutes, five hours or two days.
const anyWait = fc
  .constantFrom(20, 300, 2880)
  .chain((max) => fc.integer({ min: 1, max }))
  .map((minutes) => ({ kind: 'wait', minutes }) as const);
const anyUntil = fc.record({
  kind: fc.constant('until' as const),
  task: fc.constantFrom(...KEYS),
  minutes: fc.constantFrom(...UNTIL_MINUTES),
});
const anyTimes = fc
  .constantFrom(...PURGE_TIMES)
  .map((times) => ({ kind: 'times', times }) as const);
const anyStep = fc.oneof(
  { weight: 6, arbitrary: anyPassStep },
  { weight: 3, arbitrary: anyWait },
  { weight: 3, arbitrary: anyUntil },
  { weight: 1, arbitrary: fc.constant({ kind: 'activate' } as const) },
  { weight: 1, arbitrary: anyTimes },
);
const anyScenario = fc.record({
  start: fc.constantFrom(...STARTS),
  times: fc.constantFrom(...PURGE_TIMES),
  hasHistory: fc.boolean(),
  steps: fc.array(anyStep, { minLength: 4, maxLength: 16 }),
});

describe('the scheduler, step by step', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  it('[TRV-28] [TRV-30] [TRV-31] [CA-TRV-09] [CA-TRV-10] [CL-TRV-07] [CL-TRV-08] [CL-TRV-23] keeps the invariants of the run check, the catch-up run and the resumptions through any sequence of passes, failures, cuts and schedule changes', async () => {
    // A guard that throws logs its error, which the run's failure already records.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const env = await envOf();
    const property = fc.asyncProperty(anyScenario, async (scenario) => playScenario(env, scenario));
    await expect(fc.assert(property, { numRuns: SEQUENCES })).resolves.toBeUndefined();
  });
});
