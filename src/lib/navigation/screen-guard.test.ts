import { describe, expect, it, vi } from 'vitest';

import { requireSession } from '@/lib/auth';
import { toEpochMs } from '@/lib/time';

import { guardScreen } from './screen-guard';

import type { Session } from '@/lib/auth';

vi.mock(import('@/lib/auth'), () => ({ requireSession: vi.fn() }));

const SESSION: Session = {
  id: 4,
  device: 'Phone',
  openedAt: toEpochMs(Date.UTC(2026, 10, 23, 9)),
  passwordStatus: 'chosen',
};

describe('guardScreen', () => {
  it('[IHM-16] gives the screen the open session of the device', async () => {
    vi.mocked(requireSession).mockResolvedValue({ ok: true, value: SESSION });

    await expect(guardScreen('/players')).resolves.toStrictEqual(SESSION);
    expect(requireSession).toHaveBeenCalledWith('/players');
  });

  it('[IHM-10] sends a device without a session to the login page, which returns to the screen', async () => {
    vi.mocked(requireSession).mockResolvedValue({
      ok: false,
      error: { kind: 'log-in', redirect: '/log-in?next=%2Fplayers', ended: null },
    });

    await expect(guardScreen('/players')).rejects.toMatchObject({
      digest: 'NEXT_REDIRECT;replace;/log-in?next=%2Fplayers;307;',
    });
  });

  it('[TRV-57] sends an account on its initial password to the choose-password screen', async () => {
    vi.mocked(requireSession).mockResolvedValue({
      ok: false,
      error: { kind: 'choose-password', redirect: '/choose-password' },
    });

    await expect(guardScreen('/more')).rejects.toMatchObject({
      digest: 'NEXT_REDIRECT;replace;/choose-password;307;',
    });
  });

  it('leaves a server that cannot check sessions to the error screen', async () => {
    vi.mocked(requireSession).mockResolvedValue({
      ok: false,
      error: { kind: 'database-not-configured' },
    });

    await expect(guardScreen('/')).rejects.toThrow(
      'The server cannot check sessions: database-not-configured.',
    );
  });
});
