import { createHash } from 'node:crypto';

import { eq, is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import { z } from 'zod';

import * as database from '@/lib/db';
import {
  accounts,
  createTestDatabase,
  drafts,
  isOutsideArchive,
  teams,
  withdrawalFingerprints,
  withdrawnEventCounter,
} from '@/lib/db';
import { DATABASE_TEST_TIMEOUT_MS, profiledPlayer } from '@/lib/testing';
import { toEpochMs } from '@/lib/time';

import { archiveEntries } from './archive';

import type { Database } from '@/lib/db';

const EXPORTED_AT = toEpochMs(Date.UTC(2026, 10, 25, 9, 30, 12, 345));
// A withdrawal fingerprint: 32 bytes, as the ledger stores them.
const FINGERPRINT_BYTES = 32;
const FINGERPRINT = new Uint8Array(FINGERPRINT_BYTES).fill(7);
// The tables that operations.md §5.1 keeps out of every archive.
const EXCLUDED = new Set([
  'accounts',
  'sessions',
  'login_failures',
  'drafts',
  'withdrawal_fingerprints',
  'deleted_player_entries',
  'withdrawn_event_counter',
]);

// The manifest, its keys read in camel case (`camelCased`).
const columnSchema = z.object({
  name: z.string(),
  type: z.string(),
  nullable: z.boolean(),
  references: z.string().nullable(),
});
const tableSchema = z.object({
  name: z.string(),
  file: z.string(),
  rows: z.number(),
  sha256: z.string(),
  columns: z.array(columnSchema),
  secondPassColumns: z.array(z.string()),
});
const manifestSchema = z.object({
  format: z.string(),
  formatVersion: z.string(),
  exportedAt: z.string(),
  withdrawnEventCount: z.number(),
  tables: z.array(tableSchema),
  identitySequences: z.record(z.string(), z.number()),
});

type Manifest = z.infer<typeof manifestSchema>;

/** `value` with every key, at any depth, turned from snake case to camel case. */
function camelCased(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => camelCased(item));
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key.replaceAll(/_(?<letter>[a-z])/gu, (_match, letter: string) => letter.toUpperCase()),
      camelCased(item),
    ]),
  );
}

function byName(left: string, right: string): number {
  return left.localeCompare(right, 'en');
}

/** The entries of the archive of `db`, in order, each read to its end as text. */
async function entriesOf(db: Database): Promise<readonly (readonly [string, string])[]> {
  return db.transaction(async (tx) => {
    const entries: (readonly [string, string])[] = [];
    for await (const entry of archiveEntries(tx, EXPORTED_AT)) {
      const decoder = new TextDecoder();
      let text = '';
      for await (const part of entry.chunks) {
        text += decoder.decode(part, { stream: true });
      }
      entries.push([entry.name, text + decoder.decode()]);
    }
    return entries;
  });
}

async function filesOf(db: Database): Promise<ReadonlyMap<string, string>> {
  return new Map(await entriesOf(db));
}

function rawManifest(files: ReadonlyMap<string, string>): Readonly<Record<string, unknown>> {
  return z.record(z.string(), z.unknown()).parse(JSON.parse(files.get('manifest.json') ?? '{}'));
}

function manifestOf(files: ReadonlyMap<string, string>): Manifest {
  return manifestSchema.parse(camelCased(rawManifest(files)));
}

/** The columns of `manifest` that reference a table not loaded before theirs. */
function referencesAhead(manifest: Manifest): readonly string[] {
  const loaded = new Set<string>();
  const ahead: string[] = [];
  for (const table of manifest.tables) {
    const firstPass = table.columns.filter(
      (column) => !table.secondPassColumns.includes(column.name),
    );
    for (const column of firstPass) {
      const parent = column.references?.split('.', 1)[0];
      if (parent !== undefined && !loaded.has(parent) && !EXCLUDED.has(parent)) {
        ahead.push(`${table.name}.${column.name}`);
      }
    }
    loaded.add(table.name);
  }
  return ahead;
}

/** For each table of `manifest`, whether its rows and its hash describe its file. */
function filesMatch(manifest: Manifest, files: ReadonlyMap<string, string>): readonly boolean[] {
  return manifest.tables.map((table) => {
    const text = files.get(table.file) ?? '';
    const rows = text === '' ? 0 : text.trimEnd().split('\n').length;
    const hash = createHash('sha256').update(text).digest('hex');
    return table.rows === rows && table.sha256 === hash;
  });
}

