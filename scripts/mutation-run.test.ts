// Proves that `bun run test:mutation` has Stryker test afresh, in every run, the
// mutants of code that runs when a module loads (mutation-run.ts). The functions
// that edit the recorded results are tested on results written out below; the
// script itself runs in a throwaway folder, where a stand-in for Stryker records the
// options and the results it is given, then records the results of a prepared run
// and exits with that run's status.
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

import {
  incrementalFileOf,
  withoutReusedStaticMutants,
  withoutStaticMutants,
} from './mutation-run';
import { INCREMENTAL_FILE } from './mutation-scope';

import type { Results } from './mutation-run';

type Mutant = Results['files'][string]['mutants'][number];

const FILE = 'src/lib/ai-exchange/text-rules.ts';
const OTHER_FILE = 'src/lib/stats-engine/types.ts';
const LOCATION = { start: { line: 43, column: 21 }, end: { line: 43, column: 27 } };

// A mutant of a function's body, which a test runs: covered and killed by that test.
const RUNTIME_KILL: Mutant = {
  id: '1',
  mutatorName: 'StringLiteral',
  replacement: '""',
  status: 'Killed',
  statusReason: "expected ' 2026' to be 'year 2026' // Object.is equality",
  testsCompleted: 1,
  static: false,
  killedBy: ['0'],
  coveredBy: ['0'],
  location: LOCATION,
};
// A mutant of a module-level pattern: no test covers it, and it ran against every test.
const STATIC_KILL: Mutant = {
  id: '2',
  mutatorName: 'Regex',
  replacement: '/\\d{4}$/u',
  status: 'Killed',
  statusReason: "expected 'year x2026' to be undefined",
  testsCompleted: 21,
  static: true,
  killedBy: ['0'],
  coveredBy: [],
  location: { start: { line: 44, column: 20 }, end: { line: 44, column: 30 } },
};
const STATIC_SURVIVOR: Mutant = {
  id: '3',
  mutatorName: 'StringLiteral',
  replacement: '""',
  status: 'Survived',
  testsCompleted: 20,
  static: true,
  killedBy: [],
  coveredBy: [],
  location: { start: { line: 2, column: 15 }, end: { line: 2, column: 21 } },
};

/** Results as Stryker records them: `mutants` in FILE, `others` in OTHER_FILE. */
const results = (mutants: readonly Mutant[], others: readonly Mutant[] = []): Results => ({
  schemaVersion: '1.0',
  files: {
    [FILE]: { language: 'typescript', source: 'export {};\n', mutants: [...mutants] },
    [OTHER_FILE]: { language: 'typescript', source: 'export {};\n', mutants: [...others] },
  },
  testFiles: {
    'src/lib/ai-exchange/text-rules.test.ts': { tests: [{ id: '0', name: 'pins the label' }] },
  },
});

describe('withoutStaticMutants', () => {
  it('takes out, file by file, the mutants that were static when the results were recorded, and keeps all else', () => {
    expect(
      withoutStaticMutants(results([RUNTIME_KILL, STATIC_KILL], [STATIC_SURVIVOR])),
    ).toStrictEqual({ results: results([RUNTIME_KILL]), removed: 2 });
  });

  it('leaves results without a static mutant as they are', () => {
    expect(withoutStaticMutants(results([RUNTIME_KILL]))).toStrictEqual({
      results: results([RUNTIME_KILL]),
      removed: 0,
    });
  });
});

describe('withoutReusedStaticMutants', () => {
  // The mutant of RUNTIME_KILL once a module calls its function when it loads: it is
  // static now, and Stryker moved its location along with the code above it.
  const nowStatic: Mutant = {
    ...RUNTIME_KILL,
    id: '7',
    static: true,
    coveredBy: [],
    location: { start: { line: 44, column: 21 }, end: { line: 44, column: 27 } },
  };

  it('takes out a mutant that is static now and holds the result of a mutant that Stryker read: a reused result', () => {
    expect(
      withoutReusedStaticMutants(results([nowStatic, STATIC_KILL]), results([RUNTIME_KILL])),
    ).toStrictEqual({ results: results([STATIC_KILL]), removed: 1 });
  });

  it('takes out a survivor that is static now, whose earlier result was a survivor too', () => {
    const runtimeSurvivor = { ...STATIC_SURVIVOR, static: false, coveredBy: ['0'] };

    expect(
      withoutReusedStaticMutants(results([], [STATIC_SURVIVOR]), results([], [runtimeSurvivor])),
    ).toStrictEqual({ results: results([]), removed: 1 });
  });

  it.each([
    ['mutator', { mutatorName: 'BlockStatement', replacement: '{}' }],
    ['replacement', { replacement: '"Stryker was here!"' }],
    ['status', { status: 'Timeout' }],
    ['reason', { statusReason: "expected 'undefined 2026' to be 'year 2026'" }],
    ['number of tests completed', { testsCompleted: 21 }],
  ])(
    'keeps a static mutant whose %s differs from that of every mutant read: a result of this run',
    (_field, difference) => {
      const tested: Mutant = { ...nowStatic, ...difference };

      expect(withoutReusedStaticMutants(results([tested]), results([RUNTIME_KILL]))).toStrictEqual({
        results: results([tested]),
        removed: 0,
      });
    },
  );

  it('keeps a mutant that holds a result read but is not static, which Stryker reuses by its own rules', () => {
    expect(
      withoutReusedStaticMutants(results([RUNTIME_KILL]), results([RUNTIME_KILL])),
    ).toStrictEqual({ results: results([RUNTIME_KILL]), removed: 0 });
  });

  it('keeps a static mutant whose result matches only a mutant of another file', () => {
    expect(
      withoutReusedStaticMutants(results([nowStatic]), results([], [RUNTIME_KILL])),
    ).toStrictEqual({ results: results([nowStatic]), removed: 0 });
  });
});

