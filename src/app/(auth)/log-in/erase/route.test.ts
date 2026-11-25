import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

import { GET } from './route';

import type { currentSession, SessionState } from '@/lib/auth';

// The state of the session that the device presents, as the auth module reads it.
const harness = vi.hoisted(() => ({ currentSession: vi.fn<typeof currentSession>() }));

vi.mock(import('@/lib/auth'), async (importOriginal) => ({
  ...(await importOriginal()),
  currentSession: harness.currentSession,
}));

const SITE = 'https://egoscope.test';
const EVERYTHING = '"cache", "cookies", "storage"';

/** The answer to the step, for a device whose session is in `state`, asked for `next`. */
async function erase(state: SessionState, next: string | null = '/players?tab=cases') {
  harness.currentSession.mockResolvedValue({ ok: true, value: state });
  const query = next === null ? '' : `?${new URLSearchParams({ next }).toString()}`;
  return GET(new NextRequest(`${SITE}/log-in/erase${query}`));
}

/** What the answer tells the browser: where to go, what to erase, and not to keep it. */
function told(response: Response) {
  return {
    status: response.status,
    location: response.headers.get('location'),
    clear: response.headers.get('clear-site-data'),
    cache: response.headers.get('cache-control'),
  };
}

describe('the step of the login page that tells a device how its session ended', () => {
  it.each(['logged_out', 'password_changed', 'reset', 'restored'] as const)(
    '[IHM-08] [CL-TRV-05] [CL-IHM-10] has the device erase its data after a session ended by %s, then shows the login page',
    async (reason) => {
      const response = await erase({ state: 'ended', reason });

      expect(told(response)).toStrictEqual({
        status: 303,
        location: `${SITE}/log-in?next=%2Fplayers%3Ftab%3Dcases&ended=${reason}`,
        clear: EVERYTHING,
        cache: 'no-store',
      });
    },
  );

  it('[IHM-11] keeps the data of a device whose session expired, its drafts included', async () => {
    const response = await erase({ state: 'ended', reason: 'expired' });

    expect(told(response)).toStrictEqual({
      status: 303,
      location: `${SITE}/log-in?next=%2Fplayers%3Ftab%3Dcases&ended=expired`,
      clear: null,
      cache: 'no-store',
    });
  });

  it('[IHM-08] erases nothing for a device without a session, whatever its link says', async () => {
    const response = await erase({ state: 'none' });

    expect(told(response)).toStrictEqual({
      status: 303,
      location: `${SITE}/log-in?next=%2Fplayers%3Ftab%3Dcases`,
      clear: null,
      cache: 'no-store',
    });
  });

  it('[IHM-08] erases nothing while the server cannot check the session', async () => {
    harness.currentSession.mockResolvedValue({
      ok: false,
      error: { kind: 'database-not-configured' },
    });

    const response = await GET(new NextRequest(`${SITE}/log-in/erase?next=%2F`));

    expect(told(response)).toStrictEqual({
      status: 303,
      location: `${SITE}/log-in?next=%2F`,
      clear: null,
      cache: 'no-store',
    });
  });

  it('[IHM-11] returns to Home when the address names no screen', async () => {
    const response = await erase({ state: 'ended', reason: 'logged_out' }, null);

    expect(response.headers.get('location')).toBe(`${SITE}/log-in?next=%2F&ended=logged_out`);
  });
});
