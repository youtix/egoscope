/**
 * The drift check (`bun run db:check`), a job of CI and a step of the gate
 * (TRV-76). The migrations committed in drizzle/ must match the schema, so that
 * generating them again changes nothing; they must build the schema from an
 * empty database; and the database they build must be the one that the schema
 * alone builds, through the SQL that drizzle-kit generates from scratch, so that
 * a migration edited by hand fails even while its snapshot still matches the
 * schema. drizzle-kit generates into scratch folders, so the check never writes
 * to drizzle/.
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

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import config from '../drizzle.config';

type Catalog =
  Readonly<{ ok: true; lines: readonly string[] }> | Readonly<{ ok: false; reason: string }>;

const MIGRATIONS = 'drizzle';
// What drizzle-kit says when the schema holds nothing that drizzle/ lacks. Its
// exit code cannot tell: it exits with 0 on some failures.
const NOTHING_TO_MIGRATE = 'No schema changes, nothing to migrate';
// drizzle-kit reads its output folder relative to the working directory.
const SCRATCH = path.join('node_modules', '.cache');

// What a database holds, one line per table, column, constraint, index, sequence
// and view, outside the catalogs and Drizzle's record of the migrations it ran.
// Columns go by name, not position: a column that a later migration adds comes
// last, wherever the schema declares it. Postgres names the primary keys, the
// not-null constraints and the sequences of identity columns itself, and keeps
// those names when a migration renames a table or a column: they are left out,
// and the column lines say what such constraints and sequences do.
const CATALOG = String.raw`
  with namespaces as (
    select oid from pg_namespace
    where nspname not in ('pg_catalog', 'information_schema', 'drizzle')
      and nspname not like 'pg\_toast%' and nspname not like 'pg\_temp%'
  ),
  tables as (
    select oid from pg_class
    where relnamespace in (select oid from namespaces) and relkind in ('r', 'p')
  )
  select line from (
    select format('table %s', oid::regclass) as line
    from tables
    union all
    select format(
      'column %s.%I %s%s%s%s',
      a.attrelid::regclass,
      a.attname,
      format_type(a.atttypid, a.atttypmod),
      case when a.attnotnull then ' not null' end,
      case when a.attgenerated = '' then ' default ' else ' generated as ' end
        || pg_get_expr(d.adbin, d.adrelid),
      case a.attidentity when 'a' then ' always' when 'd' then ' by default' end
        || ' as identity '
        || concat_ws(' ', s.seqstart, s.seqincrement, s.seqmin, s.seqmax, s.seqcache, s.seqcycle)
    )
    from pg_attribute a
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    left join pg_sequence s
      on s.seqrelid = pg_get_serial_sequence(a.attrelid::regclass::text, a.attname)::regclass
    where a.attrelid in (select oid from tables) and a.attnum > 0 and not a.attisdropped
    union all
    select format(
      'constraint %s %s%s',
      conrelid::regclass,
      case when contype = 'p' then '' else quote_ident(conname) || ' ' end,
      pg_get_constraintdef(oid)
    )
    from pg_constraint
    where conrelid in (select oid from tables) and contype <> 'n'
    union all
    select format('index %s', pg_get_indexdef(indexrelid))
    from pg_index
    where indrelid in (select oid from tables) and not indisprimary
    union all
    select format(
      'sequence %s %s',
      s.seqrelid::regclass,
      concat_ws(' ', format_type(s.seqtypid, null), s.seqstart, s.seqincrement, s.seqmin, s.seqmax, s.seqcache, s.seqcycle)
    )
    from pg_sequence s
    join pg_class c on c.oid = s.seqrelid
    where c.relnamespace in (select oid from namespaces)
      and not exists (select from pg_depend where objid = s.seqrelid and deptype = 'i')
    union all
    select format('view %s %s', oid::regclass, pg_get_viewdef(oid))
    from pg_class
    where relnamespace in (select oid from namespaces) and relkind in ('v', 'm')
  ) as catalog
  order by line collate "C"
`;

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

/** A new scratch folder, which `work` may fill and which is removed afterwards. */
async function inScratchFolder<T>(work: (folder: string) => Promise<T> | T): Promise<T> {
  mkdirSync(SCRATCH, { recursive: true });
  const folder = mkdtempSync(path.join(SCRATCH, 'egoscope-db-check-'));
  try {
    return await work(folder);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/** Generates the migrations of the schema into `out`, and gives what drizzle-kit printed. */
function generate(folder: string, out: string): string {
  const configFile = path.join(folder, 'drizzle.config.json');
  writeFileSync(configFile, JSON.stringify({ ...config, out }));
  const generated = spawnSync('drizzle-kit', ['generate', `--config=${configFile}`], {
    encoding: 'utf8',
  });
  return `${generated.stdout}${generated.stderr}`;
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
async function driftProblem(): Promise<string | undefined> {
  return inScratchFolder((folder) => {
    const out = path.join(folder, MIGRATIONS);
    cpSync(MIGRATIONS, out, { recursive: true });
    const output = generate(folder, out);
    const committed = filesOf(MIGRATIONS);
    const changed = [...filesOf(out)]
      .filter(([file, content]) => committed.get(file) !== content)
      .map(([file]) => path.join(MIGRATIONS, file));
    return generationProblem(changed, output);
  });
}

// Drizzle wraps the error of a failed query with the query; the reason is the
// error it wraps.
const reasonOf = (error: unknown): string =>
  String(error instanceof Error && error.cause instanceof Error ? error.cause : error);

/** Applies the migrations of `folder` to an empty database, and gives what it then holds. */
async function catalogBuiltBy(folder: string): Promise<Catalog> {
  const pglite = new PGlite();
  try {
    await migrate(drizzle({ client: pglite }), { migrationsFolder: folder });
    const { rows } = await pglite.query<{ line: string }>(CATALOG);
    return { ok: true, lines: rows.map((row) => row.line) };
  } catch (error) {
    return { ok: false, reason: reasonOf(error) };
  } finally {
    await pglite.close();
  }
}

/** The lines of `lines` that `other` lacks, each marked with `sign`. */
const missingFrom = (lines: readonly string[], other: readonly string[], sign: string): string[] =>
  lines.filter((line) => !other.includes(line)).map((line) => `  ${sign} ${line}`);

/** How the database that drizzle/ builds differs from the one that the schema alone builds. */
function differenceProblem(
  built: readonly string[],
  described: readonly string[],
): string | undefined {
  const differences = [
    ...missingFrom(built, described, '-'),
    ...missingFrom(described, built, '+'),
  ];
  if (differences.length === 0) {
    return undefined;
  }
  return [
    'the migrations build a database that differs from the schema, as when a migration is edited by hand (- built by drizzle/, + built from the schema alone):',
    ...differences,
    'Put back each migration as drizzle-kit wrote it: to change the structure, change the schema and run `bun run db:generate`.',
  ].join('\n');
}

/**
 * Builds a database from the migrations of drizzle/, then one from the SQL that
 * drizzle-kit generates for the schema alone, and says why the first build
 * failed or how the two differ.
 */
async function buildProblem(): Promise<string | undefined> {
  const built = await catalogBuiltBy(MIGRATIONS);
  if (!built.ok) {
    return `the migrations do not build the schema from empty: ${built.reason}`;
  }
  return inScratchFolder(async (folder) => {
    const out = path.join(folder, MIGRATIONS);
    const output = generate(folder, out);
    const described = await catalogBuiltBy(out);
    return described.ok
      ? differenceProblem(built.lines, described.lines)
      : `drizzle-kit could not generate the schema from scratch: ${described.reason}\n${output.trim()}`;
  });
}

async function main(): Promise<number> {
  const problem = (await driftProblem()) ?? (await buildProblem());
  if (problem !== undefined) {
    console.error(`✖ db:check: ${problem}`);
    return 1;
  }
  console.info('✔ db:check: the migrations match the schema and build it from an empty database.');
  return 0;
}

process.exitCode = await main();
