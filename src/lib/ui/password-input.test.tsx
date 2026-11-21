import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { FormField } from './form-field';
import { PasswordInput } from './password-input';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

/** The password field of the log-in screen. */
function renderLogIn(): void {
  render(
    <FormField name="password" label="Password">
      <PasswordInput autoComplete="current-password" revealLabel="Show the password" />
    </FormField>,
  );
}

describe('PasswordInput', () => {
  it('[IHM-06] hides the password, which a password manager can fill', () => {
    renderLogIn();

    const password = screen.getByLabelText('Password');
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByRole('button', { name: 'Show the password' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('[IHM-06] shows the password in clear while its toggle is pressed, from the keyboard too', async () => {
    const user = userEvent.setup();
    renderLogIn();

    const toggle = screen.getByRole('button', { name: 'Show the password' });
    await user.click(toggle);

    expect(screen.getByRole('textbox', { name: 'Password' })).toHaveAttribute('type', 'text');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules', async () => {
    renderLogIn();

    await expect(axe.run(document.body, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
