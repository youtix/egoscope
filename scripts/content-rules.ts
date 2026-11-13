/**
 * Repository rules that read file contents, checked by `bun run lint:structure`
 * next to the layout rules of structure-rules.ts:
 *
 * - the frozen French specifications match their checksum manifest;
 * - relative Markdown links point at files that exist;
 * - no comment switches a check off in the files that ESLint does not read.
 *
 * The rules of the workflows are in workflow-rules.ts.
 */
import path from 'node:path';

import type { StructureViolation } from './structure-rules';

/** The checksum manifest of the frozen French specifications (`sha256sum` format). */
export const FROZEN_MANIFEST = 'docs/frozen-specs.sha256';

// The French specifications are the Markdown files directly inside docs/.
const FROZEN_SPEC = /^docs\/[^/]+\.md$/u;
const MANIFEST_LINE = /^(?<hash>[0-9a-f]{64}) {2}(?<file>\S+)$/u;
/** What to do about a changed French specification; it tells no way around the rule. */
export const FROZEN_HELP = `The French specifications are frozen: an agent never edits them, so revert the change. Only the coordinator updates ${FROZEN_MANIFEST}, when the owner changes a specification.`;

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
      problem:
        'docs/ holds only the frozen French specifications: put English documents in docs/engineering/ or docs/adr/.',
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

type CommentReader = (text: string) => readonly string[];

const matchesOf =
  (pattern: RegExp): CommentReader =>
  (text) =>
    Array.from(text.matchAll(pattern), ([match]) => match);

/** The index just past the JSON string that opens at `start`, escapes included. */
function endOfString(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length && text[index] !== '"') {
    index += text[index] === '\\' ? 2 : 1;
  }
  return index + 1;
}

/** The comment that opens at `start`, and the index just past it, if one opens there. */
function commentAt(
  text: string,
  start: number,
): Readonly<{ comment: string; end: number }> | undefined {
  const closer = text.startsWith('//', start) ? '\n' : text.startsWith('/*', start) && '*/';
  if (closer === false) {
    return undefined;
  }
  const close = text.indexOf(closer, start + 2);
  const end = close === -1 ? text.length : close + closer.length;
  return { comment: text.slice(start, end), end };
}

/**
 * The comments of a JSON file, read outside its strings: plain JSON holds none,
 * but tsconfig.json and the .jsonc files do, and a string holds links (`//`).
 */
function jsonComments(text: string): readonly string[] {
  const comments: string[] = [];
  for (let index = 0; index < text.length;) {
    const found = text[index] === '"' ? undefined : commentAt(text, index);
    if (found !== undefined) {
      comments.push(found.comment);
    }
    index = text[index] === '"' ? endOfString(text, index) : (found?.end ?? index + 1);
  }
  return comments;
}

const hashComments = matchesOf(/(?:^|\s)#.*/gmu);
// The comment syntax of each kind of file that ESLint does not lint.
const COMMENT_READERS: ReadonlyMap<string, CommentReader> = new Map([
  ['.md', (text: string): readonly string[] => matchesOf(/<!--[\s\S]*?-->/gu)(proseOf(text))],
  ['.yml', hashComments],
  ['.yaml', hashComments],
  ['.sh', hashComments],
  ['.toml', hashComments],
  ['.css', matchesOf(/\/\*[\s\S]*?\*\//gu)],
  ['.json', jsonComments],
  ['.jsonc', jsonComments],
]);

/** Says whether `file` is of a kind whose comments `pragmaViolations` reads. */
export function hasCommentSyntax(file: string): boolean {
  return COMMENT_READERS.has(path.posix.extname(file));
}

/**
 * Lists the comments of `text` (the content of `file`) that switch a check off,
 * in the kinds of file that ESLint does not lint. Markdown code is left out.
 */
export function pragmaViolations(file: string, text: string): readonly StructureViolation[] {
  const comments = COMMENT_READERS.get(path.posix.extname(file))?.(text) ?? [];
  return FILE_PRAGMAS.filter(({ pattern }) =>
    comments.some((comment) => pattern.test(comment)),
  ).map(({ problem }) => ({ path: file, problem }));
}
