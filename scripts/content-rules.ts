/**
 * Repository rules that read file contents, checked by `bun run lint:structure`
 * next to the layout rules of structure-rules.ts:
 *
 * - the frozen French specifications match their checksum manifest;
 * - relative Markdown links point at files that exist;
 * - ci-ok depends on every other job of the CI workflow.
 */
import path from 'node:path';

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

/** Lists the relative links of `markdown` (the content of `file`) whose target does not exist. */
export function brokenLinks(
  file: string,
  markdown: string,
  files: ReadonlySet<string>,
): readonly StructureViolation[] {
  const prose = markdown.replaceAll(FENCED_CODE, '').replaceAll(INLINE_CODE, '');
  return Array.from(
    prose.matchAll(LINK_TARGET),
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

// A minimal reader of the workflow layout that Prettier keeps stable: under `jobs:`,
// each job is a key indented by two spaces, and its own lines are indented deeper.
const JOB_KEY = /^ {2}(?<id>[a-z0-9-]+):[ \t]*$/u;
const NEEDS_LIST = /^ {4}needs:[ \t]*\[(?<list>[^\]]*)\]/u;
const TOP_LEVEL = /^\S/u;

type JobsAndNeeds = Readonly<{ jobs: readonly string[]; needs: readonly string[] | undefined }>;

/** The lines of the `jobs:` section of a workflow. */
function jobsSection(workflow: string): readonly string[] {
  const lines = workflow.split('\n');
  const start = lines.indexOf('jobs:');
  const after = start === -1 ? [] : lines.slice(start + 1);
  const end = after.findIndex((line) => TOP_LEVEL.test(line));
  return end === -1 ? after : after.slice(0, end);
}

/** The ids of the jobs in the `jobs:` section of a workflow, and the `needs` of ci-ok. */
function jobsAndNeeds(workflow: string): JobsAndNeeds {
  const section = jobsSection(workflow);
  const jobs: string[] = [];
  let needs: string[] | undefined;
  for (const line of section) {
    const id = JOB_KEY.exec(line)?.groups?.['id'];
    if (id !== undefined) {
      jobs.push(id);
    }
    const list = jobs.at(-1) === 'ci-ok' ? NEEDS_LIST.exec(line)?.groups?.['list'] : undefined;
    if (list !== undefined) {
      needs = list
        .split(',')
        .map((job) => job.trim())
        .filter((job) => job !== '');
    }
  }
  return { jobs, needs };
}

/**
 * Checks that the `ci-ok` job of `workflow` needs every other job: ci-ok is the one
 * job of the CI workflow that `main` requires, so a job outside its `needs` would
 * not gate merges.
 */
export function unguardedJobs(
  workflowPath: string,
  workflow: string,
): readonly StructureViolation[] {
  const { jobs, needs } = jobsAndNeeds(workflow);
  if (needs === undefined) {
    return [
      { path: workflowPath, problem: 'The workflow needs a ci-ok job with a `needs: [...]` list.' },
    ];
  }
  return jobs
    .filter((job) => job !== 'ci-ok' && !needs.includes(job))
    .map((job) => ({
      path: workflowPath,
      problem: `Job "${job}" is missing from the needs of ci-ok, so it would not gate merges.`,
    }));
}
