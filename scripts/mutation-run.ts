/**
 * `bun run test:mutation`: runs Stryker with stryker.config.ts, so that every run
 * tests afresh the mutants of code that runs when its module loads (CLAUDE.md,
 * "Mutation testing"). The script starts `bun scripts/mutation-run.ts` under the
 * shared lock, and the options it is given go on to Stryker.
 *
 * Each run records its results (INCREMENTAL_FILE, or the file that
 * `--incrementalFile` names), and the next one reuses the result of a mutant whose
 * code did not change: a kill while a test that made it still covers the mutant, any
 * other result while no new test covers it. No test covers a static mutant, one in
 * code that runs when its module loads, such as a named constant or a pattern, so
 * Stryker 10.1.1 keeps its kill as long as the tests that made it exist, even once
 * they no longer see the mutant, and never tests a static survivor again while its
 * code stays the same, even once a test pins its value. So this script:
 *
 * 1. takes out of the recorded results every mutant that was static when they were
 *    recorded: Stryker tests it as a new one;
 * 2. runs Stryker;
 * 3. when Stryker reused the result of a mutant that is static now but was not then,
 *    such as one in a function that a module now calls when it loads, takes those
 *    mutants out of the new results and runs Stryker once more: it tests them, and
 *    reuses the rest of the first run's results, since nothing has changed since.
 *
 * Stryker reuses a result as it was recorded, so a static mutant of the new results
 * whose file, mutator, replacement and result (status, its reason and the number of
 * tests completed) match a mutant of the results that Stryker read may hold a
 * reused result. With `--force`, Stryker reuses no result: the script only runs it.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { INCREMENTAL_FILE } from './mutation-scope';
import { catchSignals, runUnlocked } from './signal-relay';

import type { Command, Relay } from './signal-relay';

/** What `bun run test:mutation` runs, before the options it is given. */
export const STRYKER_COMMAND: Command = ['stryker', 'run', 'stryker.config.ts'];

const FILE_OPTION = '--incrementalFile';
const FORCE_OPTION = '--force';
const EXIT_FAILURE = 1;

// The fields of Stryker's results (the mutation testing report schema) that this
// script reads. It keeps every other field as Stryker wrote it.
const MUTANT = z.looseObject({
  mutatorName: z.string(),
  replacement: z.string().optional(),
  status: z.string(),
  statusReason: z.string().optional(),
  testsCompleted: z.number().optional(),
  static: z.boolean().optional(),
});
const FILE_RESULTS = z.looseObject({ mutants: z.array(MUTANT) });
const RESULTS = z.looseObject({ files: z.record(z.string(), FILE_RESULTS) });

/** The results that a run of Stryker records for the next run. */
export type Results = z.infer<typeof RESULTS>;
type Mutant = z.infer<typeof MUTANT>;
/** Results with some mutants taken out, and how many. */
export type Pruned = Readonly<{ results: Results; removed: number }>;
type Recorded =
  Readonly<{ ok: true; results: Results | undefined }> | Readonly<{ ok: false; error: string }>;
/** A run of this script: Stryker's options, the file of its results, and the signals. */
type Run = Readonly<{ args: readonly string[]; file: string; relay: Relay }>;

/**
 * The file that holds the results of earlier runs, as Stryker reads `args`: the last
 * `--incrementalFile`, in either of its forms, or INCREMENTAL_FILE.
 */
export function incrementalFileOf(args: readonly string[]): string {
  let file = INCREMENTAL_FILE;
  for (const [index, arg] of args.entries()) {
    if (arg === FILE_OPTION) {
      file = args[index + 1] ?? file;
    } else if (arg.startsWith(`${FILE_OPTION}=`)) {
      file = arg.slice(FILE_OPTION.length + 1);
    }
  }
  return file;
}

const mutantCount = (results: Results): number =>
  Object.values(results.files).reduce((total, { mutants }) => total + mutants.length, 0);

/** `results` without the mutants that `isRemoved` picks, and with all else they record. */
function prune(results: Results, isRemoved: (file: string, mutant: Mutant) => boolean): Pruned {
  const files = Object.entries(results.files).map(([file, record]): [string, typeof record] => [
    file,
    { ...record, mutants: record.mutants.filter((mutant) => !isRemoved(file, mutant)) },
  ]);
  const pruned: Results = { ...results, files: Object.fromEntries(files) };
  return { results: pruned, removed: mutantCount(results) - mutantCount(pruned) };
}

