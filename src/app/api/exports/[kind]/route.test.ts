import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { createTestDatabase, exportDownloads } from '@/lib/db';
import { record } from '@/lib/journal';
import { DATABASE_TEST_TIMEOUT_MS, profiledPlayer } from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { GET } from './route';

import type { requireSession } from '@/lib/auth';
import type { Database, DatabaseResult } from '@/lib/db';

// `connection()` only works inside a Next.js request; here it just records the call.
vi.mock(import('next/server'), async (importOriginal) => ({
  ...(await importOriginal()),
  connection: vi.fn(),
}));

const harness = vi.hoisted(() => ({
  getDb: vi.fn<() => Promise<DatabaseResult>>(),
  getDirectDb: vi.fn<() => Promise<DatabaseResult>>(),
  requireSession: vi.fn<typeof requireSession>(),
}));

vi.mock(import('@/lib/db'), async (importOriginal) => ({
  ...(await importOriginal()),
  getDb: harness.getDb,
  getDirectDb: harness.getDirectDb,
}));

vi.mock(import('@/lib/auth'), () => ({ requireSession: harness.requireSession }));

const NOW = toEpochMs(Date.UTC(2026, 10, 25, 9, 30, 12));
const ORIGIN = 'https://egoscope.example';
const SESSION = {
  id: 1,
  device: 'Phone',
  openedAt: toEpochMs(Date.UTC(2026, 10, 23, 9)),
  passwordStatus: 'chosen',
} as const;
const NOT_CONFIGURED = { ok: false, error: { kind: 'database-not-configured' } } as const;

/** The answer of the handler to a GET of `/api/exports/<path>`. */
async function get(path: string): Promise<Response> {
  const [kind = ''] = path.split('?', 1);
  return GET(new Request(`${ORIGIN}/api/exports/${path}`), {
    params: Promise.resolve({ kind }),
  });
}

describe('GET /api/exports/[kind]', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;

  beforeEach(async () => {
    const created = await createTestDatabase();
    onTestFinished(created.close);
    onTestFinished(installFakeClock(fixedClock(NOW)));
    db = created.db;
    harness.getDb.mockReset().mockResolvedValue({ ok: true, db });
    harness.getDirectDb.mockReset().mockResolvedValue({ ok: true, db });
    harness.requireSession.mockReset().mockResolvedValue({ ok: true, value: SESSION });
  });

  it('[TRV-56] sends a request without a session to the login page, which brings it back, and exports nothing', async () => {
    const redirect = '/login?next=%2Fapi%2Fexports%2Ffull';
    harness.requireSession.mockResolvedValue({
      ok: false,
      error: { kind: 'log-in', redirect, ended: null },
    });

    const answer = await get('full');

    expect(harness.requireSession).toHaveBeenCalledWith('/api/exports/full');
    expect(answer.status).toBe(303);
    expect(answer.headers.get('Location')).toBe(`${ORIGIN}${redirect}`);
    expect(harness.getDirectDb).not.toHaveBeenCalled();
    await expect(db.select().from(exportDownloads)).resolves.toStrictEqual([]);
  });

  it('[TRV-56] sends a session still on the initial password to choose its own', async () => {
    harness.requireSession.mockResolvedValue({
      ok: false,
      error: { kind: 'choose-password', redirect: '/choose-password' },
    });

    const answer = await get('cases');

    expect(answer.status).toBe(303);
    expect(answer.headers.get('Location')).toBe(`${ORIGIN}/choose-password`);
    expect(harness.getDirectDb).not.toHaveBeenCalled();
  });

  it('[TRV-56] answers 503 when the session cannot be checked, naming no cause', async () => {
    harness.requireSession.mockResolvedValue(NOT_CONFIGURED);

    const answer = await get('full');

    expect(answer.status).toBe(503);
    await expect(answer.text()).resolves.toBe('');
  });

  it('[TRV-52] [TRV-56] streams the full export to the session as a ZIP attachment that no cache keeps, and records it', async () => {
    await profiledPlayer(db);

    const answer = await get('full');

    expect(answer.status).toBe(200);
    expect(Object.fromEntries(answer.headers)).toStrictEqual({
      'cache-control': 'no-store',
      'content-type': 'application/zip',
      'content-disposition': 'attachment; filename="egoscope-export-20261125T093012Z.zip"',
    });
    const archive = new Uint8Array(await answer.arrayBuffer());
    expect([...archive.subarray(0, 4)]).toStrictEqual([0x50, 0x4b, 0x03, 0x04]);
    const downloads = db.select({ kind: exportDownloads.kind }).from(exportDownloads);
    await expect(downloads).resolves.toStrictEqual([{ kind: 'full' }]);
  });

  it('[TRV-52] [CA-TRV-17] streams a spreadsheet export as a CSV attachment', async () => {
    await profiledPlayer(db);

    const answer = await get('cases');

    expect(answer.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(answer.headers.get('Content-Disposition')).toBe('attachment; filename="cases.csv"');
    const text = await answer.text();
    const lines = text.trimEnd().split('\r\n');
    expect(lines).toHaveLength(1 + 7);
    expect(lines[0]).toMatch(/^case_id,player_id,display_name,/u);
  });

  it('[TRV-49] [CA-TRV-35] streams the journal of the days asked for as text, with its technical details on demand', async () => {
    await db.transaction(async (tx) =>
      record(tx, {
        messageKey: 'service_call_failed',
        params: { service: 'stats_source' },
        occurredAt: toEpochMs(Date.UTC(2026, 10, 18, 12)),
        technicalDetails: { service: 'stats_source', httpStatus: 503 },
      }),
    );

    const plain = await get('journal?from=2026-11-18&to=2026-11-18');
    const detailed = await get('journal?from=2026-11-18&to=2026-11-18&details=1');

    expect(plain.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(plain.headers.get('Content-Disposition')).toBe(
      'attachment; filename="egoscope-journal-2026-11-18-2026-11-18.txt"',
    );
    const plainText = await plain.text();
    expect(plainText).toContain('A call to the stats source failed.');
    expect(plainText).not.toContain('httpStatus');
    await expect(detailed.text()).resolves.toContain('\n  httpStatus: 503\n');
  });

  it('[TRV-49] refuses a journal export without two days in order', async () => {
    const answers = await Promise.all([
      get('journal'),
      get('journal?from=2026-11-18'),
      get('journal?from=2026-11-31&to=2026-12-01'),
      get('journal?from=2026-11-19&to=2026-11-18'),
    ]);

    expect(answers.map((answer) => answer.status)).toStrictEqual([400, 400, 400, 400]);
    expect(harness.getDirectDb).not.toHaveBeenCalled();
  });

  it('[TRV-52] answers 404 to a kind that names no export', async () => {
    const answer = await get('backups');

    expect(answer.status).toBe(404);
    expect(harness.getDirectDb).not.toHaveBeenCalled();
  });

  it('[TRV-52] answers 503 while the database is not configured', async () => {
    harness.getDirectDb.mockResolvedValue(NOT_CONFIGURED);

    const answer = await get('players');

    expect(answer.status).toBe(503);
    expect(answer.headers.get('Cache-Control')).toBe('no-store');
  });
});
