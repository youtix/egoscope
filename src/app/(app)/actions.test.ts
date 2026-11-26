import { describe, expect, it, vi } from 'vitest';

import { requireSession } from '@/lib/auth';
import { logger } from '@/lib/log';
import { toEpochMs } from '@/lib/time';
import { todoCount } from '@/lib/todo';

import { readTodoCount } from './actions';

vi.mock(import('@/lib/auth'), () => ({ requireSession: vi.fn() }));
const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock(import('@/lib/db'), async (importOriginal) => ({ ...(await importOriginal()), getDb }));
vi.mock(import('@/lib/log'), () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock(import('@/lib/todo'), () => ({ todoCount: vi.fn() }));

// The connection that the session check opened, which the action reuses.
const DB = Object.freeze({ kind: 'the connection of the request' });

describe('readTodoCount', () => {
  it('[IHM-16] gives a signed-in owner the number of items to do now', async () => {
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
    vi.mocked(todoCount).mockResolvedValue(6);

    await expect(readTodoCount()).resolves.toBe(6);
    expect(todoCount).toHaveBeenCalledExactlyOnceWith(DB);
  });

  it('[IHM-10] [TRV-58] checks the session, and gives a device without one no count', async () => {
    vi.mocked(requireSession).mockResolvedValue({
      ok: false,
      error: { kind: 'log-in', redirect: '/log-in?next=%2F', ended: 'expired' },
    });

    await expect(readTodoCount()).resolves.toBeNull();
    expect(getDb).not.toHaveBeenCalled();
    expect(todoCount).not.toHaveBeenCalled();
  });

  it('[IHM-16] gives no count when the session check or the count fails, and logs why', async () => {
    const failure = new Error('Connection terminated unexpectedly');
    vi.mocked(requireSession).mockRejectedValue(failure);

    await expect(readTodoCount()).resolves.toBeNull();
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      'The navigation bar is shown without the number of items to do: the session check or the count failed.',
      { error: failure },
    );
  });
});
