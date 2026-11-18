/**
 * Folders that no tool may read: `.claude/` holds the other agents' worktrees
 * (`.claude/worktrees/`) and local assistant settings, inside this checkout.
 *
 * ESLint, Vitest, knip, Stryker, the structure check, the traceability check and
 * the listing of changes that check:changed and the mutation gate share
 * (changed-files.ts) import this list.
 * Prettier (`.prettierignore`), markdownlint (`.markdownlint-cli2.jsonc`),
 * TypeScript (`tsconfig.json`) and the build's Tailwind scan
 * (`src/app/globals.css`) cannot, and repeat it; ignored-folders.test.ts proves
 * that every one of them skips these folders.
 */
export const IGNORED_FOLDERS: readonly string[] = ['.claude/'];

/** Says whether a repository-relative path lies in a folder that no tool may read. */
export function isIgnoredPath(path: string): boolean {
  return IGNORED_FOLDERS.some((folder) => path.startsWith(folder));
}
