import { describe, expect, it } from 'vitest';

import { isShardOfSeveral } from './vitest-shard';

/** A Vitest command line as Node's process.argv gives it, with `args` after `run`. */
const commandLine = (...args: readonly string[]): readonly string[] => [
  '/usr/bin/node',
  '/repo/node_modules/vitest/vitest.mjs',
  'run',
  ...args,
];

describe('isShardOfSeveral', () => {
  it.each([
    ['--shard=1/3', ['--shard=1/3', '--coverage', '--reporter=blob']],
    ['--shard=3/3', ['--coverage', '--shard=3/3']],
    ['--shard 2/3', ['--shard', '2/3', '--coverage']],
    ['--shard=1/2', ['--shard=1/2']],
    ['--shard=02/10', ['--shard=02/10']],
  ])('takes %s for one shard of several, whose run leaves the thresholds out', (_form, args) => {
    expect(isShardOfSeveral(commandLine(...args))).toBe(true);
  });

  it.each([
    ['no option at all', []],
    ['the coverage run of the whole suite', ['--coverage']],
    ['the merge of the shards', ['--merge-reports', '--coverage']],
    ['one shard of one, the whole suite', ['--shard=1/1', '--coverage']],
    ['--shard 1/1', ['--shard', '1/1']],
    ['an option without a value', ['--coverage', '--shard']],
    ['an empty value', ['--shard=']],
    ['a value without a count', ['--shard=1']],
    ['a count that is not a whole number', ['--shard=1/three']],
    ['a value with more than a count', ['--shard=1/3/5']],
    ['a negative count', ['--shard=1/-3']],
    ['another option that starts like it', ['--sharding=1/3']],
    ['a count followed by other characters', ['--shard=1/3x']],
  ])('keeps the thresholds for %s', (_form, args) => {
    expect(isShardOfSeveral(commandLine(...args))).toBe(false);
  });
});
