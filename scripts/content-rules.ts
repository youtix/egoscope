/**
 * Repository rules that read file contents, checked by `bun run lint:structure`
 * next to the layout rules of structure-rules.ts:
 *
 * - the frozen French specifications match their checksum manifest;
 * - relative Markdown links point at files that exist;
 * - no comment switches a check off in the files that ESLint does not read;
 * - ci-ok depends on every other job of the CI workflow and runs whatever they
 *   did, and no workflow trigger is filtered by path.
 */
import path from 'node:path';

import { parse } from 'yaml';

import type { StructureViolation } from './structure-rules';

/** The checksum manifest of the frozen French specifications (`sha256sum` format). */
export const FROZEN_MANIFEST = 'docs/frozen-specs.sha256';

// The French specifications are the Markdown files directly inside docs/.
const FROZEN_SPEC = /^docs\/[^/]+\.md$/u;
const MANIFEST_LINE = /^(?<hash>[0-9a-f]{64}) {2}(?<file>\S+)$/u;
const FROZEN_HELP = `A deliberate change to the specifications updates ${FROZEN_MANIFEST} in the same pull request.`;

/** Says whether `file` is one of the frozen French specifications. */
export function isFrozenSpec(file: string): boolean {
  return FROZEN_SPEC.test(file);
}

/** Reads the manifest into the hash of each listed file, and reports the lines it cannot read. */
function readManifest(
  manifest: string,
): Readonly<{ listed: ReadonlyMap<string, string>; malformed: readonly StructureViolation[] }> {
  const listed = new Map<string, string>();
  const malformed: StructureViolation[] = [];
  for (const line of manifest.split('\n')) {
    const groups = MANIFEST_LINE.exec(line)?.groups;
    const hash = groups?.['hash'];
    const file = groups?.['file'];
    if (hash !== undefined && file !== undefined) {
      listed.set(file, hash);
    } else if (line !== '') {
      malformed.push({ path: FROZEN_MANIFEST, problem: `Malformed line: "${line}".` });
    }
  }
  return { listed, malformed };
}

/**
 * Checks the frozen specifications: every `docs/*.md` file is listed in the
 * manifest, and every listed file exists with its recorded SHA-256 hash.
 * `hashes` maps each `docs/*.md` file of the repository to its hash.
 */
export function checkFrozenSpecs(
  manifest: string,
  hashes: ReadonlyMap<string, string>,
): readonly StructureViolation[] {
  const { listed, malformed } = readManifest(manifest);
  const changed = [...listed]
    .filter(([file, hash]) => hashes.get(file) !== hash)
    .map(([file]) => ({
      path: file,
      problem: `This frozen French specification ${hashes.has(file) ? 'has changed' : 'is missing'}. ${FROZEN_HELP}`,
    }));
  const unlisted = [...hashes]
    .filter(([file]) => !listed.has(file))
    .map(([file]) => ({
      path: file,
      problem: `docs/ holds only the frozen French specifications: put English documents in docs/engineering/ or docs/adr/. ${FROZEN_HELP}`,
    }));
  return [...malformed, ...changed, ...unlisted];
}

