// A run's ready guard (CL-TRV-23): the check that a pass and the plan make of a run that waits
// in it, and whether that run may begin its work. A check that throws, a bug or a lost
// connection, is a failed chunk of its run, which ends it at its turn (CL-TRV-07), so that
// the later tasks still run and the plan is still written.
import { logger } from '@/lib/log';
import { now } from '@/lib/time';

import { thrownFacts } from './faults';
import { epochOf, finishRun, isWaiting, markProgress, waitingRunOf } from './runs';

import type { RunRow } from './runs';
import type { Pass } from './turn';
import type { ReadyGuard, ScheduledTask } from './types';
import type { Database } from '@/lib/db';
import type { EpochMs } from '@/lib/time';

/** A run that waits in its task's ready guard. */
type Waiting = Readonly<{ guard: ReadyGuard; run: RunRow }>;

/** What the check of a ready guard answers: the run goes on, or it waits with its probe. */
type Readiness = Awaited<ReturnType<ReadyGuard['check']>>;

/** Whether a run may begin its work: it goes on, it waits in its guard, or its guard failed it. */
type Release = 'go' | 'waiting' | 'failed';

/**
 * The check of the ready guard that `run` waits in, at `at` (CL-TRV-23), or null when the
 * check throws, a bug or a lost connection, which the log records by what it threw, never by
 * its message (CL-TRV-07): the pass then fails the run and the plan makes it due at once.
 */
export async function checkGuard(
  db: Database,
  { guard, run }: Waiting,
  at: EpochMs,
): Promise<Readiness | null> {
  try {
    return await guard.check(db, waitingRunOf(run), at);
  } catch (error) {
    logger.error('A ready guard threw.', {
      task: run.taskKey,
      ...thrownFacts(error),
    });
    return null;
  }
}

/**
 * Whether `run` of `task` may begin its work in `pass` (CL-TRV-23): a run that waits in its
 * ready guard goes on once the guard lets it go, at the latest at its cut-off, its progress
 * mark then showing that its work began, or it waits; when the guard's check throws, the run
 * is recorded as failed, as a chunk that throws is (CL-TRV-07). A run that does not wait goes
 * on at once.
 */
export async function release(pass: Pass, task: ScheduledTask, run: RunRow): Promise<Release> {
  const guard = task.readyGuard;
  if (guard === undefined || !isWaiting(task, run)) {
    return 'go';
  }
  const at = now();
  const isCutOff = at >= guard.cutoff(epochOf(run.dueAt), pass.params, pass.timeZone);
  const answer = isCutOff
    ? ({ ready: true } as const)
    : await checkGuard(pass.db, { guard, run }, at);
  if (answer === null) {
    await finishRun(pass.db, run, { result: 'failed', at });
    return 'failed';
  }
  if (!answer.ready) {
    return 'waiting';
  }
  await markProgress(pass.db, run, at);
  return 'go';
}
