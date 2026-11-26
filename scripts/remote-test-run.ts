/**
 * The run of a remote test on GitHub, for scripts/remote-test.ts: finds the run that a dispatch
 * started, waits for it while asking GitHub at most once every thirty seconds (every agent shares
 * one allowance of requests), cancels it when the wait reaches its deadline, and judges it: the
 * tests passed, they failed, or the run gave no result. Everything it asks goes through the `gh`
 * that its caller gives it.
 */
import { z } from 'zod';

/** The exit codes: the tests passed, they failed, or the run gave no result. */
const PASSED = 0;
const FAILED = 1;
export const NO_RESULT = 2;

export const WORKFLOW = 'remote-test.yml';
const JOB = 'remote-test';
const TEST_STEP = 'Run the tests';

// Every agent of the build shares one allowance of requests to GitHub, and a queued run cannot
// complete sooner than this: a shorter interval would spend requests and buy nothing.
const POLL_INTERVAL_MS = 30_000;
// While the run is queued or running, a line says how long the wait has lasted this often.
const PROGRESS_INTERVAL_MS = 300_000;
const MINUTE_MS = 60_000;
// GitHub's refusal for its rate limit, primary ("API rate limit exceeded"), secondary ("a
// secondary rate limit") or for a client that asks too fast; gh gives no other sign of it.
const RATE_LIMITED = /rate limit|HTTP 429/iu;
const SHORT_SHA_LENGTH = 7;
// A line of `gh run view --log` is the job's name, the step's name and the text, which starts
// with the time it was written (and, on the step's first line, a byte order mark).
const TIMESTAMP = /^\u{FEFF}?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z ?/u;
const GROUP_START = '##[group]';
const GROUP_END = '##[endgroup]';
const WORKFLOW_COMMAND = '##[';

export type Output = Readonly<{ status: number; stdout: string; stderr: string }>;
export type Command = (args: readonly string[]) => Output;
export type Print = (line: string) => void;

/** What the local side needs from outside: git, gh, the wait, a monotonic clock and the terminal. */
export type LocalIo = Readonly<{
  git: Command;
  gh: Command;
  sleep: (milliseconds: number) => Promise<void>;
  clock: () => number;
  print: Print;
  printError: Print;
}>;

type Refusal = Readonly<{ ok: false; error: string }>;
export type Result<T> = Readonly<{ ok: true; value: T }> | Refusal;
/** HEAD, and the remote branch it was pushed to, on which runs are dispatched and listed. */
export type Commit = Readonly<{ branch: string; head: string }>;
export type Run = Readonly<{ id: string; url: string }>;
/** One remote test: who asks, the commit it tests, and the clock time at which it gives up. */
export type Session = Readonly<{ io: LocalIo; commit: Commit; deadline: number }>;
type Verdict = Readonly<{ code: number; sentence: string }>;

export const refusal = (error: string): Refusal => ({ ok: false, error });
export const short = (sha: string): string => sha.slice(0, SHORT_SHA_LENGTH);
const noResult = (sentence: string): Verdict => ({ code: NO_RESULT, sentence });
const STILL_WAITING: Result<undefined> = { ok: true, value: undefined };
const isRateLimited = <T>(result: Result<T>): boolean =>
  !result.ok && RATE_LIMITED.test(result.error);

/**
 * The lines that the test step wrote, from the output of `gh run view --log`: without the job's
 * and the step's names, the timestamps, the step's opening group (its command and environment)
 * and GitHub's workflow commands.
 */
export function testOutput(log: string): readonly string[] {
  const prefix = `${JOB}\t${TEST_STEP}\t`;
  const texts = log
    .split('\n')
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length).replace(TIMESTAMP, ''));
  const lines: string[] = [];
  let isGrouped = false;
  for (const text of texts) {
    if (text.startsWith(GROUP_START)) {
      isGrouped = true;
    } else if (isGrouped) {
      isGrouped = !text.startsWith(GROUP_END);
    } else if (!text.startsWith(WORKFLOW_COMMAND)) {
      lines.push(text);
    }
  }
  return lines;
}

const RUN_STATUS = z.object({ status: z.string() });
const LISTED_RUN = z.object({ databaseId: z.number(), status: z.string(), url: z.string() });
const LISTED_RUNS = z.array(LISTED_RUN);
const STEP = z.object({ name: z.string(), conclusion: z.string() });
const JOB_STEPS = z.object({ databaseId: z.number(), name: z.string(), steps: z.array(STEP) });
const FINISHED_RUN = z.object({
  conclusion: z.string(),
  headSha: z.string(),
  jobs: z.array(JOB_STEPS),
});

/** The answer of a `gh` command that prints JSON, or its error as it is. */
function readJson<T>(schema: z.ZodType<T>, output: Output): Result<T> {
  // gh writes the fields it is asked for; any other answer is a bug of this script to fix.
  return output.status === 0
    ? { ok: true, value: schema.parse(JSON.parse(output.stdout)) }
    : refusal(output.stderr.trimEnd());
}

