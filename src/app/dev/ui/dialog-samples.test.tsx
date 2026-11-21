import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { DialogSamples, PasteSample } from './dialog-samples';

describe('DialogSamples', () => {
  it('opens the sample dialog', async () => {
    const user = userEvent.setup();
    render(<DialogSamples />);

    await user.click(screen.getByRole('button', { name: 'Open the dialog' }));

    expect(await screen.findByRole('dialog', { name: 'A sample dialog' })).toBeVisible();
  });

  it('runs the sample action once its confirmation is agreed to', async () => {
    const user = userEvent.setup();
    render(<DialogSamples />);

    await user.click(screen.getByRole('button', { name: 'Archive the sample' }));
    await user.click(await screen.findByRole('button', { name: 'Archive' }));

    expect(await screen.findByText('The sample is archived.')).toBeVisible();
  });

  it('runs the erasing action once both of its questions are agreed to', async () => {
    const user = userEvent.setup();
    render(<DialogSamples />);

    await user.click(screen.getByRole('button', { name: 'Erase the sample' }));
    expect(await screen.findByText('Its history')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(await screen.findByRole('button', { name: 'Erase for good' }));

    expect(await screen.findByText('The sample is erased.')).toBeVisible();
  });
});

describe('PasteSample', () => {
  it('keeps the pasted text', async () => {
    const user = userEvent.setup();
    render(<PasteSample />);

    await user.click(screen.getByRole('textbox', { name: 'Pasted text' }));
    await user.paste('{"format": "1.0"}');

    expect(screen.getByRole('textbox', { name: 'Pasted text' })).toHaveValue('{"format": "1.0"}');
  });
});
