// The tests of a dispatched remote test, which remote-test-run.ts finds and follows: the run
// found by its URL or by listing, the waits and their lines, the verdicts, the cancelled run, the
// run cancelled at the deadline, the errors of gh while following, the refusals for GitHub's rate
// limit, and the output of the tests read from the log. remote-test-fakes.ts holds
// the fakes, which remote-test.test.ts shares.
import { describe, expect, it } from 'vitest';

import { runLocally } from './remote-test';
import {
  BRANCH,
  error,
  FILTER,
  finishedRun,
  GATEWAY,
  harness,
  JOB_LOG,
  listed,
  LISTING,
  NO_URL,
  OTHER,
  RATE_LIMITED,
  RUN_URL,
  RUNS,
  SECONDARY_LIMIT,
  STATUS_QUESTION,
  TEST_OUTPUT,
} from './remote-test-fakes';
import { testOutput } from './remote-test-run';

// The shape of `gh run view --log`: the job, the step and the timestamped text, separated by
// tabs, with a byte order mark before the first timestamp of each step. The content is invented.
// A run that never completes is asked about this many times: forty-five minutes, thirty seconds
// apart.
const MAX_QUESTIONS = 90;
const CANCEL = 'run cancel 4242';
const READ = 'run view 4242 --json conclusion,headSha,jobs';
const LOG_READ = 'run view --job 9001 --log';
const UNREAD = `The run completed, but GitHub refused to give its result for its rate limit; read it later with gh run view 4242 --log: ${RUN_URL}`;
const DISPATCHED = `Dispatched the remote test of a1b2c3d on ${BRANCH}: ${RUN_URL}`;
const PASSED = `The tests passed: ${RUN_URL}`;
const QUEUED = 'the run is queued and waits for a GitHub runner.';
const STARTED = 'the run is in progress on a GitHub runner.';
const REFUSED =
  'GitHub refused the last question for its rate limit, so the state of the run is not known.';

/** The clock times of `count` questions thirty seconds apart, the first after one wait. */
const everyThirtySeconds = (count: number): readonly number[] =>
  Array.from({ length: count }, (_, index) => (index + 1) * 30_000);
