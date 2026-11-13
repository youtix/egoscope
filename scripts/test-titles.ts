/**
 * Finds the IDs that test and suite titles cite in square brackets, for the
 * traceability check (trace-requirements.ts): `it('[STA-11] [H-13] scores 25.9', …)`,
 * `describe('[JOU-04] the list cap', …)`, `it.each(rows)('[STA-11] weighs %s', …)` and
 * Playwright's `test.describe('[IHM-02] …', …)`. Titles are read from the syntax tree,
 * so a title quoted inside a string, as the fixtures of a test do, cites nothing.
 */
import ts from 'typescript';

/** An ID that a test or suite title cites, where, and the title itself. */
export type TitleTag = Readonly<{ id: string; where: string; title: string }>;

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
const TAG = /\[(?<id>[A-Z]+(?:-[A-Z]+)*-\d+(?: bis)?)\]/gu;
// Stands for an interpolation, so that no tag spans one: `[JOU-${n}]` cites nothing.
const INTERPOLATION = '…';

/** Says whether the titles of the tests in `path` count for the traceability check. */
export function isTestFile(path: string): boolean {
  return TEST_FILE.test(path);
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

/** Every ID that the test and suite titles of a test file cite, in source order. */
export function findTitleTags(path: string, text: string): readonly TitleTag[] {
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, kind);
  const tags: TitleTag[] = [];
  const visit = (node: ts.Node): void => {
    const title = ts.isCallExpression(node) ? titleOf(node) : undefined;
    if (title !== undefined) {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      for (const match of title.matchAll(TAG)) {
        tags.push({ id: match.groups?.['id'] ?? '', where: `${path}:${String(line)}`, title });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return tags;
}
