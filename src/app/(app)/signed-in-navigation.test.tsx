import { render, screen } from '@testing-library/react';
import { redirect, usePathname } from 'next/navigation';
import { describe, expect, it, vi } from 'vitest';

import { requireSession } from '@/lib/auth';
import { logger } from '@/lib/log';
import { recordDatabaseActivity } from '@/lib/quotas';
import { toEpochMs } from '@/lib/time';
import { todoCount } from '@/lib/todo';

import { SignedInNavigation } from './signed-in-navigation';

vi.mock(import('next/navigation'), async (importOriginal) => ({
  ...(await importOriginal()),
  usePathname: vi.fn(),
}));
vi.mock(import('@/lib/auth'), () => ({ requireSession: vi.fn() }));
const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock(import('@/lib/db'), () => ({ getDb }));
vi.mock(import('@/lib/log'), () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock(import('@/lib/quotas'), () => ({ recordDatabaseActivity: vi.fn() }));
vi.mock(import('@/lib/todo'), () => ({ todoCount: vi.fn() }));

// The connection that the session check opened, which the shell reuses.
const DB = Object.freeze({ kind: 'the connection of the request' });

/** A device with an open session, on a server whose to-do list holds `count` items. */
function signedIn(count: number): void {
  vi.mocked(requireSession).mockResolvedValue({
    ok: true,
    value: {
      id: 4,
      device: 'Phone',
      openedAt: toEpochMs(Date.UTC(2026, 10, 23, 9)),
      passwordStatus: 'chosen',
    },
  });
  getDb.mockResolvedValue({ ok: true, db: DB });
  vi.mocked(recordDatabaseActivity).mockResolvedValue(undefined);
  vi.mocked(todoCount).mockResolvedValue(count);
}

/** The shell's navigation, rendered on the Home screen. */
async function renderNavigation(): Promise<void> {
  vi.mocked(usePathname).mockReturnValue('/');
  render(await SignedInNavigation());
}

describe('SignedInNavigation', () => {
  it('[IHM-16] carries the number of items to do on the Home entry of a signed-in owner', async () => {
    signedIn(5);

    await renderNavigation();

    expect(screen.getByRole('link', { name: 'Home 5 to do' })).toBeVisible();
    expect(todoCount).toHaveBeenCalledWith(DB);
  });

  it("[TRV-03] records the minute's database activity of a signed-in owner's visit", async () => {
    signedIn(0);

    await renderNavigation();

    expect(recordDatabaseActivity).toHaveBeenCalledExactlyOnceWith(DB);
  });

  it('[IHM-10] shows the bar alone without a session, and asks the database nothing more', async () => {
    vi.mocked(requireSession).mockResolvedValue({
      ok: false,
      error: { kind: 'log-in', redirect: '/log-in?next=%2F', ended: 'expired' },
    });

    await renderNavigation();

    expect(screen.getByRole('link', { name: 'Home' })).toBeVisible();
    expect(screen.getAllByRole('link')).toHaveLength(4);
    expect(getDb).not.toHaveBeenCalled();
    expect(recordDatabaseActivity).not.toHaveBeenCalled();
  });

  it('[IHM-16] shows the bar alone when the database cannot be reached', async () => {
    signedIn(5);
    getDb.mockResolvedValue({ ok: false, error: { kind: 'database-not-configured' } });

    await renderNavigation();

    expect(screen.getByRole('link', { name: 'Home' })).toBeVisible();
    expect(recordDatabaseActivity).not.toHaveBeenCalled();
    expect(todoCount).not.toHaveBeenCalled();
  });

  it('[IHM-16] keeps the bar, without a count, when the session check loses the database', async () => {
    const failure = new Error('connect ECONNREFUSED');
    vi.mocked(requireSession).mockRejectedValue(failure);

    await renderNavigation();

    expect(screen.getByRole('link', { name: 'Home' })).toBeVisible();
    expect(screen.getAllByRole('link')).toHaveLength(4);
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      'The navigation bar is shown without the number of items to do, which could not be read.',
      { error: failure },
    );
  });

  it('[IHM-16] keeps the bar, without a count, when the activity record fails', async () => {
    signedIn(5);
    vi.mocked(recordDatabaseActivity).mockRejectedValueOnce(new Error('Connection terminated'));

    await renderNavigation();

    expect(screen.getByRole('link', { name: 'Home' })).toBeVisible();
    expect(todoCount).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('[IHM-16] keeps the bar, without a count, when the count fails', async () => {
    signedIn(5);
    const failure = new Error('Connection terminated unexpectedly');
    vi.mocked(todoCount).mockRejectedValue(failure);

    await renderNavigation();

    expect(screen.getByRole('link', { name: 'Home' })).toBeVisible();
    expect(screen.queryByText('5 to do')).not.toBeInTheDocument();
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      'The navigation bar is shown without the number of items to do, which could not be read.',
      { error: failure },
    );
  });

  it('leaves to Next.js the errors through which it controls a request', async () => {
    vi.mocked(requireSession).mockImplementation(() => {
      redirect('/settings');
    });

    await expect(SignedInNavigation()).rejects.toThrow('NEXT_REDIRECT');
    expect(logger.error).not.toHaveBeenCalled();
  });
});