const repeated = <T>(value: T, count: number): readonly T[] =>
  Array.from({ length: count }, () => value);

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
    expect(remote.timesOf(STATUS_QUESTION)).toStrictEqual([30_000, 60_000, 90_000, 120_000]);
    expect(remote.out).toStrictEqual([
      `Dispatched the remote test of a1b2c3d on ${BRANCH}: ${RUN_URL}`,
      'The run has started on a GitHub runner.',
      TEST_OUTPUT,
      PASSED,
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
    expect(remote.timesOf(LISTING)).toStrictEqual([0, 30_000, 60_000]);
    expect(remote.timesOf(STATUS_QUESTION)).toStrictEqual([90_000]);
    expect(remote.out.at(-1)).toBe(PASSED);
  });

  it('never follows an earlier run of the commit, in progress before and after the dispatch, but the new one', async () => {
    const remote = harness({
      dispatch: NO_URL,
      earlier: listed([4241, 'in_progress']),
      lists: [listed([4241, 'in_progress']), listed([4242, 'queued'], [4241, 'in_progress'])],
    });

    expect(await runLocally(FILTER, remote.io)).toBe(0);
    expect(remote.asked.filter((asked) => asked.includes(' 4241 '))).toStrictEqual([]);
    expect(remote.timesOf(STATUS_QUESTION)).toStrictEqual([90_000]);
    expect(remote.out).toStrictEqual([
      `Dispatched the remote test of a1b2c3d on ${BRANCH}: ${RUN_URL}`,
      TEST_OUTPUT,
      PASSED,
    ]);
  });

  it('follows a new run that has already completed at the first listing after the dispatch', async () => {
    const remote = harness({
      dispatch: NO_URL,
      earlier: listed([4241, 'completed']),
      lists: [listed([4242, 'completed'], [4241, 'completed'])],
    });

    expect(await runLocally(FILTER, remote.io)).toBe(0);
    expect(remote.timesOf(LISTING)).toStrictEqual([0, 30_000]);
    expect(remote.timesOf(STATUS_QUESTION)).toStrictEqual([60_000]);
    expect(remote.out.at(-1)).toBe(PASSED);
  });

  it('exits with 2 on a refused listing before the dispatch, passing on the error of gh, and dispatches nothing', async () => {
    const remote = harness({ earlier: GATEWAY });

    expect(await runLocally(FILTER, remote.io)).toBe(2);
    expect(remote.err).toStrictEqual(['HTTP 502: Bad Gateway']);
    expect(remote.asked).toStrictEqual([LISTING]);
    expect(remote.out).toStrictEqual([]);
  });

  it('exits with 2 when no run of the dispatch appears in forty-five minutes of listings thirty seconds apart', async () => {
    const remote = harness({ dispatch: NO_URL, lists: [listed()] });

    expect(await runLocally(FILTER, remote.io)).toBe(2);
    expect(remote.timesOf(LISTING)).toStrictEqual([0, ...everyThirtySeconds(MAX_QUESTIONS)]);
    expect(remote.err).toStrictEqual([
      'No run of remote-test.yml appeared for a1b2c3d in forty-five minutes.',
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

  it('gives up after forty-five minutes of questions thirty seconds apart, cancels the run and exits with 2', async () => {
    const remote = harness({ statuses: ['queued'] });

    expect(await runLocally(FILTER, remote.io)).toBe(2);
    expect(remote.timesOf(STATUS_QUESTION)).toStrictEqual(everyThirtySeconds(MAX_QUESTIONS));
    expect(new Set(remote.sleeps)).toStrictEqual(new Set([30_000]));
    expect(remote.err).toStrictEqual([]);
    expect(remote.out.at(-1)).toBe(
      `Gave up waiting after forty-five minutes; the run was cancelled so that it takes no runner: ${RUN_URL}`,
    );
  });

  it('asks for the cancel of the run once, as the last of its 93 questions to gh, after the 90th on its status', async () => {
    const remote = harness({ statuses: ['queued'] });

    expect(await runLocally(FILTER, remote.io)).toBe(2);
    expect(remote.asked.filter((asked) => asked.startsWith('run cancel'))).toStrictEqual([CANCEL]);
    expect(remote.asked.at(-1)).toBe(CANCEL);
    expect(remote.asked).toHaveLength(93);
  });

  it('passes on the error of a cancel that gh refuses at the deadline, says that the run goes on and exits with 2', async () => {
    const remote = harness({
      statuses: ['queued'],
      cancel: error('HTTP 403: Resource not accessible\n'),
    });

    expect(await runLocally(FILTER, remote.io)).toBe(2);
    expect(remote.asked.at(-1)).toBe(CANCEL);
    expect(remote.err).toStrictEqual(['HTTP 403: Resource not accessible']);
    expect(remote.out.at(-1)).toBe(
      `Gave up waiting after forty-five minutes; the run could not be cancelled and goes on: ${RUN_URL}`,
    );
  });

  it.each([
    ['a run that completes', {}],
    ['a run whose status gh cannot give', { statuses: [] }],
    ['a run that gh cannot read', { finished: GATEWAY }],
    [
      'a run that a newer dispatch replaced',
      {
        finished: finishedRun({ conclusion: 'cancelled', tests: 'cancelled' }),
        lists: [listed([4243, 'in_progress'], [4242, 'completed'])],
      },
    ],
    ['a dispatch whose run never appears', { dispatch: NO_URL, lists: [listed()] }],
  ])('cancels no run for %s', async (_case, script) => {
    const remote = harness(script);

    await runLocally(FILTER, remote.io);
    expect(remote.asked.filter((asked) => asked.startsWith('run cancel'))).toStrictEqual([]);
  });

  it.each([
    ['2 minutes', 4, 8],
    ['20 minutes', 40, 44],
    ['45 minutes', 90, 94],
  ])(
    'asks gh only for the listing, the dispatch, the status every thirty seconds and the two reads of a run that completes after %s',
    async (_case, questions, calls) => {
      const remote = harness({ statuses: [...repeated('queued', questions - 1), 'completed'] });

      expect(await runLocally(FILTER, remote.io)).toBe(0);
      expect(remote.timesOf(STATUS_QUESTION)).toStrictEqual(everyThirtySeconds(questions));
      expect(remote.asked).toHaveLength(calls);
    },
  );

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
    expect(remote.out.at(-1)).toBe(PASSED);
  });
});

