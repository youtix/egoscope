/**
 * Tells the narrow heavy commands, which scripts/with-lock.ts lets run beside a
 * whole-project one, from every other command, which is whole-project. When in doubt,
 * a command is whole-project.
 *
 * - Narrow: `eslint` given paths, none of them `.`. A path is a word that is not a flag
 *   and does not directly follow a flag written without `=`, since it may be that
 *   flag's value (`--max-warnings 0`).
 * - Everything else is whole-project: ESLint without a path or on the project root, a
 *   shell around a command (`sh -c '…'`), any program not named above, and every Vitest
 *   run, even of one module: measured beside a whole-project coverage run, Vitest runs
 *   of one module made it more than half as slow again, and two of its tests timed out.
 */
import path from 'node:path';

export type Scope = 'narrow' | 'whole-project';

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

/** Says whether `command` is narrow or whole-project, by the rules of the header. */
export function commandScope([program = '', ...args]: readonly string[]): Scope {
  return path.basename(program) === 'eslint' && hasPaths(args) ? 'narrow' : 'whole-project';
}
