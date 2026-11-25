import { describe, expect, it } from 'vitest';

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
