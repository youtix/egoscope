import type { Database, taskRuns } from '@/lib/db';
import type { ParamReader } from '@/lib/params';
import type { EpochMs } from '@/lib/time';
import type { ProbeKind, TaskKey, WakeProbe } from '@/lib/wake-plan';

/** How a run started: on schedule, a catch-up included, or at the owner's request (TRV-33, CL-TRV-08). */
export type TaskRunTrigger = (typeof taskRuns.$inferSelect)['trigger'];

/** How a run ended; a run without one is running, or waits to start (TRV-26, CL-TRV-07). */
export type TaskRunResult = NonNullable<(typeof taskRuns.$inferSelect)['result']>;

/** A day of the week, as `backups.weekday` names it, or every day. */
export type Weekday =
  'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday' | 'every_day';

/**
 * When a task comes due (module map §1.9, §4), in one of four kinds: local times in the
 * owner's zone every day; one local time on a weekday, or every day; after a successful
 * run of another task, in its pass; or at the instant its owner computes from its rows.
 */
export type TaskSchedule =
  | Readonly<{ kind: 'daily'; times: (params: ParamReader) => readonly string[] }>
  | Readonly<{
      kind: 'weekly';
      occurrence: (params: ParamReader) => Readonly<{ weekday: Weekday; time: string }>;
    }>
  | Readonly<{ kind: 'chained'; after: readonly TaskKey[] }>
  | Readonly<{
      kind: 'computed';
      nextDueAt: (db: Database, at: EpochMs) => Promise<EpochMs | null>;
    }>;

/** A run that waits in its task's ready guard: running, without the lease or a connection. */
export type WaitingRun = Readonly<{ id: number; dueAt: EpochMs; startedAt: EpochMs }>;

/** What a probe found: work, which sends the tick to the database, or its next call. */
export type ProbeOutcome = Readonly<{ found: true }> | Readonly<{ found: false; next: WakeProbe }>;

/**
 * What lets a due scheduled run wait without the lease or the database (CL-TRV-23): the
 * database-free call that a tick makes while it waits, the check that a pass makes, and
 * the cut-off at which the wait ends whatever the probes found. A run asked by the owner
 * never waits (TRV-33).
 */
export type ReadyGuard = Readonly<{
  probe: ProbeKind;
  call: (probe: WakeProbe, at: EpochMs) => Promise<ProbeOutcome>;
  check: (
    db: Database,
    run: WaitingRun,
    at: EpochMs,
  ) => Promise<Readonly<{ ready: true }> | Readonly<{ ready: false; probe: WakeProbe }>>;
  cutoff: (dueAt: EpochMs, params: ParamReader, timeZone: string) => EpochMs;
}>;

/** What a handler is given for one chunk of its run (TRV-30). */
export type TaskContext = Readonly<{
  db: Database;
  now: EpochMs;
  /** The pass stops starting chunks at `endsAt`: a chunk ends well before it. */
  budget: Readonly<{ endsAt: EpochMs }>;
  passId: string;
  /** Where the run resumes, `null` at its start (TRV-30). */
  cursor: string | null;
  trigger: TaskRunTrigger;
  runId: number;
}>;

/** How a chunk ended: more to do from `cursor`, or the run's result. */
export type ChunkOutcome =
  | Readonly<{ kind: 'more'; cursor: string }>
  | Readonly<{ kind: 'done'; result: Exclude<TaskRunResult, 'interrupted'> }>;

/** A task of the registry, as the scheduler runs it (module map §4). */
export type ScheduledTask = Readonly<{
  key: TaskKey;
  schedules: readonly TaskSchedule[];
  readyGuard?: ReadyGuard;
  run: (context: TaskContext) => Promise<ChunkOutcome>;
}>;

/** The active tasks, in the order a pass runs them (module map §4). */
export type Registry = readonly ScheduledTask[];
