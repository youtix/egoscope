import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { toEpochMs } from '@/lib/time';

const { requireSession } = vi.hoisted(() => ({ requireSession: vi.fn() }));
vi.mock(import('@/lib/auth'), () => ({ requireSession }));

// What `notFound()` throws, which Next.js answers with the not-found screen.
const NOT_FOUND = { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' };

/** The Alerts screen of a build that serves `lot`, for a signed-in owner. */
async function alertsOfLot(lot: '1' | '2') {
  vi.stubEnv('EGOSCOPE_LOT', lot);
  vi.resetModules();
  requireSession.mockResolvedValue({
    ok: true,
    value: {
      id: 4,
      device: 'Phone',
      openedAt: toEpochMs(Date.UTC(2026, 10, 23, 9)),
      passwordStatus: 'chosen',
    },
  });
  const { default: AlertsPage } = await import('./page');
  return AlertsPage;
}

describe('AlertsPage', () => {
  it('[IHM-16] answers not found while the lot is 1, before any session check', async () => {
    const AlertsPage = await alertsOfLot('1');

    await expect(AlertsPage()).rejects.toMatchObject(NOT_FOUND);
    expect(requireSession).not.toHaveBeenCalled();
  });

  it('[IHM-16] shows the placeholder of Alerts, with its title, to a signed-in owner in Lot 2', async () => {
    const AlertsPage = await alertsOfLot('2');

    render(await AlertsPage());

    expect(screen.getByRole('heading', { level: 1, name: 'Alerts' })).toBeVisible();
    expect(requireSession).toHaveBeenCalledExactlyOnceWith('/alerts');
  });
});