const LINK_TARGET = /\]\((?<target>[^)\s]+)(?:\s+"[^"]*")?\)|^\[[^\]]+\]:\s*(?<reference>\S+)/gmu;
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|#)/iu;
const FENCED_CODE = /^```[\s\S]+?^```/gmu;
const INLINE_CODE = /`[^`\n]*`/gu;

/** The repository path that a link in `file` points at, or undefined for an external link. */
function linkedPath(file: string, target: string): string | undefined {
  const [pathPart = ''] = target.split(/[#?]/u, 1);
  return pathPart === '' || EXTERNAL.test(target)
    ? undefined
    : path.posix.normalize(path.posix.join(path.posix.dirname(file), pathPart));
}

/** Says whether `resolved` is a file of the repository, or a folder that holds one. */
function isInRepository(resolved: string, files: ReadonlySet<string>): boolean {
  const folder = `${resolved.replace(/\/$/u, '')}/`;
  return files.has(resolved) || [...files].some((candidate) => candidate.startsWith(folder));
}

/** Markdown without its code blocks and code spans, which hold examples, not content. */
const proseOf = (markdown: string): string =>
  markdown.replaceAll(FENCED_CODE, '').replaceAll(INLINE_CODE, '');

/** Lists the relative links of `markdown` (the content of `file`) whose target does not exist. */
export function brokenLinks(
  file: string,
  markdown: string,
  files: ReadonlySet<string>,
): readonly StructureViolation[] {
  return Array.from(
    proseOf(markdown).matchAll(LINK_TARGET),
    (match) => match.groups?.['target'] ?? match.groups?.['reference'] ?? '',
  )
    .filter((target) => {
      const resolved = linkedPath(file, target);
      return resolved !== undefined && !isInRepository(resolved, files);
    })
    .map((target) => ({
      path: file,
      problem: `The link to "${target}" points at nothing in the repository.`,
    }));
}

// Comments that switch a check off in the files ESLint does not read: Prettier
// skips what follows, markdownlint takes rules from them, and shellcheck, which
// actionlint runs on the workflows' scripts, skips the codes they list.
const FILE_PRAGMAS = [
  {
    pattern: /\bprettier-ignore/iu,
    problem: 'A `prettier-ignore` comment switches Prettier off: let Prettier format the content.',
  },
  {
    pattern: /\bmarkdownlint-(?:disable|enable|capture|restore|configure-file)/iu,
    problem:
      'A markdownlint comment switches its rules: follow them, or change .markdownlint-cli2.jsonc in a pull request of its own.',
  },
  {
    pattern: /\bshellcheck\s+disable/iu,
    problem: 'A `shellcheck disable` comment switches shellcheck off: fix what it reports.',
  },
] as const;

type CommentSyntax = Readonly<{ comment: RegExp; content?: (text: string) => string }>;

const HASH_COMMENTS: CommentSyntax = { comment: /(?:^|\s)#.*/gmu };
const C_COMMENTS: CommentSyntax = { comment: /\/\/.*|\/\*[\s\S]*?\*\//gu };
// The comment syntax of each kind of file that ESLint does not lint.
const COMMENT_SYNTAX: ReadonlyMap<string, CommentSyntax> = new Map([
  ['.md', { comment: /<!--[\s\S]*?-->/gu, content: proseOf }],
  ['.yml', HASH_COMMENTS],
  ['.yaml', HASH_COMMENTS],
  ['.sh', HASH_COMMENTS],
  ['.toml', HASH_COMMENTS],
  ['.css', { comment: /\/\*[\s\S]*?\*\//gu }],
  ['.json', C_COMMENTS],
  ['.jsonc', C_COMMENTS],
]);

/** Says whether `file` is of a kind whose comments `pragmaViolations` reads. */
export function hasCommentSyntax(file: string): boolean {
  return COMMENT_SYNTAX.has(path.posix.extname(file));
}

/**
 * Lists the comments of `text` (the content of `file`) that switch a check off,
 * in the kinds of file that ESLint does not lint. Markdown code is left out.
 */
export function pragmaViolations(file: string, text: string): readonly StructureViolation[] {
  const syntax = COMMENT_SYNTAX.get(path.posix.extname(file));
  if (syntax === undefined) {
    return [];
  }
  const comments = Array.from(
    (syntax.content?.(text) ?? text).matchAll(syntax.comment),
    ([comment]) => comment,
  );
  return FILE_PRAGMAS.filter(({ pattern }) =>
    comments.some((comment) => pattern.test(comment)),
  ).map(({ problem }) => ({ path: file, problem }));
}

type Mapping = Readonly<Record<string, unknown>>;

const isMapping = (value: unknown): value is Mapping =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A workflow file read as YAML, or undefined when it is not a YAML mapping. */
function readWorkflow(text: string): Mapping | undefined {
  try {
    const value: unknown = parse(text);
    return isMapping(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The job ids that a `needs` value names: one id, or a list of them. */
function neededJobs(needs: unknown): readonly string[] {
  if (typeof needs === 'string') {
    return [needs];
  }
  if (!Array.isArray(needs)) {
    return [];
  }
  const jobs: readonly unknown[] = needs;
  return jobs.filter((job): job is string => typeof job === 'string');
}

// `if: always()`, with or without the ${{ }} expression syntax.
const ALWAYS = /^\s*(?:\$\{\{\s*)?always\(\)(?:\s*\}\})?\s*$/u;

/**
 * Checks that the `ci-ok` job of `workflow` needs every other job, and runs
 * whatever happened to them: ci-ok is the one job of the CI workflow that `main`
 * requires, so a job outside its `needs` would not gate merges, and a skipped
 * ci-ok counts as passed.
 */
export function unguardedJobs(
  workflowPath: string,
  workflow: string,
): readonly StructureViolation[] {
  const jobs = readWorkflow(workflow)?.['jobs'];
  const ciOk = isMapping(jobs) ? jobs['ci-ok'] : undefined;
  if (!isMapping(jobs) || !isMapping(ciOk)) {
    return [
      {
        path: workflowPath,
        problem: 'The workflow needs a ci-ok job, under `jobs`, in valid YAML.',
      },
    ];
  }
  const needs = neededJobs(ciOk['needs']);
  const condition = ciOk['if'];
  const doesAlwaysRun = typeof condition === 'string' && ALWAYS.test(condition);
  return [
    ...(doesAlwaysRun
      ? []
      : [
          {
            path: workflowPath,
            problem: 'ci-ok must run even when a job it needs fails: give it `if: always()`.',
          },
        ]),
    ...Object.keys(jobs)
      .filter((job) => job !== 'ci-ok' && !needs.includes(job))
      .map((job) => ({
        path: workflowPath,
        problem: `Job "${job}" is missing from the needs of ci-ok, so it would not gate merges.`,
      })),
  ];
}

/**
 * Checks that no trigger of `workflow` is filtered by path: such a workflow would
 * not run, so its final job, a required check, would never report a result.
 */
export function pathFilters(workflowPath: string, workflow: string): readonly StructureViolation[] {
  const triggers = readWorkflow(workflow)?.['on'];
  if (!isMapping(triggers)) {
    return [];
  }
  return Object.entries(triggers)
    .filter(
      ([, settings]) =>
        isMapping(settings) &&
        (Object.hasOwn(settings, 'paths') || Object.hasOwn(settings, 'paths-ignore')),
    )
    .map(([event]) => ({
      path: workflowPath,
      problem: `The ${event} trigger has a path filter: the workflow must always run, so that its final job reports a result (CLAUDE.md).`,
    }));
}
