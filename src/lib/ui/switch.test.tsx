import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './button';
import { Form } from './form';
import { Switch } from './switch';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

describe('Switch', () => {
  it('[IHM-62] is a switch named by its label and described by its hint', () => {
    render(<Switch name="active" label="Active" hint="An inactive source is not read." />);

    const active = screen.getByRole('switch', { name: 'Active' });
    expect(active).not.toBeChecked();
    expect(active).toHaveAccessibleDescription('An inactive source is not read.');
  });

  it('turns on a tap on its label and off with the Space key', async () => {
    const user = userEvent.setup();
    render(<Switch name="active" label="Active" />);

    await user.click(screen.getByText('Active'));
    expect(screen.getByRole('switch', { name: 'Active' })).toBeChecked();
    await user.keyboard(' ');
    expect(screen.getByRole('switch', { name: 'Active' })).not.toBeChecked();
  });

  it('sends "on" under its name when on', async () => {
    const user = userEvent.setup();
    const action = vi.fn<(formData: FormData) => void>();
    render(
      <Form action={action} errorSummaryTitle="The source was not saved">
        <Switch name="active" label="Active" defaultChecked />
        <Button type="submit" label="Save" />
      </Form>,
    );

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(action.mock.calls[0]?.[0].get('active')).toBe('on');
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules, on and off', async () => {
    const { container } = render(
      <div>
        <Switch name="active" label="Active" hint="An inactive source is not read." />
        <Switch name="muted" label="Muted" defaultChecked />
      </div>,
    );

    await expect(axe.run(container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
