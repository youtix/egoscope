import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import axe from 'axe-core';
import { useActionState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './button';
import { Form } from './form';
import { FormField } from './form-field';
import { TextInput } from './text-input';

import type { FieldErrors } from './form-context';
import type { ReactNode } from 'react';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

/** What the action of a screen answers, as a Server Action would through `useActionState`. */
type Answer = Readonly<{ errors?: FieldErrors; message?: string }>;

type ScreenProps = Readonly<{ answer: (formData: FormData) => Answer | Promise<Answer> }>;

/** A screen's form, wired as screens wire it: `useActionState` around an action. */
function SourceForm({ answer }: ScreenProps): ReactNode {
  const [state, dispatch] = useActionState(
    async (_previous: Answer, formData: FormData) => await answer(formData),
    {},
  );
  return (
    <Form
      action={dispatch}
      errors={state.errors}
      message={state.message}
      errorSummaryTitle="The source was not saved"
    >
      <FormField name="name" label="Name" hint="As the outlet writes it." requiredMark="required">
        <TextInput />
      </FormField>
      <FormField name="address" label="Feed address">
        <TextInput type="url" />
      </FormField>
      <Button type="submit" label="Save" variant="primary" />
    </Form>
  );
}

describe('Form', () => {
  it("sends the fields and the pressed button's form to its action", async () => {
    const user = userEvent.setup();
    const answer = vi.fn<(formData: FormData) => Answer>(() => ({}));
    render(<SourceForm answer={answer} />);

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Daily Hoops');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(answer).toHaveBeenCalledOnce();
    expect(answer.mock.calls[0]?.[0].get('name')).toBe('Daily Hoops');
  });

  it('[CL-IHM-18] keeps the input visible once the action has answered, to be sent again', async () => {
    const user = userEvent.setup();
    render(<SourceForm answer={() => ({ message: 'The server could not save the source.' })} />);

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Daily Hoops');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('The server could not save the source.')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Daily Hoops');
  });

  it('lists the refused fields in a summary that takes the focus, each linked to its control', async () => {
    const user = userEvent.setup();
    render(
      <SourceForm
        answer={() => ({
          errors: {
            name: 'Enter the name of the source.',
            address: 'Enter an address that starts with https://.',
          },
        })}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Save' }));

    const summary = await screen.findByRole('alert', { name: 'The source was not saved' });
    await waitFor(() => {
      expect(summary).toHaveFocus();
    });
    await user.click(
      screen.getByRole('link', { name: 'Enter an address that starts with https://.' }),
    );
    expect(screen.getByRole('textbox', { name: 'Feed address' })).toHaveFocus();
  });

  it('[IHM-61] writes each error beside its field, which says that it is invalid and why', async () => {
    const user = userEvent.setup();
    render(<SourceForm answer={() => ({ errors: { name: 'Enter the name of the source.' } })} />);

    await user.click(screen.getByRole('button', { name: 'Save' }));

    const name = await screen.findByRole('textbox', {
      name: 'Name',
      description: /Enter the name/u,
    });
    expect(name).toBeInvalid();
    expect(name).toHaveAccessibleDescription(
      'As the outlet writes it. Enter the name of the source.',
    );
    expect(screen.getByRole('textbox', { name: 'Feed address' })).toBeValid();
  });

  it('keeps the submit button focused and deaf to presses while the action runs', async () => {
    const user = userEvent.setup();
    const { promise, resolve } = Promise.withResolvers<Answer>();
    const answer = vi.fn(async () => await promise);
    render(<SourceForm answer={answer} />);

    const save = screen.getByRole('button', { name: 'Save' });
    await user.click(save);
    await user.click(save);

    expect(save).toHaveFocus();
    expect(save).toHaveAttribute('aria-disabled', 'true');
    resolve({});
    await waitFor(() => {
      expect(save).not.toHaveAttribute('aria-disabled');
    });
    expect(answer).toHaveBeenCalledOnce();
  });

  it('sends nothing on an Enter key when no submit button is shown', async () => {
    const user = userEvent.setup();
    const action = vi.fn();
    render(
      <Form action={action} errorSummaryTitle="The note was not saved">
        <FormField name="note" label="Note">
          <TextInput />
        </FormField>
      </Form>,
    );

    await user.type(screen.getByRole('textbox', { name: 'Note' }), 'Checked{Enter}');

    expect(action).not.toHaveBeenCalled();
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules, with its summary and its field errors', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <SourceForm
        answer={() => ({
          message: 'The server could not save the source.',
          errors: { name: 'Enter the name of the source.' },
        })}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('alert');

    await expect(axe.run(container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
