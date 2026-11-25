import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { requireSession } from '@/lib/auth';
import { toEpochMs } from '@/lib/time';

import HomePage from './page';

vi.mock(import('@/lib/auth'), () => ({ requireSession: vi.fn() }));

describe('HomePage', () => {
  it('[IHM-16] shows the placeholder of Home, with its title, to a signed-in owner', async () => {
    vi.mocked(requireSession).mockResolvedValue({
      ok: true,
      value: {
        id: 4,
        device: 'Phone',
        openedAt: toEpochMs(Date.UTC(2026, 10, 23, 9)),
        passwordStatus: 'chosen',
      },
    });

    render(await HomePage());

    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
    expect(requireSession).toHaveBeenCalledExactlyOnceWith('/');
  });

  it('[IHM-10] sends a device without a session to the login page, which returns to Home', async () => {
    vi.mocked(requireSession).mockResolvedValue({
      ok: false,
      error: { kind: 'log-in', redirect: '/log-in?next=%2F', ended: null },
    });

    await expect(HomePage()).rejects.toMatchObject({
      digest: 'NEXT_REDIRECT;replace;/log-in?next=%2F;307;',
    });
    expect(requireSession).toHaveBeenCalledExactlyOnceWith('/');
  });
});
