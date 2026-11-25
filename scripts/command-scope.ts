/**
 * Tells the narrow heavy commands, which scripts/with-lock.ts lets run beside a
 * whole-project one, from every other command, which is whole-project. When in doubt,
 * a command is whole-project.
 *
 * - Narrow: `eslint` given paths, none of which covers the whole project, on one thread.
 *   A path is a word that is not a flag and does not directly follow a flag written
 *   without `=`, since it may be that flag's value (`--max-warnings 0`); every word
 *   after `--` is a path. Every word that is not a flag, a possible value included, is
 *   checked: one that names the folder the command runs in or a folder above it (`.`,
 *   `src/..`, `/`), or a pattern whose folder before its first wildcard is one of them
 *   (`**` or `{src,scripts}`), covers the whole project. `--concurrency` with any value
 *   but `off` or `1` uses several cores, as a whole-project run does.
 * - Everything else is whole-project: ESLint without a path or on the whole project, a
 *   shell around a command (`sh -c '…'`), any program not named above, and every Vitest
 *   run, even of one module: measured beside a whole-project coverage run, Vitest runs
 *   of one module made it more than half as slow again, and two of its tests timed out.
 */
import path from 'node:path';

export type Scope = 'narrow' | 'whole-project';

// The word that ends the options: every word after it is a path.
const END_OF_OPTIONS = '--';
const CONCURRENCY = '--concurrency';
const CONCURRENCY_IS = `${CONCURRENCY}=`;
// The values of `--concurrency` that keep ESLint on one thread.
const ONE_THREAD: ReadonlySet<string> = new Set(['off', '1']);
const WILDCARD = /[*?[{]/u;

const isFlag = (word: string): boolean => word.startsWith('-');

/** Says whether the word after `word` may be its value. */
const canTakeValue = (word: string | undefined): boolean =>
  word !== undefined && isFlag(word) && !word.includes('=');

/** The folder of `word` that holds no wildcard: the whole word when it is not a pattern. */
function fixedFolder(word: string): string {
  const wildcard = word.search(WILDCARD);
  return wildcard === -1 ? word : word.slice(0, word.lastIndexOf('/', wildcard) + 1);
}

/** Says whether `word`, read from `cwd`, names `cwd` or a folder above it, or a pattern over one. */
function doesCoverProject(word: string, cwd: string): boolean {
  const fromFolder = path.relative(path.resolve(cwd, fixedFolder(word)), cwd);
  return fromFolder.split(path.sep)[0] !== '..';
}

/** Says whether the options let ESLint use more than one thread. */
function isMultiThreaded(options: readonly string[]): boolean {
  const values = options.flatMap((word, index) => [
    ...(word === CONCURRENCY ? [options[index + 1] ?? ''] : []),
    ...(word.startsWith(CONCURRENCY_IS) ? [word.slice(CONCURRENCY_IS.length)] : []),
  ]);
  return values.some((value) => !ONE_THREAD.has(value));
}

/** Says whether ESLint given `args`, run in `cwd`, lints a part of the project on one thread. */
function isLintOfAPart(args: readonly string[], cwd: string): boolean {
  const end = args.indexOf(END_OF_OPTIONS);
  const [options, operands] = end === -1 ? [args, []] : [args.slice(0, end), args.slice(end + 1)];
  const words = [...options.filter((word) => !isFlag(word)), ...operands];
  const paths = [
    ...options.filter((word, index) => !isFlag(word) && !canTakeValue(options[index - 1])),
    ...operands,
  ];
  return (
    paths.length > 0 &&
    words.every((word) => !doesCoverProject(word, cwd)) &&
    !isMultiThreaded(options)
  );
}

/**
 * Says whether `command`, run in the folder `cwd`, is narrow or whole-project, by the
 * rules of the header.
 */
export function commandScope([program = '', ...args]: readonly string[], cwd: string): Scope {
  return path.basename(program) === 'eslint' && isLintOfAPart(args, cwd)
    ? 'narrow'
    : 'whole-project';
}
