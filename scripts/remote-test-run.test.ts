// The tests of a dispatched remote test, which remote-test-run.ts finds and follows: the run
// found by its URL or by listing, the waits, the verdicts, the cancelled run, the errors of gh
// while following, and the output of the tests read from the log. remote-test-fakes.ts holds
// the fakes, which remote-test.test.ts shares.
import { describe, expect, it } from 'vitest';

import { runLocally } from './remote-test';
import {
  BRANCH,
  FILTER,
  finishedRun,
  GATEWAY,
  harness,
  listed,
  LISTING,
  NO_URL,
  OTHER,
  RUN_URL,
  RUNS,
  STATUS_QUESTION,
  TEST_OUTPUT,
} from './remote-test-fakes';
import { testOutput } from './remote-test-run';

// The shape of `gh run view --log`: the job, the step and the timestamped text, separated by
// tabs, with a byte order mark before the first timestamp of each step. The content is invented.
const LOG = [
  `remote-test\tSet up job\t\u{FEFF}2026-11-25T10:00:00.1000000Z Current runner version: '2.330.0'`,
  'remote-test\tRun ./.github/actions/setup-project\t2026-11-25T10:00:15.0000000Z 716 packages installed',
  'remote-test\tRun the tests\t\u{FEFF}2026-11-25T10:00:16.0000000Z ##[group]Run bun scripts/remote-test.ts --runner',
  'remote-test\tRun the tests\t2026-11-25T10:00:16.0000100Z bun scripts/remote-test.ts --runner',
  'remote-test\tRun the tests\t2026-11-25T10:00:16.0000200Z shell: /usr/bin/bash -e {0}',
  'remote-test\tRun the tests\t2026-11-25T10:00:16.0000300Z env:',
  'remote-test\tRun the tests\t2026-11-25T10:00:16.0000400Z   REMOTE_TEST_FILTERS: src/lib/orbit',
  'remote-test\tRun the tests\t2026-11-25T10:00:16.0000500Z ##[endgroup]',
  'remote-test\tRun the tests\t2026-11-25T10:00:16.4000000Z ',
  'remote-test\tRun the tests\t2026-11-25T10:00:16.4100000Z  RUN  v5.1.0 /home/runner/work/probe/probe',
  'remote-test\tRun the tests\t2026-11-25T10:00:18.0000000Z  ✓ |node| src/lib/orbit/moon.test.ts (3 tests)\t12ms',
  'remote-test\tRun the tests\t2026-11-25T10:00:18.0500000Z  ✗ |node| src/lib/orbit/tide.test.ts > rises at dawn',
  'remote-test\tRun the tests\t2026-11-25T10:00:18.1000000Z  Test Files  1 failed | 1 passed (2)',
  'remote-test\tRun the tests\t2026-11-25T10:00:18.2000000Z ##[error]Process completed with exit code 1.',
  'remote-test\tPost Run ./.github/actions/setup-project\t2026-11-25T10:00:19.0000000Z Saving the cache',
  'remote-test\tComplete job\t2026-11-25T10:00:20.0000000Z Cleaning up orphan processes',
  '',
].join('\n');

describe('testOutput', () => {
  it('keeps the text of the test step alone, without names, timestamps, its opening group or workflow commands', () => {
    expect(testOutput(LOG)).toStrictEqual([
      '',
      ' RUN  v5.1.0 /home/runner/work/probe/probe',
      ' ✓ |node| src/lib/orbit/moon.test.ts (3 tests)\t12ms',
      ' ✗ |node| src/lib/orbit/tide.test.ts > rises at dawn',
      ' Test Files  1 failed | 1 passed (2)',
    ]);
  });

  it('gives nothing for a log in which the test step wrote nothing', () => {
    expect(
      testOutput(LOG.replaceAll('\tRun the tests\t', '\tRun ./.github/actions/setup-project\t')),
    ).toStrictEqual([]);
  });
});

