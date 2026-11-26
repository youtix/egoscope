import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import axe from 'axe-core';
import { useActionState } from 'react';
import { describe, expect, it } from 'vitest';

import { Button } from './button';
import { Form } from './form';
import { RadioGroup } from './radio-group';

import type { FieldErrors } from './form-context';
import type { ReactNode } from 'react';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

const REASONS = [
  { value: 'wrong-player', label: 'Wrong player' },
  { value: 'wrong-date', label: 'Wrong date' },
  { value: 'duplicate', label: 'Duplicate' },
];

/** A form whose action refuses a missing choice. */
function Exclusion(): ReactNode {
  const [errors, dispatch] = useActionState(
    (_previous: FieldErrors, formData: FormData): FieldErrors =>
      formData.has('reason') ? {} : { reason: 'Choose why the case is excluded.' },
    {},
  );
  return (
    <Form action={dispatch} errors={errors} errorSummaryTitle="The case was not excluded">
      <RadioGroup
        name="reason"
        legend="Reason"
        hint="No reason concerns the performance."
        requiredMark="(required)"
        options={REASONS}
      />
      <Button type="submit" label="Exclude" />
    </Form>
  );
}

describe('RadioGroup', () => {
  it('[IHM-62] is a group named by its legend, described by its hint, with one choice per option', () => {
    render(<Exclusion />);

    const group = screen.getByRole('radiogroup', { name: 'Reason' });
    expect(group).toHaveAccessibleDescription('No reason concerns the performance.');
    expect(group).toBeRequired();
    expect(
      within(group)
        .getAllByRole('radio')
        .map((radio) => radio.getAttribute('value')),
    ).toStrictEqual(['wrong-player', 'wrong-date', 'duplicate']);
  });

  it('picks a choice from a tap on its words, and starts from the stored one', async () => {
    const user = userEvent.setup();
    render(<RadioGroup name="reason" legend="Reason" options={REASONS} defaultValue="duplicate" />);

    expect(screen.getByRole('radio', { name: 'Duplicate' })).toBeChecked();
    await user.click(screen.getByText('Wrong date'));
    expect(screen.getByRole('radio', { name: 'Wrong date' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Duplicate' })).not.toBeChecked();
  });

  it('[IHM-61] writes its error under its legend, and the summary links to its first choice', async () => {
    const user = userEvent.setup();
    render(<Exclusion />);

    await user.click(screen.getByRole('button', { name: 'Exclude' }));
    const summary = await screen.findByRole('alert', { name: 'The case was not excluded' });
    await waitFor(() => {
      expect(summary).toHaveFocus();
    });
    await user.click(screen.getByRole('link', { name: 'Choose why the case is excluded.' }));

    const group = screen.getByRole('radiogroup', { name: 'Reason' });
    expect(group).toBeInvalid();
    expect(group).toHaveAccessibleDescription(
      'No reason concerns the performance. Choose why the case is excluded.',
    );
    expect(screen.getByRole('radio', { name: 'Wrong player' })).toHaveFocus();
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules', async () => {
    const user = userEvent.setup();
    const { container } = render(<Exclusion />);

    await user.click(screen.getByRole('button', { name: 'Exclude' }));
    await screen.findByRole('alert');

    await expect(axe.run(container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
