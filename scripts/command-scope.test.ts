import { describe, expect, it } from 'vitest';

import { commandScope } from './command-scope';

describe('commandScope', () => {
  it.each([
    [['eslint', 'src/lib/time']],
    [['eslint', 'src/lib/time/', 'scripts/with-lock.ts']],
    [['node_modules/.bin/eslint', '--max-warnings', '0', 'src/lib/time', 'scripts/with-lock.ts']],
    [['/usr/local/bin/eslint', 'src/app/players', '--fix']],
    [['eslint', '--max-warnings=0', 'src/lib/time']],
  ])('runs %j beside a whole-project command', (command) => {
    expect(commandScope(command)).toBe('narrow');
  });

  it.each([
    [['eslint']],
    [['eslint', '.']],
    [['eslint', './']],
    [['eslint', '--max-warnings', '0', '.']],
    [['eslint', '--max-warnings', '0']],
    [['eslint', 'src/lib/time', '.']],
    [['eslint', '--fix', 'src/lib/time']],
    [['vitest', 'run']],
    [['vitest', 'run', 'src/lib/time']],
    [['vitest', 'list', 'src/lib/db', 'src/lib/env']],
    [['vitest', 'run', '--coverage']],
    [['vitest', 'run', 'src/lib/time', '--coverage']],
    [['vitest', 'run', 'src/lib/time', '--coverage', '--coverage.include=src/lib/time/**']],
    [['node_modules/.bin/vitest', 'run', 'scripts/with-lock.test.ts']],
    [['sh', '-c', 'eslint src/lib/time']],
    [['sh', '-c', 'next typegen && eslint --max-warnings 0 .']],
    [['next', 'build']],
    [['playwright', 'test', 'e2e/players.spec.ts']],
    [['knip', '--treat-config-hints-as-errors']],
    [['tsc', '--noEmit']],
    [['bun', 'scripts/check-changed.ts']],
    [['bun', 'scripts/mutation-run.ts']],
    [['bun', 'run', 'gate:ci']],
    [['bun', 'x', 'eslint', 'src/lib/time']],
    [['my-eslint', 'src/lib/time']],
    [[]],
  ])('treats %j as whole-project', (command) => {
    expect(commandScope(command)).toBe('whole-project');
  });
});
