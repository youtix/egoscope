import { act, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { LogInForm } from './log-in-form';

import type { LogInState } from './actions';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };
// Monday 23 November 2026, 10:10 Paris time, and a minute.
const START = toEpochMs(Date.UTC(2026, 10, 23, 9, 10));
const MINUTE = 60_000;
const LOCKOUT = {
  until: toEpochMs(START + 15 * MINUTE),
  notice: 'Login locked until Monday 23 November 2026, 10:25 Paris time',
};
const MEANWHILE = 'Logins are refused after repeated wrong passwords, until the time shown above.';
const WRONG = 'This password is wrong: type it again.';
const PASSWORD = 'chosen-meadow-violet-quartz';

describe('the login form', () => {
  type Action = (previous: LogInState, formData: FormData) => Promise<LogInState>;

  beforeEach(() => {
    onTestFinished(installFakeClock(fixedClock(START)));
  });

  it('[IHM-06] sends the password it holds, which the owner can show in clear first', async () => {
    const user = userEvent.setup();
    const action = vi.fn<Action>().mockResolvedValue({ lockout: null });
    render(<LogInForm action={action} initial={{ lockout: null }} />);

    await user.type(screen.getByLabelText('Password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Show the password' }));
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
    expect(action.mock.calls.map(([, data]) => data.get('password'))).toStrictEqual([PASSWORD]);
  });

  it('[TRV-61] [IHM-07] tells a wrong password beside its field, and keeps it to be corrected', async () => {
    const user = userEvent.setup();
    const action = vi
      .fn<Action>()
      .mockResolvedValue({ errors: { password: WRONG }, lockout: null });
    render(<LogInForm action={action} initial={{ lockout: null }} />);

    await user.type(screen.getByLabelText('Password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('alert', { name: 'You are not logged in' })).toHaveTextContent(
      WRONG,
    );
    expect(screen.getByLabelText('Password')).toBeInvalid();
    expect(screen.getByLabelText('Password')).toHaveValue(PASSWORD);
    await expect(axe.run(document.body, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });

  it('[TRV-61] [IHM-07] [CA-TRV-20] says until when logins are locked as soon as the fifth wrong password starts the lockout', async () => {
    const user = userEvent.setup();
    const action = vi
      .fn<Action>()
      .mockResolvedValue({ errors: { password: WRONG }, lockout: LOCKOUT });
    render(<LogInForm action={action} initial={{ lockout: null }} />);

    await user.type(screen.getByLabelText('Password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText(LOCKOUT.notice)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Log in' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Log in' })).toHaveAccessibleDescription(MEANWHILE);
    await expect(axe.run(document.body, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });

  it('[IHM-07] [CA-IHM-03] sends nothing while logins are locked, and sends again once the lockout ends, without a reload', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const action = vi.fn<Action>().mockResolvedValue({ lockout: null });
    render(<LogInForm action={action} initial={{ lockout: LOCKOUT }} />);

    act(() => {
      vi.advanceTimersByTime(15 * MINUTE - 1);
    });
    expect(screen.getByRole('button', { name: 'Log in' })).toBeDisabled();
    expect(screen.getByText(LOCKOUT.notice)).toBeVisible();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    vi.useRealTimers();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Password'), PASSWORD);
    await user.keyboard('{Enter}');

    expect(screen.queryByText(LOCKOUT.notice)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled();
    expect(action).toHaveBeenCalledOnce();
  });

  it('[IHM-07] lifts at once a lockout that ended before the form showed', async () => {
    const user = userEvent.setup();
    const action = vi.fn<Action>().mockResolvedValue({ lockout: null });
    const ended = { ...LOCKOUT, until: toEpochMs(START - MINUTE) };
    render(<LogInForm action={action} initial={{ lockout: ended }} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled();
    });
    await user.type(screen.getByLabelText('Password'), PASSWORD);
    await user.keyboard('{Enter}');

    expect(action).toHaveBeenCalledOnce();
  });
});