describe('runLocally', () => {
  it('dispatches the branch that HEAD was pushed to, finds the run in the URL gh prints and exits with 0 when the tests pass', async () => {
    const remote = harness({ statuses: ['queued', 'in_progress', 'in_progress', 'completed'] });

    expect(await runLocally([...FILTER, '--coverage.include=src/lib/orbit/**'], remote.io)).toBe(0);
    expect(remote.asked.slice(0, 2)).toStrictEqual([
      LISTING,
      `workflow run remote-test.yml --ref ${BRANCH} --raw-field filters=src/lib/orbit --raw-field coverage=src/lib/orbit/**`,
    ]);
    expect(remote.timesOf(STATUS_QUESTION)).toStrictEqual([10_000, 20_000, 30_000, 40_000]);
    expect(remote.out).toStrictEqual([
      `Dispatched the remote test of a1b2c3d on ${BRANCH}: ${RUN_URL}`,
      'The run has started on a GitHub runner.',
      TEST_OUTPUT,
      `The tests passed: ${RUN_URL}`,
    ]);
    expect(remote.err).toStrictEqual([]);
  });

  it('finds the run by listing the runs of the commit on the pushed branch when gh prints no URL', async () => {
    const remote = harness({
      dispatch: NO_URL,
      earlier: listed([4241, 'completed']),
      lists: [listed([4241, 'completed']), listed([4242, 'queued'], [4241, 'completed'])],
    });

    expect(await runLocally(FILTER, remote.io)).toBe(0);
    expect(remote.timesOf(LISTING)).toStrictEqual([0, 10_000, 20_000]);
    expect(remote.timesOf(STATUS_QUESTION)).toStrictEqual([30_000]);
    expect(remote.out.at(-1)).toBe(`The tests passed: ${RUN_URL}`);
  });

  it('never follows an earlier run of the commit, in progress before and after the dispatch, but the new one', async () => {
    const remote = harness({
      dispatch: NO_URL,
      earlier: listed([4241, 'in_progress']),
      lists: [listed([4241, 'in_progress']), listed([4242, 'queued'], [4241, 'in_progress'])],
    });

    expect(await runLocally(FILTER, remote.io)).toBe(0);
    expect(remote.asked.filter((asked) => asked.includes(' 4241 '))).toStrictEqual([]);
    expect(remote.timesOf(STATUS_QUESTION)).toStrictEqual([30_000]);
    expect(remote.out).toStrictEqual([
      `Dispatched the remote test of a1b2c3d on ${BRANCH}: ${RUN_URL}`,
      TEST_OUTPUT,
      `The tests passed: ${RUN_URL}`,
    ]);
  });

  it('follows a new run that has already completed at the first listing after the dispatch', async () => {
    const remote = harness({
      dispatch: NO_URL,
      earlier: listed([4241, 'completed']),
      lists: [listed([4242, 'completed'], [4241, 'completed'])],
    });

    expect(await runLocally(FILTER, remote.io)).toBe(0);
    expect(remote.timesOf(LISTING)).toStrictEqual([0, 10_000]);
    expect(remote.timesOf(STATUS_QUESTION)).toStrictEqual([20_000]);
    expect(remote.out.at(-1)).toBe(`The tests passed: ${RUN_URL}`);
  });

  it('exits with 2 on a refused listing before the dispatch, passing on the error of gh, and dispatches nothing', async () => {
    const remote = harness({ earlier: GATEWAY });

    expect(await runLocally(FILTER, remote.io)).toBe(2);
    expect(remote.err).toStrictEqual(['HTTP 502: Bad Gateway']);
    expect(remote.asked).toStrictEqual([LISTING]);
    expect(remote.out).toStrictEqual([]);
  });

  it('exits with 2 when no run of the dispatch appears in twenty minutes', async () => {
    const remote = harness({ dispatch: NO_URL, lists: [listed()] });

    expect(await runLocally(FILTER, remote.io)).toBe(2);
    expect(remote.timesOf(LISTING)).toHaveLength(121);
    expect(remote.err).toStrictEqual([
      'No run of remote-test.yml appeared for a1b2c3d in twenty minutes.',
    ]);
  });

  it('exits with 1 and prints the output of the tests when they fail', async () => {
    const remote = harness({ finished: finishedRun({ conclusion: 'failure', tests: 'failure' }) });

    expect(await runLocally(FILTER, remote.io)).toBe(1);
    expect(remote.out.slice(-2)).toStrictEqual([TEST_OUTPUT, `The tests failed: ${RUN_URL}`]);
  });

  it.each([
    {
      name: 'a cancelled run',
      finished: { conclusion: 'cancelled', tests: 'cancelled' },
      lists: [listed([4242, 'completed'])],
      sentence: 'The run was cancelled, so it gave no result',
    },
    {
      name: 'a run that a newer dispatch replaced',
      finished: { conclusion: 'cancelled', tests: 'cancelled' },
      lists: [listed([4243, 'in_progress'], [4242, 'completed'])],
      sentence: `The run was cancelled because a newer dispatch of ${BRANCH} replaced it (${RUNS}/4243), so it gave no result`,
    },
    {
      name: 'a failed set-up step',
      finished: { conclusion: 'failure', setUp: 'failure', tests: 'skipped' },
      lists: [],
      sentence: 'A set-up step failed before the tests ran, so the run gave no result',
    },
    {
      name: 'a run of another commit',
      finished: { headSha: OTHER },
      lists: [],
      sentence:
        'The run tested commit f0e1d2c instead of HEAD a1b2c3d, so it gave no result; push HEAD and run the command again',
    },
  ])(
    'exits with 2 for $name, without printing a test output',
    async ({ finished, lists, sentence }) => {
      const remote = harness({ finished: finishedRun(finished), lists });

      expect(await runLocally(FILTER, remote.io)).toBe(2);
      expect(remote.out.at(-1)).toBe(`${sentence}: ${RUN_URL}`);
      expect(remote.asked.filter((asked) => asked.endsWith('--log'))).toStrictEqual([]);
    },
  );

  it('gives up after twenty minutes of questions ten seconds apart, and exits with 2', async () => {
    const remote = harness({ statuses: ['queued'] });
    const everyTenSeconds = Array.from({ length: 120 }, (_, index) => (index + 1) * 10_000);

    expect(await runLocally(FILTER, remote.io)).toBe(2);
    expect(remote.timesOf(STATUS_QUESTION)).toStrictEqual(everyTenSeconds);
    expect(new Set(remote.sleeps)).toStrictEqual(new Set([10_000]));
    expect(remote.out.at(-1)).toBe(
      `Gave up waiting after twenty minutes; the run goes on: ${RUN_URL}`,
    );
  });

  it.each([
    ['while it waits', { statuses: [] }, 'Could not follow the run'],
    ['reading the run', { finished: GATEWAY }, 'Could not read the run'],
  ])('passes on an error of gh %s, and exits with 2', async (_case, script, verdict) => {
    const remote = harness(script);

    expect(await runLocally(FILTER, remote.io)).toBe(2);
    expect(remote.err).toStrictEqual(['HTTP 502: Bad Gateway']);
    expect(remote.out.at(-1)).toBe(`${verdict}, so it gave no result: ${RUN_URL}`);
  });

  it('passes on an error of gh reading the log, and still exits with the verdict of the tests', async () => {
    const remote = harness({ log: GATEWAY });

    expect(await runLocally(FILTER, remote.io)).toBe(0);
    expect(remote.err).toStrictEqual(['HTTP 502: Bad Gateway']);
    expect(remote.out.at(-1)).toBe(`The tests passed: ${RUN_URL}`);
  });
});
