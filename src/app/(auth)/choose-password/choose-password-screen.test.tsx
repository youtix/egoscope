import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { noQueryDatabase } from '@/lib/testing';
import { toEpochMs } from '@/lib/time';

import { ChoosePasswordScreen } from './choose-password-screen';

import type { ChoosePasswordState } from './actions';
import type { ChoosePasswordQuery } from './choose-password-screen';
import type { currentSession, SessionState } from '@/lib/auth';
import type { getDb } from '@/lib/db';
import type { getParam } from '@/lib/params';

// The session as the auth module reads it, the database and its minimum password length,
// the action of the form, and the address that `redirect()` sends the device to.
const harness = vi.hoisted(() => ({
  currentSession: vi.fn<typeof currentSession>(),
  getDb: vi.fn<typeof getDb>(),
  getParam: vi.fn<typeof getParam>(),
  choosePasswordAction:
    vi.fn<
      (next: unknown, previous: ChoosePasswordState, data: FormData) => Promise<ChoosePasswordState>
    >(),
}));

/** What `redirect()` throws in these tests: the address it sends the device to. */
class Redirected extends Error {
  constructor(readonly to: string) {
    super(`Redirected to ${to}`);
  }
}

vi.mock(import('next/navigation'), async (importOriginal) => ({
  ...(await importOriginal()),
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));

vi.mock(import('@/lib/auth'), () => ({ currentSession: harness.currentSession }));

vi.mock(import('@/lib/db'), async (importOriginal) => ({
  ...(await importOriginal()),
  getDb: harness.getDb,
}));

vi.mock(import('@/lib/params'), () => ({ getParam: harness.getParam }));

vi.mock(import('./actions'), () => ({ choosePasswordAction: harness.choosePasswordAction }));

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };
const OPENED_AT = toEpochMs(Date.UTC(2026, 10, 23, 9));
const NEXT = '/players?tab=cases';
const NOT_STORED = 'The app cannot save your password right now: try again in a few minutes.';

/** A session open on this device, on the initial or the chosen password. */
function open(passwordStatus: 'initial' | 'chosen'): SessionState {
  return {
    state: 'open',
    session: { id: 1, device: 'Chrome on Android', openedAt: OPENED_AT, passwordStatus },
  };
}

/** The screen for the address whose query is `query`, its session in `state`. */
async function choosePasswordScreen(query: ChoosePasswordQuery, state: SessionState) {
  harness.currentSession.mockResolvedValue({ ok: true, value: state });
  return ChoosePasswordScreen({ query: Promise.resolve(query) });
}

/** Where the screen sends the device, or null when it shows itself. */
async function redirectOf(state: SessionState): Promise<string | null> {
  try {
    await choosePasswordScreen({ next: NEXT }, state);
    return null;
  } catch (error) {
    if (error instanceof Redirected) {
      return error.to;
    }
    throw error;
  }
}

describe('the "Choose your password" screen', () => {
  beforeEach(() => {
    harness.getDb.mockResolvedValue({ ok: true, db: noQueryDatabase().db });
    harness.getParam.mockResolvedValue(16);
    harness.choosePasswordAction.mockResolvedValue({});
  });

  it('[TRV-57] [IHM-06] [TRV-60] [CL-TRV-15] asks a device on the initial password for a new one, with its minimum length and what the choice does', async () => {
    render(await choosePasswordScreen({ next: NEXT }, open('initial')));

    expect(screen.getByRole('heading', { level: 1, name: 'Choose your password' })).toBeVisible();
    expect(
      screen.getByText(
        'Replace the initial password with one of at least 16 characters. Every other device is then logged out.',
      ),
    ).toBeVisible();
    expect(screen.getByLabelText('New password')).toHaveAttribute('autocomplete', 'new-password');
    expect(harness.getParam.mock.calls.map(([, key]) => key)).toStrictEqual([
      'auth.passwordMinLength',
    ]);
    await expect(axe.run(document.body, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });

  it('[IHM-10] [IHM-11] sends the new password for the screen asked for, in the body of the request', async () => {
    const user = userEvent.setup();
    render(await choosePasswordScreen({ next: NEXT }, open('initial')));

    await user.type(screen.getByLabelText('New password'), 'chosen-meadow-violet-quartz');
    await user.click(screen.getByRole('button', { name: 'Save the password' }));

    const [bound, , data] = harness.choosePasswordAction.mock.calls[0] ?? [];
    expect([bound, data?.get('password')]).toStrictEqual([NEXT, 'chosen-meadow-violet-quartz']);
  });

  it.each([
    ['a session on the chosen password', open('chosen')],
    ['no session', { state: 'none' } as const],
    ['an ended session', { state: 'ended', reason: 'expired' } as const],
  ])(
    '[TRV-57] sends a device with %s to the login page, which sends it where it belongs',
    async (_case, state) => {
      await expect(redirectOf(state)).resolves.toBe('/log-in?next=%2Fplayers%3Ftab%3Dcases');
    },
  );

  it('[TRV-64] says that the password cannot be saved now when the server cannot read the session', async () => {
    harness.currentSession.mockResolvedValue({
      ok: false,
      error: { kind: 'database-not-configured' },
    });
    render(await ChoosePasswordScreen({ query: Promise.resolve({ next: NEXT }) }));

    expect(screen.getByRole('alert')).toHaveTextContent(NOT_STORED);
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });

  it('[TRV-64] says that the password cannot be saved now when the server has no database', async () => {
    harness.getDb.mockResolvedValue({ ok: false, error: { kind: 'database-not-configured' } });
    render(await choosePasswordScreen({ next: NEXT }, open('initial')));

    expect(screen.getByRole('alert')).toHaveTextContent(NOT_STORED);
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });
});