describe('runLocally while the run waits', () => {
  it('says every five minutes that a run queued for twelve minutes waits for a runner, and nothing else', async () => {
    const remote = harness({ statuses: [...repeated('queued', 24), 'completed'] });

    expect(await runLocally(FILTER, remote.io)).toBe(0);
    expect(remote.out).toStrictEqual([
      DISPATCHED,
      `Waited 5 minutes: ${QUEUED}`,
      `Waited 10 minutes: ${QUEUED}`,
      TEST_OUTPUT,
      PASSED,
    ]);
    expect(remote.printedAt.slice(0, 3)).toStrictEqual([0, 300_000, 600_000]);
  });

  it('says once that the run has started, then every five minutes that it is in progress', async () => {
    const remote = harness({
      statuses: [...repeated('queued', 3), ...repeated('in_progress', 18), 'completed'],
    });

    expect(await runLocally(FILTER, remote.io)).toBe(0);
    expect(remote.out).toStrictEqual([
      DISPATCHED,
      'The run has started on a GitHub runner.',
      `Waited 5 minutes: ${STARTED}`,
      `Waited 10 minutes: ${STARTED}`,
      TEST_OUTPUT,
      PASSED,
    ]);
    expect(remote.printedAt.slice(1, 4)).toStrictEqual([120_000, 300_000, 600_000]);
  });

  it('prints no line of the wait for a run that completes in two minutes', async () => {
    const remote = harness({ statuses: [...repeated('queued', 3), 'completed'] });

    expect(await runLocally(FILTER, remote.io)).toBe(0);
    expect(remote.out).toStrictEqual([DISPATCHED, TEST_OUTPUT, PASSED]);
  });

  it('counts the five minutes from the start of the wait for a run that a listing found', async () => {
    const remote = harness({
      dispatch: NO_URL,
      lists: [listed(), listed([4242, 'queued'])],
      statuses: [...repeated('queued', 10), 'completed'],
    });

    expect(await runLocally(FILTER, remote.io)).toBe(0);
    expect(remote.out.slice(0, 2)).toStrictEqual([DISPATCHED, `Waited 5 minutes: ${QUEUED}`]);
    expect(remote.printedAt.slice(0, 2)).toStrictEqual([60_000, 360_000]);
  });
});

