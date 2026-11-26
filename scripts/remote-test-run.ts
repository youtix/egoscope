/**
 * The run of a remote test on GitHub, for scripts/remote-test.ts: finds the run that a dispatch
 * started, waits for it while asking GitHub at most once every ten seconds (every agent shares
 * one allowance of requests), and judges it: the tests passed, they failed, or the run gave no
 * result. Everything it asks goes through the `gh` that its caller gives it.
 */
import { z } from 'zod';

/** The exit codes: the tests passed, they failed, or the run gave no result. */
const PASSED = 0;
const FAILED = 1;
export const NO_RESULT = 2;

export const WORKFLOW = 'remote-test.yml';
const JOB = 'remote-test';
const TEST_STEP = 'Run the tests';

const POLL_INTERVAL_MS = 10_000;
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

/** The newest run of the workflow for the commit that has not completed yet, if GitHub lists it. */
function listedRun(session: Session): Result<Run | undefined> {
  const listed = listRuns(session, ['--commit', session.commit.head]);
  if (!listed.ok) {
    return listed;
  }
  const run = listed.value.find((candidate) => candidate.status !== 'completed');
  return { ok: true, value: run && { id: String(run.databaseId), url: run.url } };
}

/** Asks `ask` after each wait of ten seconds until it answers, fails, or the deadline passes. */
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
 * commit; undefined when none appears before the deadline.
 */
export async function findRun(session: Session): Promise<Result<Run | undefined>> {
  return waitFor(session, () => listedRun(session));
}

/** Asks whether `run` has completed, and says once when it has started. */
function completion(io: LocalIo, run: Run): () => Result<true | undefined> {
  let hasStarted = false;
  return () => {
    const answer = readJson(RUN_STATUS, io.gh(['run', 'view', run.id, '--json', 'status']));
    if (!answer.ok) {
      return answer;
    }
    if (!hasStarted && answer.value.status === 'in_progress') {
      hasStarted = true;
      io.print('The run has started on a GitHub runner.');
    }
    return { ok: true, value: answer.value.status === 'completed' ? true : undefined };
  };
}

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

function printTestOutput(io: LocalIo, jobId: number): void {
  const log = io.gh(['run', 'view', '--job', String(jobId), '--log']);
  if (log.status !== 0) {
    io.printError(log.stderr.trimEnd());
    return;
  }
  const lines = testOutput(log.stdout);
  if (lines.length > 0) {
    io.print(lines.join('\n'));
  }
}

/** The verdict of the test step of `job`, after printing its output when it ran to its end. */
function testVerdict(io: LocalIo, job: z.infer<typeof JOB_STEPS> | undefined): Verdict {
  const steps = job?.steps ?? [];
  const outcome = steps.find((step) => step.name === TEST_STEP)?.conclusion;
  if (job === undefined || (outcome !== 'success' && outcome !== 'failure')) {
    return noResult(
      steps.some((step) => step.conclusion === 'failure')
        ? 'A set-up step failed before the tests ran, so the run gave no result'
        : 'The tests did not finish, so the run gave no result',
    );
  }
  printTestOutput(io, job.databaseId);
  return outcome === 'success'
    ? { code: PASSED, sentence: 'The tests passed' }
    : { code: FAILED, sentence: 'The tests failed' };
}

/** Reads the completed run and judges it: another commit, cancelled, or the tests' outcome. */
function judge(session: Session, run: Run): Verdict {
  const { io, commit } = session;
  const view = io.gh(['run', 'view', run.id, '--json', 'conclusion,headSha,jobs']);
  const finished = readJson(FINISHED_RUN, view);
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
  return conclusion === 'cancelled' ? cancelled(session, run) : testVerdict(io, job);
}

/** Waits for `run` until it completes, then prints the verdict on it as the last line. */
async function verdictOf(session: Session, run: Run): Promise<Verdict> {
  const { io } = session;
  const completed = await waitFor(session, completion(io, run));
  if (!completed.ok) {
    io.printError(completed.error);
    return noResult('Could not follow the run, so it gave no result');
  }
  return completed.value === undefined
    ? noResult('Gave up waiting after twenty minutes; the run goes on')
    : judge(session, run);
}

/**
 * Follows `run` to its end: prints its address, a line when it starts, the output of the tests
 * and the verdict with the address again, and returns the exit code: 0 when the tests passed, 1
 * when they failed, 2 when the run gave no result.
 */
export async function follow(session: Session, run: Run): Promise<number> {
  const { io, commit } = session;
  io.print(`Dispatched the remote test of ${short(commit.head)} on ${commit.branch}: ${run.url}`);
  const { code, sentence } = await verdictOf(session, run);
  io.print(`${sentence}: ${run.url}`);
  return code;
}
