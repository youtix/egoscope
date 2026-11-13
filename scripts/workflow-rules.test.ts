import { describe, expect, it } from 'vitest';

import { finalJobOf, workflowViolations } from './workflow-rules';

const CI = '.github/workflows/ci.yml';
const E2E = '.github/workflows/e2e.yml';

function problems(violations: readonly { path: string; problem: string }[]): string {
  return violations.map((violation) => `${violation.path}: ${violation.problem}`).join('\n');
}

/** The steps of a final job that judges the jobs it needs with scripts/ci-ok.sh. */
const VERDICT = [
  '    steps:',
  '      - name: Require every job to succeed',
  '        env:',
  `          NEEDS: \${{ toJSON(needs) }}`,
  `          EVENT: \${{ github.event_name }}`,
  '        run: sh scripts/ci-ok.sh',
];

/**
 * A workflow with the jobs lint and test, the lines of `extra`, and a final job
 * `final` that runs whatever happened (`always()`), needs `needs` and judges them.
 */
function workflow(final: string, needs: string, extra: readonly string[] = []): string {
  return [
    'name: Probe',
    'on:',
    '  pull_request:',
    'jobs:',
    '  lint:',
    '    runs-on: ubuntu-24.04',
    '  test:',
    '    runs-on: ubuntu-24.04',
    ...extra,
    `  ${final}:`,
    '    if: always()',
    `    needs: ${needs}`,
    '    runs-on: ubuntu-24.04',
    ...VERDICT,
    '',
  ].join('\n');
}

describe('finalJobOf', () => {
  it.each([
    [CI, 'ci-ok'],
    [E2E, 'e2e'],
    ['.github/workflows/mutation.yaml', 'mutation'],
  ])('names the final job of %s %s, which branch protection requires', (file, job) => {
    expect(finalJobOf(file)).toBe(job);
  });
});

