import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

import { toEpochMs } from '@/lib/time';

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
// When the open session of the device began, Monday 23 November 2026, 10:00 Paris time.
const OPENED_AT = toEpochMs(Date.UTC(2026, 10, 23, 9));
// The session cookie, expired with the attributes that its `__Host-` name requires.
const EXPIRED_COOKIE =
  '__Host-egoscope-session=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=lax';
// The cookie that has the login page erase the device's data in script for five minutes,
// with the same attributes; Next.js writes its Expires date from the clock.
const ERASE_IN_SCRIPT_COOKIE =
  /^__Host-egoscope-erase=1; Path=\/; Expires=[^;]+ GMT; Max-Age=300; Secure; HttpOnly; SameSite=lax$/u;

/** The answer to the step, for a device whose session is in `state`, asked for `next`. */
async function erase(state: SessionState, next: string | null = '/players?tab=cases') {
  harness.currentSession.mockResolvedValue({ ok: true, value: state });
  const query = next === null ? '' : `?${new URLSearchParams({ next }).toString()}`;
  return GET(new NextRequest(`${SITE}/log-in/erase${query}`));
}

/**
 * What the answer tells the browser: where to go, what to erase, which cookies to set, and
 * not to keep it. Next.js writes no Expires date from the clock for a Max-Age of 0, so the
 * expired cookie is compared whole.
 */
function told(response: Response) {
  return {
    status: response.status,
    location: response.headers.get('location'),
    clear: response.headers.get('clear-site-data'),
    cookies: response.headers.getSetCookie(),
    cache: response.headers.get('cache-control'),
  };
}

describe('the step of the login page that tells a device how its session ended', () => {
  it.each(['logged_out', 'password_changed', 'reset', 'restored'] as const)(
    '[IHM-08] [DSN-33] [TRV-62] [CL-TRV-05] [CL-IHM-10] has the device erase its data and its session cookie after a session ended by %s, even where the browser ignores Clear-Site-Data, then shows the login page',
    async (reason) => {
      const response = await erase({ state: 'ended', reason });

      expect(told(response)).toStrictEqual({
        status: 303,
        location: `/log-in?next=%2Fplayers%3Ftab%3Dcases&ended=${reason}`,
        clear: EVERYTHING,
        cookies: [EXPIRED_COOKIE, expect.stringMatching(ERASE_IN_SCRIPT_COOKIE)],
        cache: 'no-store',
      });
    },
  );

  it('[IHM-11] [TRV-62] keeps the data and the session cookie of a device whose session expired, its drafts included', async () => {
    const response = await erase({ state: 'ended', reason: 'expired' });

    expect(told(response)).toStrictEqual({
      status: 303,
      location: `/log-in?next=%2Fplayers%3Ftab%3Dcases&ended=expired`,
      clear: null,
      cookies: [],
      cache: 'no-store',
    });
  });

  it('[IHM-08] erases nothing for a device without a session, whatever its link says', async () => {
    const response = await erase({ state: 'none' });

    expect(told(response)).toStrictEqual({
      status: 303,
      location: `/log-in?next=%2Fplayers%3Ftab%3Dcases`,
      clear: null,
      cookies: [],
      cache: 'no-store',
    });
  });

  it('[IHM-08] [TRV-62] erases nothing of a device whose session is open, whatever its link says', async () => {
    const response = await erase({
      state: 'open',
      session: {
        id: 1,
        device: 'Chrome on Android',
        openedAt: OPENED_AT,
        passwordStatus: 'chosen',
      },
    });

    expect(told(response)).toStrictEqual({
      status: 303,
      location: `/log-in?next=%2Fplayers%3Ftab%3Dcases`,
      clear: null,
      cookies: [],
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
      location: `/log-in?next=%2F`,
      clear: null,
      cookies: [],
      cache: 'no-store',
    });
  });

  it('[IHM-11] returns to Home when the address names no screen', async () => {
    const response = await erase({ state: 'ended', reason: 'logged_out' }, null);

    expect(response.headers.get('location')).toBe('/log-in?next=%2F&ended=logged_out');
  });
});
