import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { FormField } from './form-field';
import { TextInput } from './text-input';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

describe('FormField', () => {
  it('[IHM-62] names its control by its label and describes it by its hint', () => {
    render(
      <FormField name="team" label="Team" hint="The team the player plays for today.">
        <TextInput />
      </FormField>,
    );

    const team = screen.getByRole('textbox', { name: 'Team' });
    expect(team).toHaveAttribute('name', 'team');
    expect(team).toHaveAccessibleDescription('The team the player plays for today.');
    expect(team).not.toBeRequired();
  });

  it('marks a required field beside its label, and says so to screen readers through the control', () => {
    render(
      <FormField name="team" label="Team" requiredMark="(required)">
        <TextInput />
      </FormField>,
    );

    expect(screen.getByText('(required)')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Team' })).toBeRequired();
  });

  it('gives two fields of one name, outside a form, controls of their own', () => {
    render(
      <>
        <FormField name="team" label="Current team">
          <TextInput />
        </FormField>
        <FormField name="team" label="Former team">
          <TextInput />
        </FormField>
      </>,
    );

    expect(screen.getByRole('textbox', { name: 'Current team' }).id).not.toBe(
      screen.getByRole('textbox', { name: 'Former team' }).id,
    );
  });

  it('refuses a control outside a field, which would have no label', () => {
    expect(() => render(<TextInput />)).toThrow(
      'TextInput renders only inside a FormField, which labels it.',
    );
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules', async () => {
    const { container } = render(
      <FormField
        name="team"
        label="Team"
        hint="The team the player plays for today."
        requiredMark="(required)"
      >
        <TextInput />
      </FormField>,
    );

    await expect(axe.run(container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
