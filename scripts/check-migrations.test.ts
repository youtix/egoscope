import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

const ROOT = path.join(import.meta.dirname, '..');
const SCHEMA = path.join('src', 'lib', 'db', 'schema');
const FIRST_MIGRATION = path.join('drizzle', '0000_installation_and_sequence_counters.sql');
const JOURNAL = path.join('drizzle', 'meta', '_journal.json');

type Outcome = Readonly<{ status: number | null; output: string }>;
type JournalEntry = Readonly<{ idx: number; when: number; tag: string }>;

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

/** Writes the journal of the project at `folder` with `entries`, laid out as drizzle-kit writes it. */
function writeJournal(folder: string, entries: readonly JournalEntry[]): void {
  const journal = {
    version: '7',
    dialect: 'postgresql',
    entries: entries.map((entry) => ({ ...entry, version: '7', breakpoints: true })),
  };
  writeFileSync(path.join(folder, JOURNAL), JSON.stringify(journal, null, 2));
}

/** Runs the drift check as `bun run db:check` does, in the project at `folder`. */
function check(folder: string): Outcome {
  const result = spawnSync(
    'bun',
    ['--no-env-file', path.join(ROOT, 'scripts', 'check-migrations.ts')],
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

  it.each([
    {
      order:
        "a later idx with an earlier when, as a rebase leaves a migration generated before main's",
      entries: [
        { idx: 0, when: 100, tag: '0000_first' },
        { idx: 1, when: 300, tag: '0001_from_main' },
        { idx: 2, when: 200, tag: '0002_from_the_branch' },
      ],
      problem:
        '0002_from_the_branch (idx 2, when 200) does not come after 0001_from_main (idx 1, when 300)',
    },
    {
      order: 'two entries of one idx, as a journal merged by hand keeps them',
      entries: [
        { idx: 0, when: 100, tag: '0000_first' },
        { idx: 1, when: 200, tag: '0001_from_main' },
        { idx: 1, when: 300, tag: '0001_from_the_branch' },
      ],
      problem:
        '0001_from_the_branch (idx 1, when 300) does not come after 0001_from_main (idx 1, when 200)',
    },
  ])('[TRV-76] fails on a journal out of order: $order', ({ entries, problem }) => {
    const folder = projectCopy();
    writeJournal(folder, entries);

    const { status, output } = check(folder);

    expect(status).toBe(1);
    expect(output).toContain(
      `✖ db:check: the journal is out of order: ${problem}, and Drizzle's migrator would skip it without a word.`,
    );
  });

  it('[TRV-76] fails on a journal left with the markers of a conflict, and says how to resolve it', () => {
    const folder = projectCopy();
    edit(
      path.join(folder, JOURNAL),
      (journal) => `<<<<<<< HEAD\n${journal}\n=======\n${journal}\n>>>>>>> feat/branch\n`,
    );

    const { status, output } = check(folder);

    expect(status).toBe(1);
    expect(output).toContain(
      '✖ db:check: drizzle/meta/_journal.json is not a journal that drizzle-kit wrote. Keep drizzle/meta/_journal.json as origin/main has it, delete your own migration and its snapshot, then run `bun run db:generate` again: never edit drizzle/meta by hand.',
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

  it('[TRV-76] fails when a migration was edited by hand, though its snapshot still matches the schema', () => {
    const folder = projectCopy();
    edit(path.join(folder, FIRST_MIGRATION), (migration) => migration.replace('>= 0', '>= -100'));

    const { status, output } = check(folder);

    expect(status).toBe(1);
    expect(output).toContain(
      [
        '✖ db:check: the migrations build a database that differs from the schema, as when a migration is edited by hand (- built by drizzle/, + built from the schema alone):',
        "  - constraint sequence_counters sequence_counters_last_value_check CHECK ((last_value >= '-100'::integer))",
        '  + constraint sequence_counters sequence_counters_last_value_check CHECK ((last_value >= 0))',
        'Put back each migration as drizzle-kit wrote it: to change the structure, change the schema and run `bun run db:generate`.',
      ].join('\n'),
    );
  });
});
