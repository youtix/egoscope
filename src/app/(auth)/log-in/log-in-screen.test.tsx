import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { LogInScreen } from './log-in-screen';

import type { LogInState } from './actions';
import type { lockoutUntil } from './lockout';
import type { LogInQuery } from './log-in-screen';
import type { currentSession, lockoutStatus, SessionState } from '@/lib/auth';

// The session and the lockout as the auth module reads them, the login action, and the
// address that `redirect()` sends the device to.
const harness = vi.hoisted(() => ({
  currentSession: vi.fn<typeof currentSession>(),
  lockoutStatus: vi.fn<typeof lockoutStatus>(),
  lockoutUntil: vi.fn<typeof lockoutUntil>(),
  logInAction:
    vi.fn<(next: unknown, previous: LogInState, data: FormData) => Promise<LogInState>>(),
}));

/** What `redirect()` throws in these tests: the address it sends the device to. */
class Redirected extends Error {
  readonly to: string;

  constructor(to: string) {
    super(`Redirected to ${to}`);
    this.to = to;
  }
}

vi.mock(import('next/navigation'), async (importOriginal) => ({
  ...(await importOriginal()),
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));

vi.mock(import('@/lib/auth'), () => ({
  currentSession: harness.currentSession,
  lockoutStatus: harness.lockoutStatus,
}));

vi.mock(import('./lockout'), () => ({ lockoutUntil: harness.lockoutUntil }));

vi.mock(import('./actions'), () => ({ logInAction: harness.logInAction }));

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };
// Monday 23 November 2026, 10:00 Paris time, the time of the device; and 10:25, the end
// of a lockout.
const START = toEpochMs(Date.UTC(2026, 10, 23, 9));
const UNTIL = toEpochMs(Date.UTC(2026, 10, 23, 9, 25));
const NOTICE = 'Login locked until Monday 23 November 2026, 10:25 Paris time';
const MEANWHILE = 'Logins are refused after repeated wrong passwords, until the time shown above.';
const NOT_CHECKED = 'The app cannot check your password right now: try again in a few minutes.';
const NEXT = '/players?tab=cases';
const NONE: SessionState = { state: 'none' };
// The ways that the owner ends a session, each of which erases the device's data (IHM-08),
// and a value of the address that names no way a session ends.
const OWNER_ENDINGS = ['logged_out', 'password_changed', 'reset', 'restored'] as const;
const UNKNOWN_REASON = 'forgotten';

/** A session open on this device, on the initial or the chosen password. */
function open(passwordStatus: 'initial' | 'chosen'): SessionState {
  return {
    state: 'open',
    session: { id: 1, device: 'Chrome on Android', openedAt: UNTIL, passwordStatus },
  };
}

/** The screen for the address whose query is `query`, its session in `state`. */
async function logInScreen(query: LogInQuery, state: SessionState = NONE) {
  harness.currentSession.mockResolvedValue({ ok: true, value: state });
  return LogInScreen({ query: Promise.resolve(query) });
}

/** Where the screen sends the device, or null when it shows itself. */
async function redirectOf(query: LogInQuery, state: SessionState): Promise<string | null> {
  try {
    await logInScreen(query, state);
    return null;
  } catch (error) {
    if (error instanceof Redirected) {
      return error.to;
    }
    throw error;
  }
}

