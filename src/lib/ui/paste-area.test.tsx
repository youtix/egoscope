import { fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import axe from 'axe-core';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { FormField } from './form-field';
import { PasteArea } from './paste-area';

import type { ReactNode } from 'react';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

const RESULT = '{"format": "1.0", "events": [{"quote": "It\'s over"}]}';
// The largest file that the import screen of these tests reads, in bytes.
const MAX_FILE_BYTES = 100;

/** The paste area of the import screen, which keeps its text as the screen's draft. */
function ImportField(): ReactNode {
  const [text, setText] = useState('');
  return (
    <FormField name="result" label="Research result">
      <PasteArea
        value={text}
        onValueChange={setText}
        pasteLabel="Paste"
        pasteRefusedMessage="Paste refused: hold a finger on the area, then choose Paste."
        fileLabel="Choose a text file"
        maxFileBytes={MAX_FILE_BYTES}
        fileTooLargeMessage="This file is too large for a research result."
        fileUnreadableMessage="This file cannot be read as text."
      />
    </FormField>
  );
}

describe('PasteArea', () => {
  it('[IHM-28] turns off autocorrection, smart punctuation, automatic capitals and the spelling check', () => {
    render(<ImportField />);

    const area = screen.getByRole('textbox', { name: 'Research result' });
    expect(area).toHaveAttribute('autocorrect', 'off');
    expect(area).toHaveAttribute('autocapitalize', 'off');
    expect(area).toHaveAttribute('autocomplete', 'off');
    expect(area).toHaveAttribute('spellcheck', 'false');
  });

  it('[IHM-28] keeps a pasted text as it was copied', async () => {
    const user = userEvent.setup();
    render(<ImportField />);

    await user.click(screen.getByRole('textbox', { name: 'Research result' }));
    await user.paste(RESULT);

    expect(screen.getByRole('textbox', { name: 'Research result' })).toHaveValue(RESULT);
  });

  it('[IHM-28] inserts the clipboard from its paste button', async () => {
    const user = userEvent.setup();
    render(<ImportField />);
    await navigator.clipboard.writeText(RESULT);

    await user.click(screen.getByRole('button', { name: 'Paste' }));

    expect(await screen.findByDisplayValue(RESULT)).toBeVisible();
  });

  it('[IHM-28] explains the long press when the phone refuses the clipboard', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'readText').mockRejectedValue(
      new DOMException('Refused', 'NotAllowedError'),
    );
    render(<ImportField />);

    await user.click(screen.getByRole('button', { name: 'Paste' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Paste refused: hold a finger on the area, then choose Paste.',
    );
    expect(screen.getByRole('textbox', { name: 'Research result' })).toHaveValue('');
  });

  it('[IHM-28] reads a text file instead, up to the size it is given', async () => {
    const user = userEvent.setup();
    render(<ImportField />);

    await user.click(screen.getByRole('button', { name: 'Choose a text file' }));
    await user.upload(
      screen.getByLabelText('Choose a text file'),
      new File([RESULT], 'result.json'),
    );

    expect(await screen.findByDisplayValue(RESULT)).toBeVisible();
  });

  it('[IHM-28] refuses a file larger than its size limit, and keeps the text it had', async () => {
    const user = userEvent.setup();
    render(<ImportField />);

    await user.type(screen.getByRole('textbox', { name: 'Research result' }), 'draft');
    await user.upload(
      screen.getByLabelText('Choose a text file'),
      new File(['x'.repeat(MAX_FILE_BYTES + 1)], 'result.json'),
    );

    expect(await screen.findByText('This file is too large for a research result.')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Research result' })).toHaveValue('draft');
  });

  it('reads a file of exactly its size limit', async () => {
    const user = userEvent.setup();
    render(<ImportField />);

    await user.upload(
      screen.getByLabelText('Choose a text file'),
      new File(['x'.repeat(MAX_FILE_BYTES)], 'result.txt'),
    );

    expect(await screen.findByDisplayValue('x'.repeat(MAX_FILE_BYTES))).toBeVisible();
  });

  it.each([
    ['an empty list', []],
    ['no list at all', null],
  ])('keeps its text when the file picker closes with %s', async (_case, files) => {
    const user = userEvent.setup();
    render(<ImportField />);
    await user.type(screen.getByRole('textbox', { name: 'Research result' }), 'draft');

    // A picker closed without a file changes its selection to none, which no user-event call does.
    fireEvent.change(screen.getByLabelText('Choose a text file'), { target: { files } });

    expect(screen.getByRole('textbox', { name: 'Research result' })).toHaveValue('draft');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('says so when a file cannot be read as text', async () => {
    const user = userEvent.setup();
    const file = new File([RESULT], 'result.json');
    vi.spyOn(file, 'text').mockRejectedValue(new DOMException('Unreadable', 'NotReadableError'));
    render(<ImportField />);

    await user.upload(screen.getByLabelText('Choose a text file'), file);

    expect(await screen.findByText('This file cannot be read as text.')).toBeVisible();
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules, with a message shown', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'readText').mockRejectedValue(
      new DOMException('Refused', 'NotAllowedError'),
    );
    const { container } = render(<ImportField />);

    await user.click(screen.getByRole('button', { name: 'Paste' }));
    await screen.findByText(/Paste refused/u);

    await expect(axe.run(container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
