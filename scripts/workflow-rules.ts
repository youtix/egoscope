/**
 * The rules of the GitHub Actions workflows, read as YAML by the structure check:
 *
 * - A workflow that is a check ends in one final job, which branch protection
 *   requires by name: `ci-ok` in ci.yml, and the job named after the file
 *   elsewhere (`e2e` in e2e.yml).
 * - That job runs whatever happened to the others (`if: always()`), needs every
 *   other job of its file, and judges them with scripts/ci-ok.sh, which fails it
 *   when one of them failed or was skipped unexpectedly. The step that judges has
 *   no `if:`, which could skip it and let the job pass unjudged.
 * - The job's `name:`, if it sets one, is its id: the check reports under that
 *   name, which branch protection requires.
 * - No trigger of such a workflow is filtered by path, so its final job always
 *   reports a result.
 * - Only the workflows of TEXT_READING_WORKFLOWS list `edited` among the types of
 *   their `pull_request` or `pull_request_target` trigger.
 * - No job or step of any workflow continues on error.
 *
 * A workflow that is not a check needs an entry in NON_CHECK_WORKFLOWS.
 */
import path from 'node:path';

import { parse } from 'yaml';

import type { StructureViolation } from './structure-rules';

/**
 * The workflows that are not checks, so have no final job to require: remote-test.yml runs
 * only when someone dispatches it (`bun run test:remote`), and no pull request waits for it.
 */
const NON_CHECK_WORKFLOWS: readonly string[] = ['.github/workflows/remote-test.yml'];

/**
 * The check workflows that read the pull request's own text, its description and its
 * title, so the only ones that run again on `edited`. An edit of either changes no
 * file, so any other check workflow would repeat its whole run for nothing: the job
 * that reads the title or the description belongs to trace.yml instead.
 */
const TEXT_READING_WORKFLOWS: ReadonlySet<string> = new Set(['.github/workflows/trace.yml']);

const EDITED = 'edited';

/** The triggers of a pull request's events, whose `types` may list `edited`. */
const PULL_REQUEST_TRIGGERS = ['pull_request', 'pull_request_target'] as const;

type Mapping = Readonly<Record<string, unknown>>;

const isMapping = (value: unknown): value is Mapping =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const listOf = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

// `if: always()`, with or without the ${{ }} expression syntax.
const ALWAYS = /^\s*(?:\$\{\{\s*)?always\(\)(?:\s*\}\})?\s*$/u;
const VERDICT = 'sh scripts/ci-ok.sh';
const NEEDS_AS_JSON = /^\$\{\{\s*toJSON\(needs\)\s*\}\}$/u;
const EVENT_NAME = /^\$\{\{\s*github\.event_name\s*\}\}$/u;
const WORKFLOW_FILE = /\.ya?ml$/u;

