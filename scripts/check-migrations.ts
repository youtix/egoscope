/**
 * The drift check (`bun run db:check`), a job of CI and a step of the gate: the
 * migrations committed in drizzle/ must match the schema, so that generating
 * them again changes nothing, and they must build the schema from an empty
 * database (TRV-76). drizzle-kit generates into a copy, so the check never
 * writes to drizzle/.
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { createTestDatabase } from '@/lib/db';

import config from '../drizzle.config';

const MIGRATIONS = 'drizzle';
// What drizzle-kit says when the schema holds nothing that drizzle/ lacks. Its
// exit code cannot tell: it exits with 0 on some failures.
const NOTHING_TO_MIGRATE = 'No schema changes, nothing to migrate';
// drizzle-kit reads its output folder relative to the working directory.
const SCRATCH = path.join('node_modules', '.cache');

/** Every file under `folder`, by its path relative to `folder`, with its content. */
function filesOf(folder: string): ReadonlyMap<string, string> {
  return new Map(
    readdirSync(folder, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const file = path.join(entry.parentPath, entry.name);
        return [path.relative(folder, file), readFileSync(file, 'utf8')] as const;
      }),
  );
}

/** What is wrong with what generating gave: files it added or changed, or no answer at all. */
function generationProblem(changed: readonly string[], output: string): string | undefined {
  if (changed.length > 0) {
    return `the schema changed without a migration: generating gives ${changed.join(', ')}. Run \`bun run db:generate\` and commit drizzle/.`;
  }
  return output.includes(NOTHING_TO_MIGRATE)
    ? undefined
    : `drizzle-kit could not generate the migrations:\n${output.trim()}`;
}

/** Generates the migrations again into a copy of drizzle/, and says what that reveals. */
function driftProblem(): string | undefined {
  mkdirSync(SCRATCH, { recursive: true });
  const copy = mkdtempSync(path.join(SCRATCH, 'egoscope-drift-'));
  try {
    const out = path.join(copy, MIGRATIONS);
    cpSync(MIGRATIONS, out, { recursive: true });
    const configFile = path.join(copy, 'drizzle.config.json');
    writeFileSync(configFile, JSON.stringify({ ...config, out }));
    const generated = spawnSync('drizzle-kit', ['generate', `--config=${configFile}`], {
      encoding: 'utf8',
    });
    const committed = filesOf(MIGRATIONS);
    const changed = [...filesOf(out)]
      .filter(([file, content]) => committed.get(file) !== content)
      .map(([file]) => path.join(MIGRATIONS, file));
    return generationProblem(changed, `${generated.stdout}${generated.stderr}`);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

/** Applies every migration to an empty database, and says why that failed, if it did. */
async function buildProblem(): Promise<string | undefined> {
  try {
    const database = await createTestDatabase();
    await database.close();
    return undefined;
  } catch (error) {
    const reason = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    return `the migrations do not build the schema from empty: ${String(reason)}`;
  }
}

async function main(): Promise<number> {
  const problem = driftProblem() ?? (await buildProblem());
  if (problem !== undefined) {
    console.error(`✖ db:check: ${problem}`);
    return 1;
  }
  console.info('✔ db:check: the migrations match the schema and build it from an empty database.');
  return 0;
}

process.exitCode = await main();