describe('incrementalFileOf', () => {
  it('is the file that stryker.config.ts names, when the options name none', () => {
    expect(incrementalFileOf(['--mutate', FILE])).toBe(INCREMENTAL_FILE);
  });

  it.each([
    [['--incrementalFile', 'probe/results.json'], 'probe/results.json'],
    [['--incrementalFile=probe/results.json', '--mutate', FILE], 'probe/results.json'],
    [['--incrementalFile', 'first.json', '--incrementalFile=last.json'], 'last.json'],
  ])('is the file that the last --incrementalFile of %j names', (args, file) => {
    expect(incrementalFileOf(args)).toBe(file);
  });
});

const SCRIPT = path.join(import.meta.dirname, 'mutation-run.ts');
// The folder of the stand-in, which comes first on the PATH of the script.
const STAND_IN_FOLDER = 'stand-in';
// Stands in for Stryker: records the options it gets and the results it finds at
// $STAND_IN_RESULTS, then records there the results of its next prepared run, and
// exits with that run's status.
const STAND_IN = `#!/bin/sh
set -eu
here=$(dirname "$0")
run=$(( $(cat "$here/runs" 2>/dev/null || echo 0) + 1 ))
echo "$run" > "$here/runs"
printf '%s\\n' "$@" > "$here/args-$run"
if [ -f "$STAND_IN_RESULTS" ]; then cp "$STAND_IN_RESULTS" "$here/seen-$run.json"; fi
mkdir -p "$(dirname "$STAND_IN_RESULTS")"
cp "$here/results-$run.json" "$STAND_IN_RESULTS"
exit "$(cat "$here/status-$run")"
`;
// Each run starts Bun, and the stand-in once or twice, on a machine that other runs may share.
const TIMEOUT_MS = 30_000;

type Play = Readonly<{ results: Results; status: number }>;
type Outcome = Readonly<{ status: number | null; stdout: string[]; stderr: string[] }>;

const linesOf = (text: string): string[] => text.split('\n').filter(Boolean);

/**
 * A throwaway folder, removed when the test ends, where `file` holds `recorded`, the
 * results of earlier runs (no file when undefined), and the stand-in for Stryker
 * plays `plays` in turn.
 */
function playground(file: string, recorded: string | undefined, plays: readonly Play[]): string {
  const root = mkdtempSync(path.join(tmpdir(), 'egoscope-mutation-run-'));
  onTestFinished(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const standIn = path.join(root, STAND_IN_FOLDER);
  mkdirSync(standIn);
  writeFileSync(path.join(standIn, 'stryker'), STAND_IN);
  chmodSync(path.join(standIn, 'stryker'), 0o755);
  for (const [index, play] of plays.entries()) {
    const run = String(index + 1);
    writeFileSync(path.join(standIn, `results-${run}.json`), JSON.stringify(play.results));
    writeFileSync(path.join(standIn, `status-${run}`), String(play.status));
  }
  if (recorded !== undefined) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), recorded);
  }
  return root;
}

/** Runs the script in `root` with Stryker's options `args`, the stand-in reading `file`. */
function testMutation(root: string, file: string, args: readonly string[]): Outcome {
  const result = spawnSync('bun', [SCRIPT, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: [path.join(root, STAND_IN_FOLDER), process.env['PATH']].join(path.delimiter),
      STAND_IN_RESULTS: file,
    },
  });
  return { status: result.status, stdout: linesOf(result.stdout), stderr: linesOf(result.stderr) };
}

/** How many times the stand-in ran. */
function runsIn(root: string): number {
  const runs = path.join(root, STAND_IN_FOLDER, 'runs');
  return existsSync(runs) ? Number(readFileSync(runs, 'utf8')) : 0;
}

/** The options of the stand-in's `run`-th run, and the results it found, if any. */
function seenIn(root: string, run: number): { args: string[]; results: unknown } {
  const standIn = path.join(root, STAND_IN_FOLDER);
  const found = path.join(standIn, `seen-${String(run)}.json`);
  const recorded: unknown = existsSync(found) ? JSON.parse(readFileSync(found, 'utf8')) : undefined;
  const args = readFileSync(path.join(standIn, `args-${String(run)}`), 'utf8');
  return { args: linesOf(args), results: recorded };
}