/** A workflow file read as YAML, or undefined when it is not a YAML mapping. */
function readWorkflow(text: string): Mapping | undefined {
  try {
    const value: unknown = parse(text);
    return isMapping(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The names that a `needs` or a `types` value lists: one name, or a list of them. */
function namesOf(value: unknown): readonly string[] {
  return typeof value === 'string'
    ? [value]
    : listOf(value).filter((name): name is string => typeof name === 'string');
}

/** The final job of the check workflow at `workflowPath`: `ci-ok`, or the file's name. */
export function finalJobOf(workflowPath: string): string {
  const name = path.posix.basename(workflowPath).replace(WORKFLOW_FILE, '');
  return name === 'ci' ? 'ci-ok' : name;
}

/** Says whether `step` judges the needed jobs with scripts/ci-ok.sh, given what it needs. */
function isVerdict(step: unknown): boolean {
  const env = isMapping(step) ? step['env'] : undefined;
  return (
    isMapping(step) &&
    step['run'] === VERDICT &&
    isMapping(env) &&
    typeof env['NEEDS'] === 'string' &&
    NEEDS_AS_JSON.test(env['NEEDS']) &&
    typeof env['EVENT'] === 'string' &&
    EVENT_NAME.test(env['EVENT'])
  );
}

/** The problems of the steps of the final job `id`: one of them judges, and nothing skips it. */
function verdictViolations(id: string, steps: readonly unknown[]): readonly string[] {
  const verdicts = steps.filter((step) => isVerdict(step));
  if (verdicts.length === 0) {
    return [
      `${id} must judge the jobs it needs with \`sh scripts/ci-ok.sh\`, given NEEDS and EVENT as in ci.yml: it fails when one of them failed or was skipped.`,
    ];
  }
  return verdicts.some((step) => isMapping(step) && Object.hasOwn(step, 'if'))
    ? [
        `The verdict step of ${id} has an \`if:\`, which could skip it and let ${id} pass without judging the jobs it needs: remove it.`,
      ]
    : [];
}

function finalJobViolations(workflowPath: string, jobs: Mapping): readonly string[] {
  const id = finalJobOf(workflowPath);
  const final = jobs[id];
  if (!isMapping(final)) {
    return [
      `The workflow needs a final job named ${id}, which branch protection requires by name (CLAUDE.md).`,
    ];
  }
  const needs = namesOf(final['needs']);
  const condition = final['if'];
  return [
    ...(typeof condition === 'string' && ALWAYS.test(condition)
      ? []
      : [`${id} must run even when a job it needs fails: give it \`if: always()\`.`]),
    ...(Object.hasOwn(final, 'name') && final['name'] !== id
      ? [
          `The name of ${id} must be its id: the check reports under the job's name, and branch protection requires ${id}.`,
        ]
      : []),
    ...verdictViolations(id, listOf(final['steps'])),
    ...Object.keys(jobs)
      .filter((job) => job !== id && !needs.includes(job))
      .map(
        (job) => `Job "${job}" is missing from the needs of ${id}, so it would not gate merges.`,
      ),
  ];
}

function pathFilterViolations(triggers: unknown): readonly string[] {
  return Object.entries(isMapping(triggers) ? triggers : {})
    .filter(
      ([, settings]) =>
        isMapping(settings) &&
        (Object.hasOwn(settings, 'paths') || Object.hasOwn(settings, 'paths-ignore')),
    )
    .map(
      ([event]) =>
        `The ${event} trigger has a path filter: the workflow must always run, so that its final job reports a result (CLAUDE.md).`,
    );
}

function editedViolations(workflowPath: string, triggers: unknown): readonly string[] {
  if (TEXT_READING_WORKFLOWS.has(workflowPath)) {
    return [];
  }
  const file = path.posix.basename(workflowPath);
  return PULL_REQUEST_TRIGGERS.filter((trigger) => {
    const settings = isMapping(triggers) ? triggers[trigger] : undefined;
    return namesOf(isMapping(settings) ? settings['types'] : undefined).includes(EDITED);
  }).map(
    (trigger) =>
      `${file} lists \`edited\` among its ${trigger} types, so an edit of the title or of the description, which changes no file, runs it again: remove \`edited\`, and move the job that reads the title or the description to trace.yml.`,
  );
}

const isContinuingOnError = (value: unknown): boolean =>
  isMapping(value) &&
  Object.hasOwn(value, 'continue-on-error') &&
  value['continue-on-error'] !== false;

function continueOnErrorViolations(jobs: Mapping): readonly string[] {
  return Object.entries(jobs)
    .flatMap(([id, job]) => [
      ...(isContinuingOnError(job) ? [`job "${id}"`] : []),
      ...listOf(isMapping(job) ? job['steps'] : undefined)
        .map((step, index) => (isContinuingOnError(step) ? index + 1 : 0))
        .filter((number) => number > 0)
        .map((number) => `step ${String(number)} of job "${id}"`),
    ])
    .map((where) => `continue-on-error on ${where} lets a failure pass: remove it.`);
}

/**
 * Checks the workflow at `workflowPath` against the rules above. A workflow listed
 * in `nonChecks` keeps only the continue-on-error rule.
 */
export function workflowViolations(
  workflowPath: string,
  text: string,
  nonChecks: readonly string[] = NON_CHECK_WORKFLOWS,
): readonly StructureViolation[] {
  const workflow = readWorkflow(text);
  const jobs = workflow?.['jobs'];
  if (!isMapping(jobs)) {
    return [{ path: workflowPath, problem: 'The workflow needs jobs, in valid YAML.' }];
  }
  const isCheck = !nonChecks.includes(workflowPath);
  return [
    ...(isCheck ? finalJobViolations(workflowPath, jobs) : []),
    ...(isCheck ? pathFilterViolations(workflow?.['on']) : []),
    ...(isCheck ? editedViolations(workflowPath, workflow?.['on']) : []),
    ...continueOnErrorViolations(jobs),
  ].map((problem) => ({ path: workflowPath, problem }));
}
