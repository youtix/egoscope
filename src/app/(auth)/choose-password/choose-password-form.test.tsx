import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';

import { ChoosePasswordForm } from './choose-password-form';

import type { ChoosePasswordState } from './actions';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };
const TOO_SHORT = 'This password is too short: use at least 12 characters.';

describe('the form of "Choose your password"', () => {
  type Action = (previous: ChoosePasswordState, formData: FormData) => Promise<ChoosePasswordState>;

  it('[IHM-06] offers the new password to the password manager, which can keep it, and shows it in clear on demand', async () => {
    const user = userEvent.setup();
    render(<ChoosePasswordForm action={vi.fn<Action>().mockResolvedValue({})} />);

    await user.type(screen.getByLabelText('New password'), 'chosen-meadow-violet-quartz');
    await user.click(screen.getByRole('button', { name: 'Show the password' }));

    expect(screen.getByLabelText('New password')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'text');
  });

  it('[TRV-60] tells a too-short password beside its field, with the minimum length, and keeps it to be corrected', async () => {
    const user = userEvent.setup();
    const action = vi.fn<Action>().mockResolvedValue({ errors: { password: TOO_SHORT } });
    render(<ChoosePasswordForm action={action} />);

    await user.type(screen.getByLabelText('New password'), 'eleven-char');
    await user.click(screen.getByRole('button', { name: 'Save the password' }));

    expect(
      await screen.findByRole('alert', { name: 'Your password was not saved' }),
    ).toHaveTextContent(TOO_SHORT);
    expect(screen.getByLabelText('New password')).toBeInvalid();
    expect(screen.getByLabelText('New password')).toHaveValue('eleven-char');
    await expect(axe.run(document.body, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });

  it('[TRV-64] says that the password cannot be saved now, on the whole form', async () => {
    const user = userEvent.setup();
    const message = 'The app cannot save your password right now: try again in a few minutes.';
    render(<ChoosePasswordForm action={vi.fn<Action>().mockResolvedValue({ message })} />);

    await user.type(screen.getByLabelText('New password'), 'chosen-meadow-violet-quartz');
    await user.click(screen.getByRole('button', { name: 'Save the password' }));

    expect(await screen.findByText(message)).toBeVisible();
  });
});
