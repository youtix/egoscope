/**
 * The base that the mutation gate measures a change from (mutation-gate.ts), chosen
 * from the event that runs it, or the reason why it has none and tests every mutant:
 *
 * - no event, as `bun run gate` runs it: where HEAD left origin/main;
 * - `pull_request`: HEAD^1, the base branch of the pull request's merge commit;
 * - `push`, to main: the newest commit of main on which a push run of the mutation
 *   workflow succeeded. A successful run proves the tree of its commit: either it tested
 *   every mutant, or nothing in the scope differed from a commit that an earlier
 *   successful run had proven. A failed run, or one that GitHub replaced while it was
 *   pending, proves nothing, so its change stays inside the next comparison;
 * - any other event: none.
 *
 * It fails closed: whenever that commit cannot be determined, the gate tests every
 * mutant from scratch, never "nothing to do". The listing is one request of the GitHub
 * CLI with the workflow's own token (GH_TOKEN), for the repository that GitHub names in
 * GITHUB_REPOSITORY.
 */
import { spawnSync } from 'node:child_process';

import { z } from 'zod';

/** A base to compare with, and how to name it, or why there is none. */
export type GateBase =
  | Readonly<{ compare: true; base: string | undefined; label: string }>
  | Readonly<{ compare: false; reason: string }>;

// The newest successful push run of the mutation workflow on main, first and alone.
const LAST_SUCCESS_QUERY =
  'branch=main&event=push&status=success&exclude_pull_requests=true&per_page=1';
// A commit as the GitHub API writes it.
const COMMIT_SHA = /^[0-9a-f]{40}$/u;

// The API's names of the fields that the gate reads.
const FIELD = { runs: 'workflow_runs', headSha: 'head_sha' } as const;
const LISTED_RUN = z.object({ [FIELD.headSha]: z.string() });
const RUN_LISTING = z.object({ [FIELD.runs]: z.array(LISTED_RUN) });

const scratch = (reason: string): GateBase => ({ compare: false, reason });

/** Runs git; says whether it succeeded. */
const doesGitSucceed = (...args: readonly string[]): boolean =>
  spawnSync('git', args, { stdio: 'ignore' }).status === 0;

/** The JSON that `output` holds, or undefined when it holds none. */
function parseJson(output: string): unknown {
  try {
    return JSON.parse(output);
  } catch {
    return undefined;
  }
}

/** The commit of the newest successful push run on main, or why it cannot be read. */
function lastSuccess(repository: string): Readonly<{ sha: string } | { reason: string }> {
  const answer = spawnSync(
    'gh',
    ['api', `repos/${repository}/actions/workflows/mutation.yml/runs?${LAST_SUCCESS_QUERY}`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
  if (answer.error !== undefined) {
    return { reason: `the GitHub CLI could not start (${answer.error.message})` };
  }
  if (answer.status !== 0) {
    return {
      reason: `the GitHub CLI could not list the runs of the mutation workflow (exit code ${String(answer.status)})`,
    };
  }
  const listing = RUN_LISTING.safeParse(parseJson(answer.stdout));
  if (!listing.success) {
    return { reason: 'the list of the runs of the mutation workflow is not the expected JSON' };
  }
  const [run] = listing.data[FIELD.runs];
  if (run === undefined) {
    return { reason: 'no push run of the mutation workflow has succeeded on main yet' };
  }
  const sha = run[FIELD.headSha];
  return COMMIT_SHA.test(sha)
    ? { sha }
    : { reason: 'the last successful run of the mutation workflow names no valid commit' };
}

/** The last commit of main on which the mutation workflow succeeded, checked against HEAD. */
function pushBase(repository: string | undefined): GateBase {
  if (repository === undefined || repository === '') {
    return scratch(
      'GITHUB_REPOSITORY is unset, so the runs of the mutation workflow cannot be listed',
    );
  }
  const last = lastSuccess(repository);
  if ('reason' in last) {
    return scratch(last.reason);
  }
  const what = `${last.sha}, the last commit of main on which the mutation workflow succeeded`;
  if (!doesGitSucceed('cat-file', '-e', last.sha)) {
    return scratch(`${what}, is not in the checkout`);
  }
  if (!doesGitSucceed('merge-base', '--is-ancestor', last.sha, 'HEAD')) {
    return scratch(`${what}, is not an ancestor of HEAD`);
  }
  return { compare: true, base: last.sha, label: what };
}

/**
 * The base for `event`, the event that runs the mutation workflow, or undefined when
 * the gate runs outside it; `environment` gives GITHUB_REPOSITORY.
 */
export function chooseBase(
  event: string | undefined,
  environment: Readonly<Record<string, string | undefined>>,
): GateBase {
  switch (event) {
    case undefined: {
      return { compare: true, base: undefined, label: 'where HEAD left origin/main' };
    }
    case 'pull_request': {
      return {
        compare: true,
        base: 'HEAD^1',
        label: 'HEAD^1, the base branch of the pull request',
      };
    }
    case 'push': {
      return pushBase(environment['GITHUB_REPOSITORY']);
    }
    default: {
      return scratch(`the ${JSON.stringify(event)} event has no base to compare with`);
    }
  }
}
