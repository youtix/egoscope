import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';

import { createTestDatabase } from '../test-database';
import { incidents } from './incidents';

import type { Database } from '../types';

// The instant an incident closed, 2026-11-18 05:00 UTC.
const CLOSED_AT = new Date(toEpochMs(Date.UTC(2026, 10, 18, 5)));
// Any instant: a default of now() reads the database's clock, which no test sets.
const ANY_INSTANT: unknown = expect.any(Date);

/** The error of a query that a CHECK constraint refused. */
const violationOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23514', constraint },
});

/** The error of a query that a unique constraint or index refused. */
const duplicateOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23505', constraint },
});

describe('the incidents table', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    return database.close;
  }, 60_000);

  it('opens an incident with the defaults of the data model', async () => {
    await db.insert(incidents).values({ kind: 'task_not_run', causeKey: 'purge' });

    await expect(db.select().from(incidents)).resolves.toStrictEqual([
      {
        id: 1,
        kind: 'task_not_run',
        causeKey: 'purge',
        serviceRole: null,
        status: 'open',
        openedAt: ANY_INSTANT,
        closedAt: null,
        hiddenAt: null,
        quotaCauses: [],
        details: {},
      },
    ]);
  });

  it('accepts each incident kind of the glossary, and refuses another', async () => {
    const kinds = [
      'press_source_down',
      'collection_impossible',
      'press_source_silent',
      'feed_too_short',
      'quota_reached',
      'quota_warning',
      'database_volume_warning',
      'stats_source_unavailable',
      'stats_source_schema_changed',
      'task_not_run',
      'backup_failed',
      'logins_refused',
      'telegram_link_broken',
      'export_reminder',
    ] as const;
    await db
      .insert(incidents)
      .values([
        ...kinds.filter((kind) => kind !== 'quota_reached').map((kind) => ({ kind })),
        { kind: 'quota_reached', quotaCauses: ['limit_reached'] },
      ]);

    const stored = await db.select({ kind: incidents.kind }).from(incidents);
    const unknown = db.insert(incidents).values({ kind: sql`'quota_exceeded'` });

    expect(new Set(stored.map((row) => row.kind))).toStrictEqual(new Set(kinds));
    await expect(unknown).rejects.toMatchObject(violationOf('incidents_kind_check'));
  });

  it('names the service of a quota incident by its role in the glossary', async () => {
    const roles = [
      'hosting',
      'database',
      'stats_source',
      'language_model',
      'news_feeds',
      'notifications',
      'trigger_service',
      'backup_storage',
    ] as const;
    await db.insert(incidents).values(
      roles.map((serviceRole) => ({
        kind: 'quota_warning' as const,
        causeKey: serviceRole,
        serviceRole,
      })),
    );

    const stored = await db
      .select({ role: incidents.serviceRole })
      .from(incidents)
      .orderBy(incidents.id);
    const unknown = db
      .insert(incidents)
      .values({ kind: 'quota_warning', serviceRole: sql`'storage'` });

    expect(stored.map((row) => row.role)).toStrictEqual(roles);
    await expect(unknown).rejects.toMatchObject(violationOf('incidents_service_role_check'));
  });

  it('[CL-TRV-11] names the causes of a quota reached, of the glossary, and on no other kind', async () => {
    const causes = ['limit_reached', 'refused_before_limit', 'not_answering'] as const;
    await db.insert(incidents).values({ kind: 'quota_reached', quotaCauses: [...causes] });

    const unknown = db
      .insert(incidents)
      .values({ kind: 'quota_reached', causeKey: 'groq', quotaCauses: sql`ARRAY['over_budget']` });
    const without = db.insert(incidents).values({ kind: 'quota_reached', causeKey: 'groq' });
    const elsewhere = db
      .insert(incidents)
      .values({ kind: 'backup_failed', quotaCauses: ['limit_reached'] });

    await expect(
      db.select({ causes: incidents.quotaCauses }).from(incidents),
    ).resolves.toStrictEqual([{ causes }]);
    await expect(unknown).rejects.toMatchObject(violationOf('incidents_quota_causes_check'));
    await expect(without).rejects.toMatchObject(violationOf('incidents_quota_reached_check'));
    await expect(elsewhere).rejects.toMatchObject(violationOf('incidents_quota_reached_check'));
  });

  it('closes an incident with the instant it closed, and only then', async () => {
    const closedWithout = db.insert(incidents).values({ kind: 'backup_failed', status: 'closed' });
    const openWith = db.insert(incidents).values({ kind: 'backup_failed', closedAt: CLOSED_AT });
    const unknown = db.insert(incidents).values({ kind: 'backup_failed', status: sql`'hidden'` });

    await expect(closedWithout).rejects.toMatchObject(violationOf('incidents_closed_check'));
    await expect(openWith).rejects.toMatchObject(violationOf('incidents_closed_check'));
    await expect(unknown).rejects.toMatchObject(violationOf('incidents_status_check'));
  });

  it('[CL-TRV-11] keeps one open incident per cause, and opens it again once it closed', async () => {
    await db.insert(incidents).values({ kind: 'task_not_run', causeKey: 'purge' });
    const again = db.insert(incidents).values({ kind: 'task_not_run', causeKey: 'purge' });
    await expect(again).rejects.toMatchObject(duplicateOf('incidents_open_cause_key'));

    await db
      .update(incidents)
      .set({ status: 'closed', closedAt: CLOSED_AT })
      .where(eq(incidents.id, 1));
    await db.insert(incidents).values([
      { kind: 'task_not_run', causeKey: 'purge' },
      { kind: 'task_not_run', causeKey: 'backup' },
    ]);

    await expect(
      db
        .select({ cause: incidents.causeKey, status: incidents.status })
        .from(incidents)
        .orderBy(incidents.id),
    ).resolves.toStrictEqual([
      { cause: 'purge', status: 'closed' },
      { cause: 'purge', status: 'open' },
      { cause: 'backup', status: 'open' },
    ]);
  });
});
