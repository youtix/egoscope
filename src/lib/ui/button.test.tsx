import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './button';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

describe('Button', () => {
  it('[IHM-62] is named by its visible label, which screen readers say', () => {
    render(<Button label="Copy the prompt" />);

    expect(screen.getByRole('button', { name: 'Copy the prompt' })).toHaveTextContent(
      'Copy the prompt',
    );
  });

  it('runs its action on a click, and on Enter and Space from the keyboard', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button label="Verify" onClick={onClick} />);

    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await user.tab();
    await user.tab({ shift: true });
    await user.keyboard('{Enter}');
    await user.keyboard(' ');

    expect(screen.getByRole('button', { name: 'Verify' })).toHaveFocus();
    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it('[IHM-58] says why an unavailable action is disabled, under it and in its description', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button label="Save" disabledReason="Saving needs a connection." onClick={onClick} />);

    const button = screen.getByRole('button', { name: 'Save' });
    await user.click(button);

    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('Saving needs a connection.');
    expect(screen.getByText('Saving needs a connection.')).toBeVisible();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('submits the form that holds it when it is a submit button', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <form
        aria-label="Import"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <Button label="Save" type="submit" variant="primary" />
      </form>,
    );

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules in each of its variants and states', async () => {
    const { container } = render(
      <div>
        <Button label="Main" variant="primary" />
        <Button label="Other" variant="secondary" />
        <Button label="Delete" variant="danger" />
        <Button label="Later" variant="quiet" />
        <Button label="Save" disabledReason="Saving needs a connection." />
      </div>,
    );

    await expect(axe.run(container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
