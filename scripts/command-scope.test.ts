import { describe, expect, it } from 'vitest';

import { commandScope } from './command-scope';

describe('commandScope', () => {
  it.each([
    [['vitest', 'run', 'src/lib/time']],
    [['node_modules/.bin/vitest', 'run', 'scripts/with-lock.test.ts']],
    [['vitest', 'list', 'src/lib/db', 'src/lib/env']],
    [['vitest', 'run', 'src/lib/time', '-t', '[TIM-01]']],
    [['vitest', 'run', 'src/lib/time', '--reporter=dot']],
    [['vitest', 'run', 'src/lib/time', '--no-coverage']],
    [['vitest', 'run', 'src/lib/time', '--coverage', '--coverage.include=src/lib/time/**']],
    [['vitest', 'run', 'src/lib/time', '--coverage', '--coverage.include', 'src/lib/time/**']],
    [['eslint', 'src/lib/time']],
    [['eslint', '--max-warnings', '0', 'src/lib/time', 'scripts/with-lock.ts']],
    [['/usr/local/bin/eslint', 'src/app/players', '--fix']],
  ])('runs %j beside a whole-project command', (command) => {
    expect(commandScope(command)).toBe('narrow');
  });

  it.each([
    [['vitest', 'run']],
    [['vitest', 'run', '--coverage']],
    [['vitest', 'run', 'src/lib/time', '--coverage']],
    [['vitest', 'run', 'src/lib/time', '--coverage.enabled=true']],
    [['vitest', 'run', '--coverage', '--coverage.include', 'src/lib/time/**']],
    [['vitest', 'run', '-t', '[TIM-01]']],
    [['vitest', 'run', '--reporter', 'verbose']],
    [['vitest', 'run', '.']],
    [['vitest', 'related', '--run', 'src/lib/a.ts']],
    [['vitest', 'src/lib/time']],
    [['eslint']],
    [['eslint', '.']],
    [['eslint', './']],
    [['eslint', '--max-warnings', '0', '.']],
    [['eslint', 'src/lib/time', '.']],
    [['eslint', '--fix', 'src/lib/time']],
    [['sh', '-c', 'vitest run src/lib/time']],
    [['sh', '-c', 'next typegen && eslint --max-warnings 0 .']],
    [['next', 'build']],
    [['playwright', 'test', 'e2e/players.spec.ts']],
    [['knip', '--treat-config-hints-as-errors']],
    [['tsc', '--noEmit']],
    [['bun', 'scripts/check-changed.ts']],
    [['bun', 'scripts/mutation-run.ts']],
    [['bun', 'run', 'gate:ci']],
    [['bun', 'x', 'vitest', 'run', 'src/lib/time']],
    [[]],
  ])('treats %j as whole-project', (command) => {
    expect(commandScope(command)).toBe('whole-project');
  });
});