describe('the login screen', () => {
  beforeEach(() => {
    onTestFinished(installFakeClock(fixedClock(START)));
    harness.lockoutStatus.mockResolvedValue({ ok: true, value: { lockedUntil: null } });
    harness.lockoutUntil.mockResolvedValue({ ok: true, value: { until: UNTIL, notice: NOTICE } });
    harness.logInAction.mockResolvedValue({ lockout: null });
  });

  it('[IHM-06] asks for the password alone, which a password manager can fill and the owner can show in clear', async () => {
    const user = userEvent.setup();
    render(await logInScreen({ next: NEXT }));
    const password = screen.getByLabelText('Password');

    expect(screen.getByRole('heading', { level: 1, name: 'Log in' })).toBeVisible();
    expect(password).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.queryAllByRole('textbox')).toStrictEqual([]);
    await user.click(screen.getByRole('button', { name: 'Show the password' }));
    expect(screen.getAllByRole('textbox')).toStrictEqual([password]);
  });

  it('[IHM-05] [CA-TRV-30] offers no account to create, nor anything but the login', async () => {
    render(await logInScreen({ next: NEXT }));

    expect(screen.getAllByRole('button').map((button) => button.textContent)).toStrictEqual([
      'Show the password',
      'Log in',
    ]);
    expect(screen.queryAllByRole('link')).toStrictEqual([]);
    await expect(axe.run(document.body, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });

  it.each([
    ['a screen of the app', NEXT, NEXT],
    ['another site', 'https://other.example/players', '/'],
    ['no screen', undefined, '/'],
  ])('[IHM-10] [IHM-11] logs in for %s', async (_case, next, target) => {
    const user = userEvent.setup();
    render(await logInScreen({ next }));

    await user.type(screen.getByLabelText('Password'), 'chosen-meadow-violet-quartz');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(harness.logInAction).toHaveBeenCalledOnce();
    const [bound, previous, data] = harness.logInAction.mock.calls[0] ?? [];
    expect([bound, previous, data?.get('password')]).toStrictEqual([
      target,
      { lockout: null },
      'chosen-meadow-violet-quartz',
    ]);
  });

  it('[TRV-61] [IHM-07] [CA-IHM-03] says until when logins are locked, and sends nothing meanwhile', async () => {
    const user = userEvent.setup();
    harness.lockoutStatus.mockResolvedValue({ ok: true, value: { lockedUntil: UNTIL } });
    render(await logInScreen({ next: NEXT }));

    await user.type(screen.getByLabelText('Password'), 'chosen-meadow-violet-quartz{Enter}');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(harness.lockoutUntil.mock.calls).toStrictEqual([[UNTIL]]);
    expect(screen.getByRole('alert')).toHaveTextContent(NOTICE);
    expect(screen.getByRole('button', { name: 'Log in' })).toHaveAccessibleDescription(MEANWHILE);
    expect(harness.logInAction).not.toHaveBeenCalled();
    await expect(axe.run(document.body, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });

  it.each([
    ['expired', 'Session expired'],
    ['logged_out', 'Logged out'],
    ['password_changed', 'Password changed'],
    ['reset', 'Password reset'],
    ['restored', 'Data restored'],
  ])(
    '[IHM-08] [IHM-11] [CL-TRV-05] tells a device told that its session ended by %s: "%s"',
    async (ended, label) => {
      render(await logInScreen({ next: NEXT, ended }));

      expect(screen.getByRole('status')).toHaveTextContent(label);
      expect(screen.getByLabelText('Password')).toBeVisible();
      await expect(axe.run(document.body, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
    },
  );

  it('[IHM-08] tells nothing to a device without a session whose address names no way a session ends', async () => {
    render(await logInScreen({ next: NEXT, ended: UNKNOWN_REASON }));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeVisible();
  });

  it('[IHM-11] keeps on the login page a device whose expired session was told so', async () => {
    render(
      await logInScreen({ next: NEXT, ended: 'expired' }, { state: 'ended', reason: 'expired' }),
    );

    expect(screen.getByRole('status')).toHaveTextContent('Session expired');
  });

  it.each([
    [
      'open on the initial password',
      open('initial'),
      '/choose-password?next=%2Fplayers%3Ftab%3Dcases',
    ],
    ['open on the chosen password', open('chosen'), NEXT],
  ])(
    '[TRV-57] [IHM-06] [IHM-11] sends a device whose session is %s on',
    async (_case, state, to) => {
      await expect(redirectOf({ next: NEXT }, state)).resolves.toBe(to);
    },
  );

  it.each([
    [
      'ended by a password change, untold',
      { state: 'ended', reason: 'password_changed' },
      undefined,
    ],
    ['reset, told of an expiry', { state: 'ended', reason: 'reset' }, 'expired'],
    ['expired, untold', { state: 'ended', reason: 'expired' }, undefined],
    ['expired, told of a logout', { state: 'ended', reason: 'expired' }, 'logged_out'],
  ] as const)(
    '[IHM-08] sends a device whose session was %s through the step that tells it, and erases its data when the owner ended it',
    async (_case, state, ended) => {
      await expect(redirectOf({ next: NEXT, ended }, state)).resolves.toBe(
        '/log-in/erase?next=%2Fplayers%3Ftab%3Dcases',
      );
    },
  );

  it.each(
    OWNER_ENDINGS.flatMap((reason) =>
      [reason, 'expired', UNKNOWN_REASON].map((ended) => [reason, ended] as const),
    ),
  )(
    '[IHM-08] [CL-IHM-10] [CL-TRV-05] sends a device whose session was ended by %s through the step that erases its data, whatever its address says, here ended=%s',
    async (reason, ended) => {
      await expect(redirectOf({ next: NEXT, ended }, { state: 'ended', reason })).resolves.toBe(
        '/log-in/erase?next=%2Fplayers%3Ftab%3Dcases',
      );
    },
  );

  it('[TRV-64] says that the server cannot check passwords when it cannot read the session', async () => {
    harness.currentSession.mockResolvedValue({
      ok: false,
      error: { kind: 'database-not-configured' },
    });
    render(await LogInScreen({ query: Promise.resolve({ next: NEXT }) }));

    expect(screen.getByRole('alert')).toHaveTextContent(NOT_CHECKED);
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  });

  it('[TRV-64] says that the server cannot check passwords when it cannot read the lockout', async () => {
    harness.lockoutStatus.mockResolvedValue({
      ok: false,
      error: { kind: 'initial-password-missing' },
    });
    render(await logInScreen({ next: NEXT }));

    expect(screen.getByRole('alert')).toHaveTextContent(NOT_CHECKED);
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  });
});