/** The recorded results without the mutants that were static then, which Stryker tests afresh. */
export function withoutStaticMutants(results: Results): Pruned {
  return prune(results, (_file, mutant) => mutant.static === true);
}

// What Stryker keeps of a mutant when it reuses its result, the file included.
const resultOf = (file: string, mutant: Mutant): string =>
  JSON.stringify([
    file,
    mutant.mutatorName,
    mutant.replacement,
    mutant.status,
    mutant.statusReason,
    mutant.testsCompleted,
  ]);

/**
 * The new `results` without the static mutants whose result Stryker may have reused
 * from `read`, the results it read: those that match a mutant of `read` in file,
 * mutator, replacement and result.
 */
export function withoutReusedStaticMutants(results: Results, read: Results): Pruned {
  const resultsRead = new Set(
    Object.entries(read.files).flatMap(([file, { mutants }]) =>
      mutants.map((mutant) => resultOf(file, mutant)),
    ),
  );
  return prune(
    results,
    (file, mutant) => mutant.static === true && resultsRead.has(resultOf(file, mutant)),
  );
}

const START_AFRESH = 'Delete it, and the next run starts from scratch.';

/** The results recorded in `file`, undefined before a first run, or why they cannot be read. */
function readResults(file: string): Recorded {
  if (!existsSync(file)) {
    return { ok: true, results: undefined };
  }
  let recorded: unknown;
  try {
    recorded = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `${file} cannot be read (${reason}). ${START_AFRESH}` };
  }
  const parsed = RESULTS.safeParse(recorded);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.map(String).join('.')}: ${issue.message}`,
    );
    return {
      ok: false,
      error: `${file} holds no results of Stryker (${issues.join('; ')}). ${START_AFRESH}`,
    };
  }
  return { ok: true, results: parsed.data };
}

const writeResults = (file: string, results: Results): void => {
  writeFileSync(file, JSON.stringify(results));
};

const mutantsNamed = (count: number): string =>
  count === 1 ? '1 mutant' : `${String(count)} mutants`;

/** Runs Stryker with the options of `run`; resolves to its exit code. */
const runStryker = async ({ args, relay }: Run): Promise<number> =>
  runUnlocked([...STRYKER_COMMAND, ...args], relay);

/** Takes the static mutants out of the results in `file`; gives the results that Stryker reads. */
function setStaticMutantsAside(file: string, recorded: Results): Results {
  const read = withoutStaticMutants(recorded);
  if (read.removed > 0) {
    writeResults(file, read.results);
    console.info(
      `Mutation tests: Stryker tests afresh ${mutantsNamed(read.removed)} of code that ran when its module loaded, since no test covers such a mutant.`,
    );
  }
  return read.results;
}

/**
 * After a run of Stryker that read `read` and ended with `status`: runs it once more
 * when it reused the result of a mutant that is static now, and resolves to the exit
 * code that stands.
 */
async function retestReused(run: Run, read: Results, status: number): Promise<number> {
  const recorded = readResults(run.file);
  if (!recorded.ok || recorded.results === undefined) {
    return status;
  }
  const reused = withoutReusedStaticMutants(recorded.results, read);
  if (reused.removed === 0) {
    return status;
  }
  writeResults(run.file, reused.results);
  console.info(
    `Mutation tests: Stryker runs again, to test afresh ${mutantsNamed(reused.removed)} of code that now runs when its module loads, whose earlier result it reused.`,
  );
  return runStryker(run);
}

async function main(args: readonly string[], relay: Relay): Promise<number> {
  const run: Run = { args, file: incrementalFileOf(args), relay };
  // Stryker reuses no result under `--force`.
  if (args.includes(FORCE_OPTION)) {
    return runStryker(run);
  }
  const recorded = readResults(run.file);
  if (!recorded.ok) {
    console.error(`✖ Mutation tests: ${recorded.error}`);
    return EXIT_FAILURE;
  }
  if (recorded.results === undefined) {
    return runStryker(run);
  }
  const read = setStaticMutantsAside(run.file, recorded.results);
  const status = await runStryker(run);
  // A stopped run ends here.
  return relay.stopStatus() === undefined ? retestReused(run, read, status) : status;
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  // Before anything else, so that no process starts before the signals are caught.
  const relay = catchSignals();
  process.exitCode = await main(process.argv.slice(2), relay);
}
