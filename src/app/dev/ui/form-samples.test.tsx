import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ChangedElsewhereSample, FieldsSample, PendingSample } from './form-samples';

describe('FieldsSample', () => {
  it('shows a box checked at first beside one that is not', () => {
    render(<FieldsSample />);

    expect(screen.getByRole('checkbox', { name: 'Keep a copy' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'I have read the explanation' })).not.toBeChecked();
  });

  it('refuses an empty name, reason and box, in the summary and beside each field', async () => {
    const user = userEvent.setup();
    render(<FieldsSample />);

    await user.click(screen.getByRole('button', { name: 'Save' }));

    const summary = await screen.findByRole('alert', { name: 'The sample was not saved' });
    expect(within(summary).getByText('Nothing was saved: correct the fields below.')).toBeVisible();
    expect(
      within(summary)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toStrictEqual([
      'Enter a display name.',
      'Choose a reason.',
      'Check that you have read the explanation.',
    ]);
    expect(screen.getByRole('textbox', { name: 'Display name' })).toBeInvalid();
    expect(screen.getByRole('radiogroup', { name: 'Reason' })).toBeInvalid();
    expect(screen.getByRole('checkbox', { name: 'I have read the explanation' })).toBeInvalid();
  });

  it('saves a sample with a name, a reason and the box checked, and says so', async () => {
    const user = userEvent.setup();
    render(<FieldsSample />);

    await user.type(screen.getByRole('textbox', { name: 'Display name' }), 'Sample');
    await user.click(screen.getByRole('radio', { name: 'Duplicate' }));
    await user.click(screen.getByRole('checkbox', { name: 'I have read the explanation' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('The sample is saved.')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('PendingSample', () => {
  it('shows its submit button waiting once pressed, until the wait is ended', async () => {
    const user = userEvent.setup();
    render(<PendingSample />);

    const send = screen.getByRole('button', { name: 'Send the sample' });
    await user.click(send);

    await waitFor(() => {
      expect(send).toHaveAttribute('aria-disabled', 'true');
    });
    expect(send).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'End the wait' }));
    await waitFor(() => {
      expect(send).not.toHaveAttribute('aria-disabled');
    });
  });

  it('ends nothing before it is sent', async () => {
    const user = userEvent.setup();
    render(<PendingSample />);

    await user.click(screen.getByRole('button', { name: 'End the wait' }));

    expect(screen.getByRole('button', { name: 'Send the sample' })).not.toHaveAttribute(
      'aria-disabled',
    );
  });
});

describe('ChangedElsewhereSample', () => {
  it('[CL-IHM-18] shows the current version beside the input, which stays to be applied again', async () => {
    const user = userEvent.setup();
    render(<ChangedElsewhereSample />);

    const note = screen.getByRole('textbox', { name: 'Note' });
    await user.type(note, ' And at noon.');
    await user.click(screen.getByRole('button', { name: 'Save the note' }));

    const notice = await screen.findByRole('alert');
    expect(
      within(notice).getByText('Read every morning, before the first game of the day.'),
    ).toBeVisible();
    expect(note).toHaveValue('Read every evening. And at noon.');
  });
});
