/**
 * Decides what the fast local check (`bun run check:changed`) looks at, given the
 * files that differ from origin/main.
 */

export type CheckPlan = Readonly<{
  /** Every changed file, for Prettier (which skips the kinds it does not know). */
  files: readonly string[];
  /** Files for ESLint. */
  code: readonly string[];
  /** Files for markdownlint. */
  markdown: readonly string[];
  /** Changed tooling files: when there are any, the whole test suite runs. */
  tooling: readonly string[];
  /** Changed sources, tests and fixtures, for `vitest related`. */
  related: readonly string[];
}>;

// The French specifications sit directly in docs/ and are frozen.
const FROZEN_SPEC = /^docs\/[^/]+\.md$/u;
const CODE = /\.[cm]?[jt]sx?$/u;
// Root files, scripts, CI and dependencies change how everything is built and tested.
const TOOLING = /^(?:scripts\/|\.github\/|[^/]+$)/u;
const PROSE = /^[^/]+\.md$/u;
const SOURCE_OR_DATA = /^(?:src|data)\//u;

/** Plans the fast check of `changed` paths (repository-relative, forward slashes). */
export function planCheck(changed: readonly string[]): CheckPlan {
  const files = [...new Set(changed)]
    .filter((file) => !FROZEN_SPEC.test(file))
    .toSorted((left, right) => left.localeCompare(right, 'en'));
  return {
    files,
    code: files.filter((file) => CODE.test(file)),
    markdown: files.filter((file) => file.endsWith('.md')),
    tooling: files.filter((file) => TOOLING.test(file) && !PROSE.test(file)),
    related: files.filter((file) => SOURCE_OR_DATA.test(file)),
  };
}
