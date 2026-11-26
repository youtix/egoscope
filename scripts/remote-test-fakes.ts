/**
 * The fakes of the tests of the remote test: the answers of git and gh, and a harness that
 * runs the local side on a fake clock and records what it prints and asks. Two test files
 * share them: remote-test.test.ts, for what remote-test.ts decides before any run exists,
 * and remote-test-run.test.ts, for the dispatched run that remote-test-run.ts finds and
 * follows.
 */
import type { LocalIo, Output } from './remote-test-run';

export const HEAD = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
export const OTHER = 'f0e1d2c3b4a5968778695a4b3c2d1e0f12345678';
// As in an agent's worktree, the local branch is pushed under another name, its task's branch.
export const LOCAL = 'worktree-wf_probe-1';
export const BRANCH = 'chore/probe';
export const UPSTREAM = `for-each-ref --format=%(upstream:remotename) %(upstream:remoteref) %(upstream:track) refs/heads/${LOCAL}`;
export const COMMITS = 'rev-parse HEAD @{upstream}';
export const RUNS = 'https://github.com/example/repository/actions/runs';
// The run that the dispatch starts.
const RUN_ID = 4242;
export const RUN_URL = `${RUNS}/4242`;
const JOB_ID = 9001;
export const FILTER = ['src/lib/orbit'];
export const STATUS_QUESTION = 'run view 4242 --json status';

export const answer = (stdout = ''): Output => ({ status: 0, stdout, stderr: '' });
export const error = (stderr: string, status = 1): Output => ({ status, stdout: '', stderr });
export const GATEWAY = error('HTTP 502: Bad Gateway\n');
const json = (value: unknown): Output => answer(JSON.stringify(value));
export const listed = (...runs: readonly (readonly [number, string])[]): Output =>
  json(runs.map(([id, status]) => ({ databaseId: id, status, url: `${RUNS}/${String(id)}` })));

/** The answers of git on a pushed branch with nothing left to commit, some of them replaced. */
export function fakeGit(replaced: Readonly<Record<string, Output>> = {}): LocalIo['git'] {
  const answers: Readonly<Record<string, Output>> = {
    'symbolic-ref --quiet --short HEAD': answer(`${LOCAL}\n`),
    'status --porcelain': answer(),
    [UPSTREAM]: answer(`origin refs/heads/${BRANCH}\n`),
    [COMMITS]: answer(`${HEAD}\n${HEAD}\n`),
    ...replaced,
  };
  return (args) => answers[args.join(' ')] ?? error(`unexpected: git ${args.join(' ')}`);
}

/** The run that GitHub reports once it has completed. */
export function finishedRun({
  conclusion = 'success',
  headSha = HEAD,
  tests = 'success',
  setUp = 'success',
} = {}): Output {
  const steps = [
    ['Set up job', 'success'],
    ['Run actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1', 'success'],
    ['Run ./.github/actions/setup-project', setUp],
    ['Run the tests', tests],
    ['Complete job', 'success'],
  ].map(([name, stepConclusion]) => ({ name, conclusion: stepConclusion }));
  return json({ conclusion, headSha, jobs: [{ databaseId: JOB_ID, name: 'remote-test', steps }] });
}

// The log of the job, in the shape of `gh run view --log`, which scripts/remote-test-run.test.ts
// shows in full.
const LOG = [
  'remote-test\tRun ./.github/actions/setup-project\t2026-11-25T10:00:15.0000000Z 716 packages installed',
  'remote-test\tRun the tests\t2026-11-25T10:00:18.0000000Z  ✓ |node| src/lib/orbit/moon.test.ts (3 tests)',
  'remote-test\tRun the tests\t2026-11-25T10:00:18.1000000Z  Test Files  1 passed (1)',
].join('\n');
export const TEST_OUTPUT =
  ' ✓ |node| src/lib/orbit/moon.test.ts (3 tests)\n Test Files  1 passed (1)';

type Script = Readonly<{
  // The listing of the runs of the commit before the dispatch, which holds none by default.
  earlier?: Output;
  dispatch?: Output;
  lists?: readonly Output[];
  statuses?: readonly string[];
  finished?: Output;
  log?: Output;
}>;

const DISPATCHED = answer(
  `✓ Created workflow_dispatch event for remote-test.yml at ${BRANCH}\n${RUN_URL}\n`,
);
export const NO_URL = answer('✓ Created workflow_dispatch event for remote-test.yml\n');
export const LISTING = `run list --workflow remote-test.yml --branch ${BRANCH} --commit ${HEAD} --event workflow_dispatch --json databaseId,status,url`;

/**
 * A fake gh that answers as `script` says, each sequence repeating its last answer once spent:
 * a listing before the dispatch answers `earlier`, and those after it answer `lists`.
 */
function fakeGh(script: Script): LocalIo['gh'] {
  const asked = { list: 0, status: 0 };
  const next = (answers: readonly Output[], kind: keyof typeof asked): Output => {
    asked[kind] += 1;
    return answers[Math.min(asked[kind], answers.length) - 1] ?? GATEWAY;
  };
  const statuses = (script.statuses ?? ['completed']).map((status) => json({ status }));
  let hasDispatched = false;
  const listing = (): Output =>
    hasDispatched
      ? next(script.lists ?? [listed([RUN_ID, 'completed'])], 'list')
      : (script.earlier ?? listed());
  return (args) => {
    if (args[0] === 'workflow') {
      hasDispatched = true;
      return script.dispatch ?? DISPATCHED;
    }
    if (args[1] === 'list') {
      return listing();
    }
    if (args.at(-1) === 'status') {
      return next(statuses, 'status');
    }
    return args.at(-1) === '--log'
      ? (script.log ?? answer(LOG))
      : (script.finished ?? finishedRun());
  };
}

/** The io of a harness, and what it recorded. */
type Harness = Readonly<{
  io: LocalIo;
  out: readonly string[];
  err: readonly string[];
  sleeps: readonly number[];
  asked: readonly string[];
  timesOf: (question: string) => readonly number[];
}>;

/**
 * The io of the local side, with the fake gh of `script` and a fake git, on a fake clock that
 * only the waits move. It records what is printed, every wait, and every question to GitHub with
 * the time it was asked.
 */
export function harness(script: Script = {}, git = fakeGit()): Harness {
  let now = 0;
  const out: string[] = [];
  const err: string[] = [];
  const sleeps: number[] = [];
  const asked: string[] = [];
  const times: number[] = [];
  const gh = fakeGh(script);
  const io: LocalIo = {
    git,
    gh: (args) => {
      asked.push(args.join(' '));
      times.push(now);
      return gh(args);
    },
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
      now += milliseconds;
      await Promise.resolve();
    },
    clock: () => now,
    print: (line) => {
      out.push(line);
    },
    printError: (line) => {
      err.push(line);
    },
  };
  const timesOf = (question: string): readonly number[] =>
    times.filter((_, index) => asked[index] === question);
  return { io, out, err, sleeps, asked, timesOf };
}