/** The runs of the workflow dispatched on the branch, newest first, narrowed by `filters`. */
function listRuns(
  { io, commit }: Session,
  filters: readonly string[],
): Result<z.infer<typeof LISTED_RUNS>> {
  const runs = ['run', 'list', '--workflow', WORKFLOW, '--branch', commit.branch, ...filters];
  const fields = ['--event', 'workflow_dispatch', '--json', 'databaseId,status,url'];
  return readJson(LISTED_RUNS, io.gh([...runs, ...fields]));
}

/** The runs of the workflow dispatched for the commit, newest first. */
const commitRuns = (session: Session): Result<z.infer<typeof LISTED_RUNS>> =>
  listRuns(session, ['--commit', session.commit.head]);

/**
 * The ids of the runs of the workflow for the commit, which a listing before the dispatch holds:
 * none of them is the run of the dispatch, still queued or running as it may be.
 */
export function runsBefore(session: Session): Result<ReadonlySet<string>> {
  const listed = commitRuns(session);
  return listed.ok
    ? { ok: true, value: new Set(listed.value.map((run) => String(run.databaseId))) }
    : listed;
}

/** The newest run of the workflow for the commit that `earlier` does not hold, whatever its status. */
function listedRun(session: Session, earlier: ReadonlySet<string>): Result<Run | undefined> {
  const listed = commitRuns(session);
  if (!listed.ok) {
    return listed;
  }
  const run = listed.value.find((candidate) => !earlier.has(String(candidate.databaseId)));
  return { ok: true, value: run && { id: String(run.databaseId), url: run.url } };
}

/** Asks `ask` after each wait of thirty seconds until it answers, fails, or the deadline passes. */
async function waitFor<T>(
  session: Session,
  ask: () => Result<T | undefined>,
): Promise<Result<T | undefined>> {
  if (session.io.clock() >= session.deadline) {
    return { ok: true, value: undefined };
  }
  await session.io.sleep(POLL_INTERVAL_MS);
  const answer = ask();
  return answer.ok && answer.value === undefined ? waitFor(session, ask) : answer;
}

/**
 * Finds the run of a dispatch that gh did not name, by listing the runs of the workflow for the
 * commit: the newest one that the listing before the dispatch, `earlier`, did not hold, so that
 * an earlier dispatch of the commit is never taken for it, and a run that completed at once is
 * found too; undefined when none appears before the deadline.
 */
export async function findRun(
  session: Session,
  earlier: ReadonlySet<string>,
): Promise<Result<Run | undefined>> {
  return waitFor(session, () => listedRun(session, earlier));
}

/**
 * Asks `read` again one interval later while GitHub refuses it for its rate limit, and gives its
 * answer, or undefined when GitHub still refuses it at the deadline.
 */
async function readPatiently<T>(
  session: Session,
  read: () => Result<T>,
): Promise<Result<T> | undefined> {
  let answer = read();
  while (isRateLimited(answer)) {
    if (session.io.clock() >= session.deadline) {
      return undefined;
    }
    await session.io.sleep(POLL_INTERVAL_MS);
    answer = read();
  }
  return answer;
}

/** What the last question found of a run that has not completed. */
const PROGRESS = {
  queued: 'the run is queued and waits for a GitHub runner.',
  started: 'the run is in progress on a GitHub runner.',
  refused:
    'GitHub refused the last question for its rate limit, so the state of the run is not known.',
} as const;

/**
 * Says, once the wait that starts now has lasted five minutes and after each further five
 * minutes, how long it has lasted and what the last question found.
 */
function progressReport(io: LocalIo): (found: keyof typeof PROGRESS) => void {
  const start = io.clock();
  let reported = 0;
  return (found) => {
    const periods = Math.floor((io.clock() - start) / PROGRESS_INTERVAL_MS);
    if (periods <= reported) {
      return;
    }
    reported = periods;
    const minutes = (periods * PROGRESS_INTERVAL_MS) / MINUTE_MS;
    io.print(`Waited ${String(minutes)} minutes: ${PROGRESS[found]}`);
  };
}

/**
 * Asks whether `run` has completed, says once when it has started and every five minutes how
 * long it has waited; a question that GitHub refuses for its rate limit waits one more interval.
 */
function completion(io: LocalIo, run: Run): () => Result<true | undefined> {
  const report = progressReport(io);
  let hasStarted = false;
  return () => {
    const answer = readJson(RUN_STATUS, io.gh(['run', 'view', run.id, '--json', 'status']));
    if (isRateLimited(answer)) {
      report('refused');
      return STILL_WAITING;
    }
    if (!answer.ok) {
      return answer;
    }
    const { status } = answer.value;
    if (status === 'completed') {
      return { ok: true, value: true };
    }
    if (!hasStarted && status === 'in_progress') {
      hasStarted = true;
      io.print('The run has started on a GitHub runner.');
    }
    report(status === 'in_progress' ? 'started' : 'queued');
    return STILL_WAITING;
  };
}

