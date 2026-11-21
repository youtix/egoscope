import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { FormField } from './form-field';
import { TextInput } from './text-input';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

describe('TextInput', () => {
  it('starts with its stored value and takes what the owner types', async () => {
    const user = userEvent.setup();
    render(
      <FormField name="name" label="Name">
        <TextInput defaultValue="Daily" />
      </FormField>,
    );

    await user.type(screen.getByRole('textbox', { name: 'Name' }), ' Hoops');

    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Daily Hoops');
  });

  it('asks the phone for the keyboard and the filling that its value needs', () => {
    render(
      <FormField name="q" label="Search by name">
        <TextInput type="search" inputMode="search" enterKeyHint="search" autoComplete="off" />
      </FormField>,
    );

    const search = screen.getByRole('searchbox', { name: 'Search by name' });
    expect(search).toHaveAttribute('inputmode', 'search');
    expect(search).toHaveAttribute('enterkeyhint', 'search');
    expect(search).toHaveAttribute('autocomplete', 'off');
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules', async () => {
    const { container } = render(
      <FormField name="address" label="Research tool address">
        <TextInput type="url" />
      </FormField>,
    );

    await expect(axe.run(container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