describe('the archive', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;

  beforeEach(async () => {
    const created = await createTestDatabase();
    onTestFinished(created.close);
    db = created.db;
  });

  it('[TRV-52] [TRV-53] holds a readme first, one JSON Lines file per table that the schema exports, and the manifest last', async () => {
    const { player } = await profiledPlayer(db);

    const entries = await entriesOf(db);

    const archived = Object.values(database)
      .filter((value): value is PgTable => is(value, PgTable) && !isOutsideArchive(value))
      .map((table) => `${getTableConfig(table).name}.jsonl`);
    expect(entries.map(([name]) => name).toSorted(byName)).toStrictEqual(
      ['readme.txt', 'manifest.json', ...archived].toSorted(byName),
    );
    expect([entries[0]?.[0], entries.at(-1)?.[0]]).toStrictEqual(['readme.txt', 'manifest.json']);
    const players = new Map(entries).get('followed_players.jsonl') ?? '';
    expect(
      players
        .trimEnd()
        .split('\n')
        .map((line) => camelCased(JSON.parse(line))),
    ).toStrictEqual([
      expect.objectContaining({
        id: player.id,
        displayName: player.displayName,
        addedAt: player.addedAt.toISOString(),
        birthdayOrigin: player.birthdayOrigin,
      }),
    ]);
  });

  it('[TRV-52] [CL-TRV-05] [CL-DSN-08] leaves out the drafts, the account, the sessions, the login failures and the withdrawal ledger, and gives the withdrawn-events counter in the manifest', async () => {
    const { request } = await profiledPlayer(db);
    await db.insert(drafts).values({
      kind: 'research_result',
      backtestRequestId: request.id,
      text: 'A pasted draft that never travels',
      originDevice: 'Phone',
    });
    await db.insert(accounts).values({
      passwordHash: 'scrypt$a-hash-that-never-travels',
      passwordStatus: 'chosen',
      initialPasswordFingerprint: 'a-fingerprint-that-never-travels',
    });
    await db.insert(withdrawalFingerprints).values({ fingerprint: FINGERPRINT });
    await db.insert(withdrawnEventCounter).values({ value: 2 });

    const entries = await entriesOf(db);

    const names = new Set(entries.map(([name]) => name.replace(/\.jsonl$/u, '')));
    expect([...EXCLUDED].filter((table) => names.has(table))).toStrictEqual([]);
    expect(entries.map(([, text]) => text).join('\n')).not.toMatch(/never.travels/u);
    expect(manifestOf(new Map(entries))).toMatchObject({
      format: 'egoscope-export',
      formatVersion: '1.0',
      exportedAt: '2026-11-25T09:30:12.345Z',
      withdrawnEventCount: 2,
    });
  });

  it('[TRV-52] writes the keys of the manifest as operations.md §5.1 names them, and counts no withdrawn event while the counter has no row', async () => {
    const raw = rawManifest(await filesOf(db));

    expect(Object.keys(raw)).toStrictEqual([
      'format',
      'format_version',
      'exported_at',
      'withdrawn_event_count',
      'tables',
      'identity_sequences',
    ]);
    expect(manifestSchema.parse(camelCased(raw)).withdrawnEventCount).toBe(0);
  });

  it('[TRV-52] lists every table in loading order, each after those it references, with its rows and the hash of its file', async () => {
    await profiledPlayer(db);
    const files = await filesOf(db);

    const manifest = manifestOf(files);

    expect(referencesAhead(manifest)).toStrictEqual([]);
    expect(filesMatch(manifest, files).filter((matches) => !matches)).toStrictEqual([]);
    expect(manifest.tables.find((table) => table.name === 'teams')?.rows).toBe(0);
    const names = manifest.tables.map((table) => table.name);
    expect(names.indexOf('followed_players')).toBeGreaterThan(names.indexOf('teams'));
  });

  it('[TRV-52] documents every column and leaves the cycle and the four self-references for the second pass', async () => {
    const { tables } = manifestOf(await filesOf(db));

    const secondPass = new Map(tables.map((table) => [table.name, table.secondPassColumns]));
    expect(
      ['backtest_requests', 'task_runs', 'event_types', 'imports'].map((name) =>
        secondPass.get(name)?.toSorted(byName),
      ),
    ).toStrictEqual([
      ['trigger_import_id'],
      ['parent_run_id'],
      ['merged_into_type_id', 'split_from_type_id'],
      [],
    ]);
    const names = tables.map((table) => table.name);
    expect(names.indexOf('imports')).toBeGreaterThan(names.indexOf('backtest_requests'));
    const columnsOf = (name: string) => tables.find((table) => table.name === name)?.columns;
    expect(columnsOf('followed_players')).toContainEqual({
      name: 'current_team_id',
      type: 'integer',
      nullable: true,
      references: 'teams.id',
    });
    expect(columnsOf('teams')).toContainEqual({
      name: 'abbreviation',
      type: 'text',
      nullable: false,
      references: null,
    });
  });

  it('[TRV-52] [CL-TRV-06] records the last value of each identity sequence, rows erased since included, and 0 for one that issued none', async () => {
    const [team] = await db
      .insert(teams)
      .values({ abbreviation: 'ZZQ', name: 'Quietvale Herons' })
      .returning();
    await db.delete(teams).where(eq(teams.id, team?.id ?? 0));

    const { identitySequences } = manifestOf(await filesOf(db));

    expect([identitySequences.teams, identitySequences.backups]).toStrictEqual([1, 0]);
    expect(identitySequences).not.toHaveProperty('followedPlayers');
    expect(identitySequences).not.toHaveProperty('accounts');
  });

  it('[TRV-56] [TRV-52] embeds a readme, readable without the application, that documents the files and warns that an export holds everything and keeps a withdrawn event', async () => {
    const files = await filesOf(db);
    const readme = files.get('readme.txt') ?? '';

    expect(readme).toMatch(/^Egoscope full export, format egoscope-export 1\.0\n/u);
    expect(readme).toContain('anyone who reads it reads everything you recorded');
    expect(readme).toContain('so keep it in a private place');
    expect(readme).toContain(
      'An event that you withdraw after this export\nstays in it; deleting your earlier exports is then up to you.',
    );
    expect(readme).toContain('second_pass_columns');
  });
});
