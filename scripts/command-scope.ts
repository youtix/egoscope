/**
 * Tells the narrow heavy commands, which scripts/with-lock.ts lets run beside a
 * whole-project one, from every other command, which is whole-project. When in doubt,
 * a command is whole-project.
 *
 * - Narrow: `vitest run` or `vitest list` with at least one file or folder filter,
 *   either without coverage or with coverage limited by `--coverage.include` (the
 *   coverage of one module); and `eslint` given paths, none of them `.`.
 * - A path is a word that is not a flag and does not directly follow a flag written
 *   without `=`, since it may be that flag's value (`-t name`, `--max-warnings 0`).
 * - Everything else is whole-project: a run without a path, a coverage run of
 *   everything, a shell around a command (`sh -c '…'`), and any program not named above.
 */
import path from 'node:path';

export type Scope = 'narrow' | 'whole-project';

/** The Vitest commands that run once and end, rather than watch. */
export const VITEST_ONE_SHOT: ReadonlySet<string> = new Set(['run', 'list']);
// The project root, given as a path, is the whole project.
const ROOT_PATHS: ReadonlySet<string> = new Set(['.', './']);

const isFlag = (word: string): boolean => word.startsWith('-');

/** Says whether the word after `word` may be its value. */
const canTakeValue = (word: string | undefined): boolean =>
  word !== undefined && isFlag(word) && !word.includes('=');

/** Says whether `args` name at least one path, and none of them is the project root. */
function hasPaths(args: readonly string[]): boolean {
  const paths = args.filter((word, index) => !isFlag(word) && !canTakeValue(args[index - 1]));
  return paths.length > 0 && paths.every((word) => !ROOT_PATHS.has(word));
}

const isCoverage = (word: string): boolean =>
  word === '--coverage' || word.startsWith('--coverage=') || word.startsWith('--coverage.');

const isCoverageInclude = (word: string): boolean =>
  word === '--coverage.include' || word.startsWith('--coverage.include=');

function isNarrowVitest([mode = '', ...args]: readonly string[]): boolean {
  const isCoverageLimited =
    args.every((word) => !isCoverage(word)) || args.some((word) => isCoverageInclude(word));
  return VITEST_ONE_SHOT.has(mode) && isCoverageLimited && hasPaths(args);
}

/** Says whether `command` is narrow or whole-project, by the rules of the header. */
export function commandScope([program = '', ...args]: readonly string[]): Scope {
  const name = path.basename(program);
  const isNarrow = name === 'vitest' ? isNarrowVitest(args) : name === 'eslint' && hasPaths(args);
  return isNarrow ? 'narrow' : 'whole-project';
}
