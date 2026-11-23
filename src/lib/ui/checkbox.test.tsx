import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import axe from 'axe-core';
import { useActionState } from 'react';
import { describe, expect, it } from 'vitest';

import { Button } from './button';
import { Checkbox } from './checkbox';
import { Form } from './form';

import type { FieldErrors } from './form-context';
import type { ReactNode } from 'react';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

/** A form whose action refuses an unchecked box. */
function Attestation(): ReactNode {
  const [errors, dispatch] = useActionState(
    (_previous: FieldErrors, formData: FormData): FieldErrors =>
      formData.get('public') === 'on' ? {} : { public: 'Confirm that the source is public.' },
    {},
  );
  return (
    <Form action={dispatch} errors={errors} errorSummaryTitle="The source was not added">
      <Checkbox
        name="public"
        label="This is public sports press"
        hint="Private newsletters and paid feeds are refused."
      />
      <Button type="submit" label="Add" />
    </Form>
  );
}

describe('Checkbox', () => {
  it('[IHM-62] is named by the words beside it, which a tap also checks, and described by its hint', async () => {
    const user = userEvent.setup();
    render(<Attestation />);

    const box = screen.getByRole('checkbox', { name: 'This is public sports press' });
    await user.click(screen.getByText('This is public sports press'));

    expect(box).toBeChecked();
    expect(box).toHaveAccessibleDescription('Private newsletters and paid feeds are refused.');
  });

  it('toggles with the Space key and starts checked when told', async () => {
    const user = userEvent.setup();
    render(<Checkbox name="mute" label="Mute this source" defaultChecked />);

    await user.tab();
    await user.keyboard(' ');

    expect(screen.getByRole('checkbox', { name: 'Mute this source' })).not.toBeChecked();
  });

  it('[IHM-61] writes its error beside it and says it is invalid', async () => {
    const user = userEvent.setup();
    render(<Attestation />);

    await user.click(screen.getByRole('button', { name: 'Add' }));

    const box = await screen.findByRole('checkbox', {
      description: /Confirm that the source is public/u,
    });
    expect(box).toBeInvalid();
    expect(box).toHaveAccessibleDescription(
      'Private newsletters and paid feeds are refused. Confirm that the source is public.',
    );
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules', async () => {
    const user = userEvent.setup();
    const { container } = render(<Attestation />);

    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByRole('alert');

    await expect(axe.run(container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
