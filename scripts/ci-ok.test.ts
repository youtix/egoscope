import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const SCRIPT = path.join(import.meta.dirname, 'ci-ok.sh');
const WORKFLOW = path.join(import.meta.dirname, '../.github/workflows/ci.yml');
const JOBS = ['lint', 'actionlint', 'typecheck', 'test', 'build', 'pr-title'] as const;

type Job = (typeof JOBS)[number];
type Verdict = Readonly<{ status: number | null; output: string }>;

function run(needs: string, event: string): Verdict {
  const result = spawnSync('sh', [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, NEEDS: needs, EVENT: event },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/**
 * The verdict for a run of `event` in which every job succeeded, except those in
 * `results`: a job mapped to undefined has no result at all.
 */
function verdict(
  event: string,
  results: Readonly<Partial<Record<Job, string | undefined>>> = {},
): Verdict {
  const needs = Object.fromEntries(
    JOBS.map((job) => {
      const result = Object.hasOwn(results, job) ? results[job] : 'success';
      return [job, result === undefined ? { outputs: {} } : { result, outputs: {} }];
    }),
  );
  return run(JSON.stringify(needs), event);
}

describe('ci-ok', () => {
  it('passes a pull request whose jobs all succeeded', () => {
    expect(verdict('pull_request')).toStrictEqual({
      status: 0,
      output: expect.stringContaining('Every job succeeded.') as unknown,
    });
  });

  it('passes a push to main, on which pr-title is skipped', () => {
    expect(verdict('push', { 'pr-title': 'skipped' }).status).toBe(0);
  });

  it.each(['failure', 'cancelled', 'skipped'])(
    'fails a pull request whose pr-title is %s',
    (result) => {
      const { status, output } = verdict('pull_request', { 'pr-title': result });

      expect(status).toBe(1);
      expect(output).toContain(`These did not: pr-title (${result})`);
    },
  );

  it.each([
    ['pull_request', 'skipped'],
    ['push', 'skipped'],
    ['push', 'failure'],
    ['push', 'cancelled'],
  ])('fails a %s run whose build is %s', (event, result) => {
    const { status, output } = verdict(event, { build: result });

    expect(status).toBe(1);
    expect(output).toContain(`These did not: build (${result})`);
  });

  it('fails a job without a result', () => {
    const { status, output } = verdict('push', { test: undefined, 'pr-title': 'skipped' });

    expect(status).toBe(1);
    expect(output).toContain('These did not: test (no result)');
  });

  it('fails when it sees no job at all, or input that is not JSON', () => {
    expect(run('{}', 'push')).toStrictEqual({
      status: 1,
      output: expect.stringContaining('These did not: no job at all') as unknown,
    });
    expect(run('not JSON', 'push').status).not.toBe(0);
  });

  it('is what the ci-ok job runs, with the needs and the event', () => {
    const workflow: unknown = parse(readFileSync(WORKFLOW, 'utf8'));

    expect(workflow).toMatchObject({
      jobs: {
        'ci-ok': {
          steps: expect.arrayContaining([
            {
              name: expect.any(String) as unknown,
              env: {
                NEEDS: expect.stringMatching(/^\$\{\{ toJSON\(needs\) \}\}$/u) as unknown,
                EVENT: expect.stringMatching(/^\$\{\{ github\.event_name \}\}$/u) as unknown,
              },
              run: 'sh scripts/ci-ok.sh',
            },
          ]) as unknown,
        },
      },
    });
  });
});
