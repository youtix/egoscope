import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { requireSession } from '@/lib/auth';
import { createTestDatabase } from '@/lib/db';
import { seedCandidateTypes } from '@/lib/taxonomy';
import { DATABASE_TEST_TIMEOUT_MS } from '@/lib/testing';
import { toEpochMs } from '@/lib/time';

import TypesPage from './page';

vi.mock(import('@/lib/auth'), () => ({ requireSession: vi.fn() }));
const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock(import('@/lib/db'), async (importOriginal) => ({ ...(await importOriginal()), getDb }));

// The first start of the application, when the reference data is seeded (TAX-15).
const FIRST_START = toEpochMs(Date.UTC(2026, 10, 2, 8));
// The names of the nine candidate types of data/seeds/, all created at the first start, so
// in the order of their identifiers (TAX-10).
const CANDIDATE_TYPES = [
  'Death of a loved one',
  "Player's birthday",
  'Game against a former team',
  'Media storm',
  'Negative record to avoid',
  'Conflict between players',
  'Public humiliation',
  'Racist abuse',
  'Approaching a positive historic record',
];

/** A device with an open session. */
function signedIn(): void {
  vi.mocked(requireSession).mockResolvedValue({
    ok: true,
    value: {
      id: 4,
      device: 'Phone',
      openedAt: toEpochMs(Date.UTC(2026, 10, 23, 9)),
      passwordStatus: 'chosen',
    },
  });
}

/** The Types screen of a first start, on a database of its own that the test closes. */
async function renderFirstStart(): Promise<void> {
  const database = await createTestDatabase();
  onTestFinished(database.close);
  await seedCandidateTypes(database.db, FIRST_START);
  signedIn();
  getDb.mockResolvedValue({ ok: true, db: database.db });
  render(await TypesPage());
}

describe('TypesPage', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  it('[CA-TAX-03] [TAX-15] lists, on a first start, the nine candidate types as proposals of origin scoping', async () => {
    await renderFirstStart();

    expect(requireSession).toHaveBeenCalledExactlyOnceWith('/types');
    const proposed = screen.getByRole('region', { name: 'Proposed' });
    expect(within(proposed).getByText('9 types')).toBeVisible();
    expect(
      within(proposed)
        .getAllByRole('listitem')
        .map((item) => [
          within(item).getByRole('link').textContent,
          within(item).getAllByRole('definition')[0]?.textContent,
        ]),
    ).toStrictEqual(CANDIDATE_TYPES.map((name) => [name, 'Scoping']));
  });

  it('[CA-TAX-03] [IHM-55] shows no validated type on a first start, and says so', async () => {
    await renderFirstStart();

    const validated = screen.getByRole('region', { name: 'Validated' });
    expect(within(validated).getByText('0 types')).toBeVisible();
    expect(within(validated).queryByRole('listitem')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'no validated type' })).toBeVisible();
  });

  it('[IHM-31] fails the screen, for the error screen to show, on a server without a database', async () => {
    signedIn();
    getDb.mockResolvedValue({ ok: false, error: { kind: 'database-not-configured' } });

    await expect(TypesPage()).rejects.toThrow(
      'The server cannot read the types: database-not-configured.',
    );
  });
});
