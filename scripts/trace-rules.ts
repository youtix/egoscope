/**
 * The rules of the traceability check (trace-requirements.ts), given the IDs that the
 * specs define (spec-ids.ts), the IDs that test titles cite (test-titles.ts) and the
 * waiver register (waiver-register.ts):
 *
 * - Always: every ID that a title cites is defined by the specs; the register names
 *   only requirements and acceptance criteria, and never waives an ID that a test
 *   names.
 * - For each required ID (those of --require, or all of them with --strict): it is
 *   tested or waived, and a limit has its tests. Hypotheses, questions, decisions and
 *   rulings are never required.
 *
 * An ID is covered when a test names it, a limit beside it included; waived when the
 * register waives it; open otherwise.
 */
import type { DefinedId, Problem, SpecIds } from './spec-ids';
import type { TitleTag } from './test-titles';
import type { RegisterEntry } from './waiver-register';

type Status = 'covered' | 'waived' | 'open';

/** A requirement or acceptance criterion, with the tests that name it and its entry. */
export type TracedId = DefinedId &
  Readonly<{
    criterion: boolean;
    status: Status;
    tests: readonly TitleTag[];
    entry: RegisterEntry | undefined;
  }>;

type TraceInputs = Readonly<{
  specs: SpecIds;
  tags: readonly TitleTag[];
  entries: readonly RegisterEntry[];
}>;

/** What the run requires: every ID with `strict`, and the `required` ones. */
export type Requirements = Readonly<{ strict: boolean; required: readonly string[] }>;

export type Trace = Readonly<{ ids: readonly TracedId[]; problems: readonly Problem[] }>;

function statusOf(tests: readonly TitleTag[], entry: RegisterEntry | undefined): Status {
  if (tests.length > 0) {
    return 'covered';
  }
  return entry?.kind === 'waiver' ? 'waived' : 'open';
}

/** Every requirement and criterion of the specs, with its tests, entry and status. */
function traceEach(inputs: TraceInputs): readonly TracedId[] {
  const tests = Map.groupBy(inputs.tags, (tag) => tag.id);
  // The first entry of an ID counts; a second one is a problem of the register.
  const entries = new Map(inputs.entries.toReversed().map((entry) => [entry.id, entry]));
  const defined = [
    ...inputs.specs.requirements.map((id) => ({ ...id, criterion: false })),
    ...inputs.specs.criteria.map((id) => ({ ...id, criterion: true })),
  ];
  return defined.map(({ id, file, where, criterion }) => {
    const named = tests.get(id) ?? [];
    const entry = entries.get(id);
    return { id, file, where, criterion, tests: named, entry, status: statusOf(named, entry) };
  });
}

function unknownTags(inputs: TraceInputs, ids: ReadonlyMap<string, TracedId>): Problem[] {
  return inputs.tags
    .filter((tag) => !ids.has(tag.id) && !inputs.specs.citable.has(tag.id))
    .map((tag) => ({
      where: tag.where,
      problem: `[${tag.id}] is not an ID that the specs define: check it against the spec, or against docs/engineering/acceptance-criteria-index.md for a criterion.`,
    }));
}

function entryProblem(entry: RegisterEntry, traced: TracedId | undefined): string | undefined {
  if (traced === undefined) {
    return `${entry.id} is not a requirement or an acceptance criterion of the specs: the register lists only those.`;
  }
  const [test] = traced.tests;
  return test !== undefined && entry.kind === 'waiver'
    ? `${entry.id} has a waiver and a test (${test.where}): a waived ID has no test, so drop the waiver, or make it a limit.`
    : undefined;
}

function registerProblems(
  entries: readonly RegisterEntry[],
  ids: ReadonlyMap<string, TracedId>,
): Problem[] {
  return entries.flatMap((entry) => {
    const problem = entryProblem(entry, ids.get(entry.id));
    return problem === undefined ? [] : { where: entry.where, problem };
  });
}

function requiredProblem(id: string, traced: TracedId | undefined): Problem | undefined {
  if (traced === undefined) {
    return {
      where: 'Required IDs',
      problem: `${id} is required, but the specs define no such ID.`,
    };
  }
  if (traced.status !== 'open') {
    return undefined;
  }
  return {
    where: traced.where,
    problem:
      traced.entry?.kind === 'limit'
        ? `${id} is required and has a limit, but no test: a limit keeps the tests of the application's part.`
        : `${id} is required, but no test names it and the register does not waive it.`,
  };
}

function requiredProblems(
  requirements: Requirements,
  ids: ReadonlyMap<string, TracedId>,
  citable: ReadonlySet<string>,
): Problem[] {
  const required = new Set([...(requirements.strict ? ids.keys() : []), ...requirements.required]);
  return [...required]
    .filter((id) => !citable.has(id))
    .flatMap((id) => requiredProblem(id, ids.get(id)) ?? []);
}

/** Traces every requirement and criterion, and lists the rules that the inputs break. */
export function traceIds(inputs: TraceInputs, requirements: Requirements): Trace {
  const all = traceEach(inputs);
  const ids = new Map(all.map((each) => [each.id, each]));
  return {
    ids: all,
    problems: [
      ...unknownTags(inputs, ids),
      ...registerProblems(inputs.entries, ids),
      ...requiredProblems(requirements, ids, inputs.specs.citable),
    ],
  };
}