describe("runLocally under GitHub's rate limit", () => {
  it('asks again thirty seconds later when GitHub refuses a question on the status for its primary or secondary rate limit', async () => {
    const remote = harness({
      statuses: ['queued', 'queued', RATE_LIMITED, SECONDARY_LIMIT, 'completed'],
    });

    expect(await runLocally(FILTER, remote.io)).toBe(0);
    expect(remote.err).toStrictEqual([]);
    expect(remote.timesOf(STATUS_QUESTION)).toStrictEqual(everyThirtySeconds(5));
    expect(remote.out).toStrictEqual([DISPATCHED, TEST_OUTPUT, PASSED]);
  });

  it.each([
    'HTTP 429: Too Many Requests',
    'failed to get run: HTTP 403: API Rate Limit exceeded for user ID 1.',
  ])(
    'takes %j for a refusal for the rate limit, anywhere in the error and in any case',
    async (text) => {
      const remote = harness({ statuses: [error(`${text}\n`), 'completed'] });

      expect(await runLocally(FILTER, remote.io)).toBe(0);
      expect(remote.timesOf(STATUS_QUESTION)).toStrictEqual([30_000, 60_000]);
    },
  );

  it('says every five minutes that the state is not known, then cancels at the deadline a run whose every question GitHub refuses', async () => {
    const remote = harness({ statuses: [RATE_LIMITED] });
    const fiveMinutes = Array.from({ length: 9 }, (_, index) => (index + 1) * 5);

    expect(await runLocally(FILTER, remote.io)).toBe(2);
    expect(remote.asked.slice(2)).toStrictEqual([
      ...repeated(STATUS_QUESTION, MAX_QUESTIONS),
      CANCEL,
    ]);
    expect(remote.timesOf(STATUS_QUESTION)).toStrictEqual(everyThirtySeconds(MAX_QUESTIONS));
    expect(remote.out).toStrictEqual([
      DISPATCHED,
      ...fiveMinutes.map((minutes) => `Waited ${String(minutes)} minutes: ${REFUSED}`),
      `Gave up waiting after forty-five minutes; the run was cancelled so that it takes no runner: ${RUN_URL}`,
    ]);
    expect(remote.printedAt.slice(1, 10)).toStrictEqual(
      fiveMinutes.map((minutes) => minutes * 60_000),
    );
  });

  it('forgets a refusal once GitHub answers again, in the next line of the wait', async () => {
    const remote = harness({
      statuses: [...repeated('queued', 9), RATE_LIMITED, ...repeated('queued', 10), 'completed'],
    });

    expect(await runLocally(FILTER, remote.io)).toBe(0);
    expect(remote.out.slice(1, 3)).toStrictEqual([
      `Waited 5 minutes: ${REFUSED}`,
      `Waited 10 minutes: ${QUEUED}`,
    ]);
  });

  it.each(['HTTP 502: Bad Gateway', 'HTTP 404: Not Found'])(
    'ends the wait at the first question that gh refuses with %j',
    async (text) => {
      const remote = harness({ statuses: [error(`${text}\n`)] });

      expect(await runLocally(FILTER, remote.io)).toBe(2);
      expect(remote.timesOf(STATUS_QUESTION)).toStrictEqual([30_000]);
      expect(remote.err).toStrictEqual([text]);
      expect(remote.out.at(-1)).toBe(`Could not follow the run, so it gave no result: ${RUN_URL}`);
    },
  );

  it.each([
    ['the run', { finished: [RATE_LIMITED, SECONDARY_LIMIT, finishedRun()] }, READ],
    ['its log', { log: [RATE_LIMITED, SECONDARY_LIMIT, JOB_LOG] }, LOG_READ],
  ])(
    'reads %s of a completed run again thirty seconds later while GitHub refuses it for its rate limit',
    async (_case, reads, question) => {
      const remote = harness({ statuses: ['queued', 'completed'], ...reads });

      expect(await runLocally(FILTER, remote.io)).toBe(0);
      expect(remote.timesOf(question)).toStrictEqual([60_000, 90_000, 120_000]);
      expect(remote.err).toStrictEqual([]);
      expect(remote.out).toStrictEqual([DISPATCHED, TEST_OUTPUT, PASSED]);
    },
  );

  it.each([
    ['the run', { finished: [RATE_LIMITED] }, READ],
    ['its log', { log: [RATE_LIMITED] }, LOG_READ],
  ])(
    'names a completed run and the command that reads it later when GitHub refuses %s until the deadline, and cancels nothing',
    async (_case, reads, question) => {
      const remote = harness({ statuses: ['queued', 'completed'], ...reads });

      expect(await runLocally(FILTER, remote.io)).toBe(2);
      expect(remote.timesOf(question)).toStrictEqual(everyThirtySeconds(MAX_QUESTIONS).slice(1));
      expect(remote.asked.filter((asked) => asked.startsWith('run cancel'))).toStrictEqual([]);
      expect(remote.err).toStrictEqual([]);
      expect(remote.out.at(-1)).toBe(UNREAD);
    },
  );

  it('ends at once on a read of the completed run that gh refuses for another reason', async () => {
    const remote = harness({ statuses: ['queued', 'completed'], finished: GATEWAY });

    expect(await runLocally(FILTER, remote.io)).toBe(2);
    expect(remote.timesOf(READ)).toStrictEqual([60_000]);
    expect(remote.err).toStrictEqual(['HTTP 502: Bad Gateway']);
    expect(remote.out.at(-1)).toBe(`Could not read the run, so it gave no result: ${RUN_URL}`);
  });
});
