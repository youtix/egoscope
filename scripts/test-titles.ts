/**
 * Finds the IDs that test and suite titles cite in the square brackets they start
 * with, one per pair, for the traceability check (trace-requirements.ts):
 * `it('[STA-11] [H-13] scores 25.9', …)`, `describe('[JOU-04] the list cap', …)`,
 * `it.each(rows)('[STA-11] weighs %s', …)` and Playwright's
 * `test.describe('[IHM-02] …', …)`. The tokens shaped like an ID in the other square
 * brackets of a title cite nothing: they are kept apart as stray, for the rules to
 * report those of a known prefix (trace-rules.ts), such as `[JOU-4]` in
 * `refuses a 31st player [JOU-4]`, while `[SHA-256]` may stay. The rest of a title
 * cites nothing, so that it may name UTF-8 or SHA-256. Titles are read from the syntax
 * tree, so a title quoted inside a string, as the fixtures of a test do, cites nothing.
 *
 * A token shaped like an ID starts and ends where no letter or digit touches it, in
 * titles and in the claims of a pull request alike (idTokens).
 */
import ts from 'typescript';

/** An ID that a test or suite title cites, or a stray token, where, and the title itself. */
export type TitleTag = Readonly<{ id: string; where: string; title: string }>;

/** The bracketed tokens of the titles of a test file: the IDs they cite, and the stray ones. */
type TitleTags = Readonly<{ cited: readonly TitleTag[]; stray: readonly TitleTag[] }>;

type Tokens = Readonly<{ cited: readonly string[]; stray: readonly string[] }>;

// Unit tests, the tests of the scripts, and end-to-end specs.
const TEST_FILE = /^(?:src\/.+\.test\.tsx?|scripts\/.+\.test\.ts|e2e\/.+\.spec\.ts)$/u;
// The functions whose first argument is a test or suite title, as Vitest and
// Playwright name them, with their modifiers (`it.each`, `test.describe.serial`).
const TITLED: ReadonlySet<string> = new Set(['it', 'test', 'describe', 'suite']);
// Members of those functions whose title names no test or suite.
const UNTITLED_MEMBERS: ReadonlySet<string> = new Set([
  'step',
  'beforeAll',
  'beforeEach',
  'afterAll',
  'afterEach',
]);
// The square brackets that a title starts with: `[STA-11] [H-13]` of `[STA-11] [H-13] scores…`.
const LEADING_BRACKETS = /^(?:\s*\[[^[\]]*\])+/u;
// A pair of square brackets and what it holds: `[STA-11]`, `[SHA-256]`, `[brackets]`.
const BRACKETS = /\[(?<inside>[^[\]]*)\]/gu;
// What a pair of leading brackets holds to cite: one ID, or a decision such as `D-07 bis`.
const CITATION = /^[A-Z]+(?:-[A-Z]+)*-\d+(?: bis)?$/u;
// A chain of capitals joined by hyphens, which no letter or digit touches, then the number
// that ends it, if one does: `JOU-04` of `_JOU-04_`, `UTF-8`, but also `A-B`. Each chain is
// read once as a whole, so that a long one without a number takes no quadratic time.
const CHAIN = /(?<![\p{L}\p{N}])[A-Z]+(?:-[A-Z]+)*(?:-\d+(?![\p{L}\p{N}]))?/gu;
// The number that ends a chain shaped like an ID.
const NUMBERED = /-\d+$/u;
// Stands for an interpolation, so that no tag spans one: `[JOU-${n}]` cites nothing.
const INTERPOLATION = '…';

/** Says whether the titles of the tests in `path` count for the traceability check. */
export function isTestFile(path: string): boolean {
  return TEST_FILE.test(path);
}

/** The tokens shaped like an ID in `text`, in order: JOU-04 and UTF-8 of `_JOU-04_ reads UTF-8`. */
export function idTokens(text: string): readonly string[] {
  return (text.match(CHAIN) ?? []).filter((chain) => NUMBERED.test(chain));
}

/** The IDs that the leading brackets of a title cite, and the stray tokens of its other brackets. */
function bracketedTokens(title: string): Tokens {
  const leading = LEADING_BRACKETS.exec(title)?.[0].length ?? 0;
  const pairs = Array.from(title.matchAll(BRACKETS), (pair) => {
    const inside = pair.groups?.['inside'] ?? '';
    return { inside, cites: pair.index < leading && CITATION.test(inside) };
  });
  return {
    cited: pairs.filter((pair) => pair.cites).map((pair) => pair.inside),
    stray: pairs.filter((pair) => !pair.cites).flatMap((pair) => idTokens(pair.inside)),
  };
}

/** The expression that a callee calls through: `it.each` for `it.each(rows)`, `it` for `it.each`. */
function calledThrough(callee: ts.Expression): ts.Expression | undefined {
  if (ts.isPropertyAccessExpression(callee)) {
    return UNTITLED_MEMBERS.has(callee.name.text) ? undefined : callee.expression;
  }
  if (ts.isCallExpression(callee)) {
    return callee.expression;
  }
  return ts.isTaggedTemplateExpression(callee) ? callee.tag : undefined;
}

/** The function that a call names, through its modifiers: `it` for `it.each(rows)('…')`. */
function calledFunction(callee: ts.Expression): string | undefined {
  let node: ts.Expression | undefined = callee;
  while (node !== undefined && !ts.isIdentifier(node)) {
    node = calledThrough(node);
  }
  return node?.text;
}

/** The literal text of a title: a string, or a template with its interpolations marked. */
function literalText(title: ts.Expression | undefined): string | undefined {
  if (title !== undefined && ts.isStringLiteralLike(title)) {
    return title.text;
  }
  return title !== undefined && ts.isTemplateExpression(title)
    ? [title.head.text, ...title.templateSpans.map((span) => span.literal.text)].join(INTERPOLATION)
    : undefined;
}

/** The title of a test or suite that `call` declares, if it declares one. */
function titleOf(call: ts.CallExpression): string | undefined {
  const name = calledFunction(call.expression);
  return name !== undefined && TITLED.has(name) ? literalText(call.arguments[0]) : undefined;
}

/** Every ID that the test and suite titles of a test file cite, and every stray token, in source order. */
export function findTitleTags(path: string, text: string): TitleTags {
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, kind);
  const cited: TitleTag[] = [];
  const stray: TitleTag[] = [];
  const visit = (node: ts.Node): void => {
    const title = ts.isCallExpression(node) ? titleOf(node) : undefined;
    if (title !== undefined) {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      const where = `${path}:${String(line)}`;
      const tokens = bracketedTokens(title);
      cited.push(...tokens.cited.map((id) => ({ id, where, title })));
      stray.push(...tokens.stray.map((id) => ({ id, where, title })));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { cited, stray };
}
