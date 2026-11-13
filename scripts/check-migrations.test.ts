import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

const ROOT = path.join(import.meta.dirname, '..');
const SCHEMA = path.join('src', 'lib', 'db', 'schema');
const FIRST_MIGRATION = path.join('drizzle', '0000_installation_and_sequence_counters.sql');

type Outcome = Readonly<{ status: number | null; output: string }>;

/** A copy of the project's schema and migrations, which a test may change. */
function projectCopy(): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'egoscope-drift-check-'));
  cpSync(path.join(ROOT, SCHEMA), path.join(folder, SCHEMA), { recursive: true });
  cpSync(path.join(ROOT, 'drizzle'), path.join(folder, 'drizzle'), { recursive: true });
  symlinkSync(path.join(ROOT, 'node_modules'), path.join(folder, 'node_modules'), 'dir');
  onTestFinished(() => {
    rmSync(folder, { recursive: true, force: true });
  });
  return folder;
}

/** Rewrites the file at `file` with `change`. */
function edit(file: string, change: (content: string) => string): void {
  writeFileSync(file, change(readFileSync(file, 'utf8')));
}

/** Runs the drift check as `bun run db:check` does, in the project at `folder`. */
function check(folder: string): Outcome {
  const result = spawnSync(
    'bun',
    [
      '--no-env-file',
      '--conditions=react-server',
      path.join(ROOT, 'scripts', 'check-migrations.ts'),
    ],
    {
      cwd: folder,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: [path.join(ROOT, 'node_modules', '.bin'), process.env['PATH']].join(path.delimiter),
      },
    },
  );
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe('the drift check', { timeout: 120_000 }, () => {
  it('[TRV-76] passes when the migrations match the schema and build it from empty', () => {
    const { status, output } = check(projectCopy());

    expect(status).toBe(0);
    expect(output).toContain(
      '✔ db:check: the migrations match the schema and build it from an empty database.',
    );
  });

  it('[TRV-76] fails when the schema changes without a migration, and leaves drizzle/ as it was', () => {
    const folder = projectCopy();
    edit(path.join(folder, SCHEMA, 'db.ts'), (schema) =>
      schema.replace(
        "lastValue: integer('last_value').notNull().default(0),",
        "lastValue: integer('last_value').notNull().default(0),\n    note: text('note'),",
      ),
    );
    const committed = readFileSync(path.join(folder, 'drizzle', 'meta', '_journal.json'), 'utf8');

    const { status, output } = check(folder);

    expect(status).toBe(1);
    expect(output).toContain('✖ db:check: the schema changed without a migration');
    expect(output).toContain('drizzle/meta/_journal.json');
    expect(readFileSync(path.join(folder, 'drizzle', 'meta', '_journal.json'), 'utf8')).toBe(
      committed,
    );
  });

  it('[TRV-76] fails when the migrations do not build the schema from an empty database', () => {
    const folder = projectCopy();
    edit(path.join(folder, FIRST_MIGRATION), (migration) =>
      migration.replace('"id" smallint', '"id" smallnumber'),
    );

    const { status, output } = check(folder);

    expect(status).toBe(1);
    expect(output).toContain(
      '✖ db:check: the migrations do not build the schema from empty: error: type "smallnumber" does not exist',
    );
  });
});
