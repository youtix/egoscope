/**
 * The folders of files that a tool generates and the repository commits, such as
 * the database migrations that drizzle-kit writes to drizzle/. A file there is
 * never edited by hand, only regenerated, and the task that adds a generator adds
 * the CI check that regenerating gives no difference.
 *
 * These files are exempt from the naming rule of the structure check, from ESLint,
 * knip, Prettier and markdownlint, and counted in no coverage. Nothing outside these
 * folders is exempt, and a folder joins the list only by a change to this module,
 * which reviewers see.
 *
 * ESLint, Vitest, knip, the structure check and check:changed import this list.
 * Prettier (`.prettierignore`) and markdownlint (`.markdownlint-cli2.jsonc`) cannot,
 * and repeat it; generated-files.test.ts proves that every tool honours the list,
 * and that the two repetitions match it.
 */
export const GENERATED_FOLDERS: readonly string[] = ['drizzle/'];

/** Says whether a repository-relative path lies in a folder of generated files. */
export function isGeneratedPath(path: string): boolean {
  return GENERATED_FOLDERS.some((folder) => path.startsWith(folder));
}
