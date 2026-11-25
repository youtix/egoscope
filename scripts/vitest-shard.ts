/**
 * Whether a Vitest command line runs one shard of several. CI's `test` job runs the
 * unit suite in shards (.github/workflows/ci.yml), and a shard runs only part of the
 * tests of a file, so it cannot meet the coverage thresholds set for the whole suite:
 * vitest.config.ts leaves them out of such a run alone, and CI's `coverage` job judges
 * them once, on the merged reports of the shards.
 *
 * Only `--shard=<index>/<count>` and `--shard <index>/<count>` with whole numbers
 * count. Any other form keeps the thresholds: at worst, a shard then fails them.
 */

const OPTION = '--shard';
const VALUE = /^\d+\/(?<count>\d+)$/u;
const WHOLE_SUITE = 1;

/** The value that `argv` gives the option, or undefined when it gives none. */
function shardValue(argv: readonly string[]): string | undefined {
  const index = argv.findIndex((arg) => arg === OPTION || arg.startsWith(`${OPTION}=`));
  const arg = argv[index];
  return arg === OPTION ? argv[index + 1] : arg?.slice(OPTION.length + 1);
}

/** Says whether `argv`, a Vitest command line, runs one shard of more than one. */
export function isShardOfSeveral(argv: readonly string[]): boolean {
  const count = VALUE.exec(shardValue(argv) ?? '')?.groups?.['count'];
  return count !== undefined && Number(count) > WHOLE_SUITE;
}