describe('workflowViolations', () => {
  it.each([
    [CI, 'ci-ok'],
    [E2E, 'e2e'],
  ])('accepts %s with a final job %s that needs every other job', (file, final) => {
    expect(workflowViolations(file, workflow(final, '[lint, test]'))).toStrictEqual([]);
  });

  it.each([
    ['a block sequence', '\n      - lint\n      - test'],
    ['a flow sequence with a comment', '[lint, test] # every other job'],
  ])('reads needs written as %s', (_form, needs) => {
    expect(workflowViolations(CI, workflow('ci-ok', needs))).toStrictEqual([]);
  });

  it('rejects a job that the final job does not need', () => {
    expect(workflowViolations(CI, workflow('ci-ok', '[lint]'))).toStrictEqual([
      {
        path: CI,
        problem: 'Job "test" is missing from the needs of ci-ok, so it would not gate merges.',
      },
    ]);
  });

  it.each([
    ['extra-check:', 'extra-check'],
    ['extra_check:', 'extra_check'],
    ['ExtraCheck:', 'ExtraCheck'],
    ['extra-check: # runs the extra check', 'extra-check'],
    ["'extra-check':", 'extra-check'],
  ])('rejects a forgotten job whose id is written %j', (key, id) => {
    const extra = [`  ${key}`, '    runs-on: ubuntu-24.04', '    steps:', '      - run: exit 1'];
    const violations = workflowViolations(E2E, workflow('e2e', '[lint, test]', extra));

    expect(problems(violations)).toContain(`Job "${id}" is missing from the needs of e2e`);
  });

  it('counts the keys of jobs only, not keys named like jobs further down', () => {
    const extra = [
      '  build:',
      '    runs-on: ubuntu-24.04',
      '    services:',
      '      deploy:',
      '        image: postgres:17',
      '    steps:',
      '      - name: release',
      '        with:',
      '          publish: true',
    ];

    expect(workflowViolations(CI, workflow('ci-ok', '[lint, test, build]', extra))).toStrictEqual(
      [],
    );
  });

  it('rejects a final job that a failed job would skip', () => {
    const skippable = workflow('e2e', '[lint, test]').replace('    if: always()\n', '');

    expect(problems(workflowViolations(E2E, skippable))).toContain('e2e must run even when');
  });

  it('rejects a final job that does not judge the jobs it needs with scripts/ci-ok.sh', () => {
    const unjudged = workflow('e2e', '[lint, test]').replace('sh scripts/ci-ok.sh', 'exit 0');

    expect(problems(workflowViolations(E2E, unjudged))).toContain(
      'e2e must judge the jobs it needs with `sh scripts/ci-ok.sh`',
    );
  });

  it.each([`\${{ false }}`, "github.event_name == 'push'"])(
    'refuses an `if:` on the verdict step, which could skip it: if: %s',
    (condition) => {
      const skippable = workflow('e2e', '[lint, test]').replace(
        '        run: sh scripts/ci-ok.sh',
        () => `        if: ${condition}\n        run: sh scripts/ci-ok.sh`,
      );

      expect(problems(workflowViolations(E2E, skippable))).toContain(
        'The verdict step of e2e has an `if:`',
      );
    },
  );

  it('accepts an `if:` on any other step, in the final job or in a job it needs', () => {
    const extra = [
      '  report:',
      '    runs-on: ubuntu-24.04',
      '    steps:',
      '      - run: exit 1',
      '      - if: failure()',
      '        run: echo "upload the report"',
    ];
    const guarded = workflow('ci-ok', '[lint, test, report]', extra).replace(
      '    steps:\n      - name: Require',
      "    steps:\n      - if: github.event_name == 'pull_request'\n        run: echo checkout\n      - name: Require",
    );

    expect(workflowViolations(CI, guarded)).toStrictEqual([]);
  });

  it('refuses a final job named other than its id, which branch protection requires', () => {
    const renamed = workflow('e2e', '[lint, test]').replace(
      '    if: always()\n',
      '    name: End-to-end tests\n    if: always()\n',
    );

    expect(problems(workflowViolations(E2E, renamed))).toContain('The name of e2e must be its id');
  });

  it('accepts a final job named after its id', () => {
    const named = workflow('ci-ok', '[lint, test]').replace(
      '    if: always()\n',
      '    name: ci-ok\n    if: always()\n',
    );

    expect(workflowViolations(CI, named)).toStrictEqual([]);
  });

  it.each([
    [CI, 'jobs:\n  lint:\n    runs-on: ubuntu-24.04\n', 'final job named ci-ok'],
    [E2E, workflow('end-to-end', '[lint, test]'), 'final job named e2e'],
    [CI, 'jobs: [unclosed\n', 'needs jobs, in valid YAML'],
  ])('rejects %s without its final job, or not YAML at all (%#)', (file, text, problem) => {
    expect(problems(workflowViolations(file, text))).toContain(problem);
  });

  it.each([
    ['a job', ['  flaky:', '    continue-on-error: true', '    runs-on: ubuntu-24.04']],
    [
      'a step',
      [
        '  flaky:',
        '    runs-on: ubuntu-24.04',
        '    steps:',
        '      - run: exit 1',
        '        continue-on-error: true',
      ],
    ],
    [
      'a job, through an expression',
      [
        '  flaky:',
        `    continue-on-error: \${{ github.event_name == 'push' }}`,
        '    runs-on: ubuntu-24.04',
      ],
    ],
  ])('refuses continue-on-error on %s', (_where, extra) => {
    const violations = workflowViolations(CI, workflow('ci-ok', '[lint, test, flaky]', extra));

    expect(problems(violations)).toContain('continue-on-error');
  });

  it('accepts continue-on-error: false, which changes nothing', () => {
    const extra = ['  steady:', '    continue-on-error: false', '    runs-on: ubuntu-24.04'];

    expect(workflowViolations(CI, workflow('ci-ok', '[lint, test, steady]', extra))).toStrictEqual(
      [],
    );
  });

  it.each([
    ['paths', "  pull_request:\n    paths: ['src/**']\n"],
    ['paths-ignore', "  pull_request:\n    paths-ignore: ['docs/**']\n"],
  ])('rejects a trigger filtered by %s', (_filter, trigger) => {
    const filtered = workflow('e2e', '[lint, test]').replace('  pull_request:\n', () => trigger);

    expect(problems(workflowViolations(E2E, filtered))).toContain(
      'The pull_request trigger has a path filter',
    );
  });

  it('accepts branch filters and triggers written as a list', () => {
    const listed = workflow('ci-ok', '[lint, test]').replace(
      '  pull_request:\n',
      '  push:\n    branches: [main]\n',
    );

    expect(workflowViolations(CI, listed)).toStrictEqual([]);
    expect(
      workflowViolations(
        CI,
        listed.replace('on:\n  push:\n    branches: [main]\n', 'on: [push, pull_request]\n'),
      ),
    ).toStrictEqual([]);
  });

  it('exempts a workflow listed as not a check from the final job, never from continue-on-error', () => {
    const release =
      'on:\n  push:\n    paths: [CHANGELOG.md]\njobs:\n  publish:\n    runs-on: ubuntu-24.04\n';
    const careless = release.replace('    runs-on:', '    continue-on-error: true\n    runs-on:');
    const file = '.github/workflows/release.yml';
    const violations = workflowViolations(file, careless, [file]);

    expect(workflowViolations(file, release, [file])).toStrictEqual([]);
    expect(problems(violations)).toContain('continue-on-error');
  });
});
