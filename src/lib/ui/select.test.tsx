import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { FormField } from './form-field';
import { Select } from './select';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

const ZONES = [
  { value: 'Europe/Paris', label: 'Paris time' },
  { value: 'America/New_York', label: 'New York time' },
];

describe('Select', () => {
  it('[IHM-62] offers its choices under its label, starting from the stored one', () => {
    render(
      <FormField name="zone" label="Time zone">
        <Select options={ZONES} defaultValue="America/New_York" />
      </FormField>,
    );

    const zone = screen.getByRole('combobox', { name: 'Time zone' });
    expect(zone).toHaveValue('America/New_York');
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toStrictEqual([
      'Paris time',
      'New York time',
    ]);
  });

  it('takes the choice the owner makes', async () => {
    const user = userEvent.setup();
    render(
      <FormField name="zone" label="Time zone">
        <Select options={ZONES} />
      </FormField>,
    );

    await user.selectOptions(screen.getByRole('combobox', { name: 'Time zone' }), 'New York time');

    expect(screen.getByRole('combobox', { name: 'Time zone' })).toHaveValue('America/New_York');
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules', async () => {
    const { container } = render(
      <FormField name="zone" label="Time zone">
        <Select options={ZONES} />
      </FormField>,
    );

    await expect(axe.run(container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