describe('bun run test:mutation', { timeout: TIMEOUT_MS }, () => {
  const recordedRun = JSON.stringify(results([RUNTIME_KILL, STATIC_KILL]));
  // The results of a first run after a module started to call, when it loads, the
  // function of RUNTIME_KILL: Stryker reused its kill, although no test sees it now.
  const reusedKill = results([{ ...RUNTIME_KILL, static: true, coveredBy: [] }, STATIC_KILL]);
  // The results of the run that tests that mutant afresh.
  const retested = results([{ ...STATIC_SURVIVOR, location: LOCATION }, STATIC_KILL]);

  it('runs Stryker once with the options it is given, on the recorded results without their static mutants, and passes its status on', () => {
    const root = playground(INCREMENTAL_FILE, recordedRun, [
      { results: results([RUNTIME_KILL, STATIC_KILL]), status: 1 },
    ]);

    expect(testMutation(root, INCREMENTAL_FILE, ['--mutate', FILE])).toStrictEqual({
      status: 1,
      stdout: [
        'Mutation tests: Stryker tests afresh 1 mutant of code that ran when its module loaded, since no test covers such a mutant.',
      ],
      stderr: [],
    });
    expect(runsIn(root)).toBe(1);
    expect(seenIn(root, 1)).toStrictEqual({
      args: ['run', 'stryker.config.ts', '--mutate', FILE],
      results: results([RUNTIME_KILL]),
    });
  });

  it('runs Stryker once more when it reused the result of a mutant that is static now, on the new results without it, and passes the status of that run on', () => {
    const root = playground(INCREMENTAL_FILE, JSON.stringify(results([RUNTIME_KILL])), [
      { results: reusedKill, status: 0 },
      { results: retested, status: 1 },
    ]);

    expect(testMutation(root, INCREMENTAL_FILE, [])).toStrictEqual({
      status: 1,
      stdout: [
        'Mutation tests: Stryker runs again, to test afresh 1 mutant of code that now runs when its module loads, whose earlier result it reused.',
      ],
      stderr: [],
    });
    expect(runsIn(root)).toBe(2);
    expect(seenIn(root, 1).results).toStrictEqual(results([RUNTIME_KILL]));
    expect(seenIn(root, 2)).toStrictEqual({
      args: ['run', 'stryker.config.ts'],
      results: results([STATIC_KILL]),
    });
  });

  it('only runs Stryker under --force, which reuses no result', () => {
    const root = playground(INCREMENTAL_FILE, recordedRun, [{ results: reusedKill, status: 0 }]);

    expect(testMutation(root, INCREMENTAL_FILE, ['--force'])).toStrictEqual({
      status: 0,
      stdout: [],
      stderr: [],
    });
    expect(runsIn(root)).toBe(1);
    expect(seenIn(root, 1)).toStrictEqual({
      args: ['run', 'stryker.config.ts', '--force'],
      results: results([RUNTIME_KILL, STATIC_KILL]),
    });
  });

  it('edits the results that --incrementalFile names, and no other', () => {
    const file = 'probe/results.json';
    const root = playground(file, recordedRun, [{ results: results([STATIC_KILL]), status: 0 }]);

    expect(testMutation(root, file, ['--incrementalFile', file]).status).toBe(0);
    expect(seenIn(root, 1)).toStrictEqual({
      args: ['run', 'stryker.config.ts', '--incrementalFile', file],
      results: results([RUNTIME_KILL]),
    });
    expect(existsSync(path.join(root, INCREMENTAL_FILE))).toBe(false);
  });

  it('runs Stryker once when no run has recorded results yet', () => {
    const root = playground(INCREMENTAL_FILE, undefined, [{ results: reusedKill, status: 0 }]);

    expect(testMutation(root, INCREMENTAL_FILE, [])).toStrictEqual({
      status: 0,
      stdout: [],
      stderr: [],
    });
    expect(runsIn(root)).toBe(1);
    expect(seenIn(root, 1).results).toBeUndefined();
  });

  it('does not start Stryker on results of another shape, and says why', () => {
    const root = playground(INCREMENTAL_FILE, '{"files":[]}', []);

    expect(testMutation(root, INCREMENTAL_FILE, [])).toStrictEqual({
      status: 1,
      stdout: [],
      stderr: [
        '✖ Mutation tests: reports/stryker-incremental.json holds no results of Stryker (files: Invalid input: expected record, received array). Delete it, and the next run starts from scratch.',
      ],
    });
    expect(runsIn(root)).toBe(0);
  });

  it('does not start Stryker on results that are not JSON, and says why', () => {
    const root = playground(INCREMENTAL_FILE, '{"files":', []);
    const outcome = testMutation(root, INCREMENTAL_FILE, []);

    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toStrictEqual([
      expect.stringMatching(
        /^✖ Mutation tests: reports\/stryker-incremental\.json cannot be read \(.+\)\. Delete it, and the next run starts from scratch\.$/u,
      ),
    ]);
    expect(runsIn(root)).toBe(0);
  });
});