/** The verdict on a completed run whose reads GitHub still refuses at the deadline. */
const unread = (run: Run): Verdict =>
  noResult(
    `The run completed, but GitHub refused to give its result for its rate limit; read it later with gh run view ${run.id} --log`,
  );

/** The verdict on a cancelled run, which names the newer dispatch that replaced it, if any. */
function cancelled(session: Session, run: Run): Verdict {
  const latest = listRuns(session, ['--limit', '1']);
  const newer = latest.ok
    ? latest.value.find((listed) => String(listed.databaseId) !== run.id)
    : undefined;
  return noResult(
    newer === undefined
      ? 'The run was cancelled, so it gave no result'
      : `The run was cancelled because a newer dispatch of ${session.commit.branch} replaced it (${newer.url}), so it gave no result`,
  );
}

function readLog(io: LocalIo, jobId: number): Result<string> {
  const log = io.gh(['run', 'view', '--job', String(jobId), '--log']);
  return log.status === 0 ? { ok: true, value: log.stdout } : refusal(log.stderr.trimEnd());
}

/** Prints the output of the tests from the log of the job, or the error of gh reading it. */
function printTestOutput(io: LocalIo, log: Result<string>): void {
  if (!log.ok) {
    io.printError(log.error);
    return;
  }
  const lines = testOutput(log.value);
  if (lines.length > 0) {
    io.print(lines.join('\n'));
  }
}

/** The verdict of the test step of `job`, after printing its output when it ran to its end. */
async function testVerdict(
  session: Session,
  run: Run,
  job: z.infer<typeof JOB_STEPS> | undefined,
): Promise<Verdict> {
  const steps = job?.steps ?? [];
  const outcome = steps.find((step) => step.name === TEST_STEP)?.conclusion;
  if (job === undefined || (outcome !== 'success' && outcome !== 'failure')) {
    return noResult(
      steps.some((step) => step.conclusion === 'failure')
        ? 'A set-up step failed before the tests ran, so the run gave no result'
        : 'The tests did not finish, so the run gave no result',
    );
  }
  const { io } = session;
  const log = await readPatiently(session, () => readLog(io, job.databaseId));
  if (log === undefined) {
    return unread(run);
  }
  printTestOutput(io, log);
  return outcome === 'success'
    ? { code: PASSED, sentence: 'The tests passed' }
    : { code: FAILED, sentence: 'The tests failed' };
}

/** Reads the completed run and judges it: another commit, cancelled, or the tests' outcome. */
async function judge(session: Session, run: Run): Promise<Verdict> {
  const { io, commit } = session;
  const finished = await readPatiently(session, () =>
    readJson(FINISHED_RUN, io.gh(['run', 'view', run.id, '--json', 'conclusion,headSha,jobs'])),
  );
  if (finished === undefined) {
    return unread(run);
  }
  if (!finished.ok) {
    io.printError(finished.error);
    return noResult('Could not read the run, so it gave no result');
  }
  const { conclusion, headSha, jobs } = finished.value;
  if (headSha !== commit.head) {
    return noResult(
      `The run tested commit ${short(headSha)} instead of HEAD ${short(commit.head)}, so it gave no result; push HEAD and run the command again`,
    );
  }
  const job = jobs.find((candidate) => candidate.name === JOB);
  return conclusion === 'cancelled' ? cancelled(session, run) : testVerdict(session, run, job);
}

/** The verdict when the wait for `run` reaches its deadline: it cancels the run, if it can. */
function giveUp(io: LocalIo, run: Run): Verdict {
  const cancel = io.gh(['run', 'cancel', run.id]);
  if (cancel.status === 0) {
    return noResult(
      'Gave up waiting after forty-five minutes; the run was cancelled so that it takes no runner',
    );
  }
  io.printError(cancel.stderr.trimEnd());
  return noResult(
    'Gave up waiting after forty-five minutes; the run could not be cancelled and goes on',
  );
}

/** Waits for `run` until it completes or the deadline passes, and gives the verdict on it. */
async function verdictOf(session: Session, run: Run): Promise<Verdict> {
  const { io } = session;
  const completed = await waitFor(session, completion(io, run));
  if (!completed.ok) {
    io.printError(completed.error);
    return noResult('Could not follow the run, so it gave no result');
  }
  return completed.value === undefined ? giveUp(io, run) : judge(session, run);
}

/**
 * Follows `run` to its end: prints its address, a line when it starts and every five minutes of
 * the wait, the output of the tests and the verdict with the address again, and returns the exit code: 0 when the tests passed, 1
 * when they failed, 2 when the run gave no result.
 */
export async function follow(session: Session, run: Run): Promise<number> {
  const { io, commit } = session;
  io.print(`Dispatched the remote test of ${short(commit.head)} on ${commit.branch}: ${run.url}`);
  const { code, sentence } = await verdictOf(session, run);
  io.print(`${sentence}: ${run.url}`);
  return code;
}
