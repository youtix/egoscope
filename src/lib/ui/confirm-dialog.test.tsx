import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmDialog } from './confirm-dialog';
import { Form } from './form';
import { FormField } from './form-field';
import { Textarea } from './textarea';

import type { ConfirmationStep } from './confirm-dialog';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

const LAST_QUESTION: ConfirmationStep = {
  title: 'Delete for good?',
  description: 'The data cannot be recovered.',
  confirmLabel: 'Delete for good',
};

type Action = (formData: FormData) => void;

/** A form whose submission a confirmation guards, asked once or, with `secondStep`, twice. */
function renderCancellation(action: Action, secondStep?: ConfirmationStep): void {
  render(
    <Form action={action} errorSummaryTitle="The request was not canceled">
      <FormField name="reason" label="Reason">
        <Textarea />
      </FormField>
      <ConfirmDialog
        triggerLabel="Cancel the request"
        variant="danger"
        title="Cancel this request?"
        description="The prompt can no longer be pasted back."
        confirmLabel="Yes, cancel it"
        cancelLabel="Keep the request"
        {...(secondStep === undefined ? {} : { secondStep })}
      >
        <p>The request moves to the canceled ones.</p>
      </ConfirmDialog>
    </Form>,
  );
}

describe('ConfirmDialog', () => {
  it('[IHM-62] asks its question in a dialog named by it, the focus on the button that does nothing', async () => {
    const user = userEvent.setup();
    renderCancellation(vi.fn<Action>());

    await user.click(screen.getByRole('button', { name: 'Cancel the request' }));

    const dialog = await screen.findByRole('alertdialog', { name: 'Cancel this request?' });
    expect(dialog).toHaveAccessibleDescription('The prompt can no longer be pasted back.');
    expect(screen.getByText('The request moves to the canceled ones.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Keep the request' })).toHaveFocus();
  });

  it("submits the form, with the owner's input, only once confirmed", async () => {
    const user = userEvent.setup();
    const action = vi.fn<Action>();
    renderCancellation(action);

    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'Asked by mistake.');
    await user.click(screen.getByRole('button', { name: 'Cancel the request' }));
    expect(action).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: 'Yes, cancel it' }));

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    expect(action).toHaveBeenCalledOnce();
    expect(action.mock.calls[0]?.[0].get('reason')).toBe('Asked by mistake.');
  });

  it('closes without acting on its cancel button and on Escape', async () => {
    const user = userEvent.setup();
    const action = vi.fn<Action>();
    renderCancellation(action);

    await user.click(screen.getByRole('button', { name: 'Cancel the request' }));
    await user.click(await screen.findByRole('button', { name: 'Keep the request' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'Cancel the request' }));
    await screen.findByRole('alertdialog');
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    expect(action).not.toHaveBeenCalled();
  });

  it('asks twice before an action that cannot be undone, the focus moving to the second question', async () => {
    const user = userEvent.setup();
    const action = vi.fn<Action>();
    renderCancellation(action, LAST_QUESTION);

    await user.click(screen.getByRole('button', { name: 'Cancel the request' }));
    await user.click(await screen.findByRole('button', { name: 'Yes, cancel it' }));

    const dialog = await screen.findByRole('alertdialog', { name: 'Delete for good?' });
    expect(dialog).toHaveAccessibleDescription('The data cannot be recovered.');
    expect(screen.getByRole('heading', { name: 'Delete for good?' })).toHaveFocus();
    expect(screen.queryByText('The request moves to the canceled ones.')).not.toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Delete for good' }));
    await waitFor(() => {
      expect(action).toHaveBeenCalledOnce();
    });
  });

  it('asks the first question again when it is opened anew', async () => {
    const user = userEvent.setup();
    renderCancellation(vi.fn<Action>(), LAST_QUESTION);

    await user.click(screen.getByRole('button', { name: 'Cancel the request' }));
    await user.click(await screen.findByRole('button', { name: 'Yes, cancel it' }));
    await user.click(await screen.findByRole('button', { name: 'Keep the request' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'Cancel the request' }));

    expect(await screen.findByRole('alertdialog', { name: 'Cancel this request?' })).toBeVisible();
  });

  it('refuses to render outside a Form, whose submission it confirms', () => {
    expect(() =>
      render(
        <ConfirmDialog
          triggerLabel="Delete"
          title="Delete?"
          description="This cannot be undone."
          confirmLabel="Delete"
          cancelLabel="Keep"
        />,
      ),
    ).toThrow('ConfirmDialog renders only inside a Form, whose submission it confirms.');
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules at each question', async () => {
    const user = userEvent.setup();
    renderCancellation(vi.fn<Action>(), LAST_QUESTION);

    await user.click(screen.getByRole('button', { name: 'Cancel the request' }));
    await screen.findByRole('alertdialog');
    await expect(axe.run(document.body, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
    await user.click(screen.getByRole('button', { name: 'Yes, cancel it' }));
    await screen.findByRole('alertdialog', { name: 'Delete for good?' });

    await expect(axe.run(document.body, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
