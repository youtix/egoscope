import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';

import { CopyButton } from './copy-button';
import { LongText } from './long-text';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

const PROMPT = 'You are a research assistant. Return JSON.';

/** The prompt of a request, shown, with its copy button. */
function renderPrompt(onCopied?: () => void): void {
  render(
    <>
      <LongText label="Prompt" text={PROMPT} id="prompt" />
      <CopyButton
        text={PROMPT}
        label="Copy the prompt"
        copiedMessage="Prompt copied"
        fallbackMessage="Copy refused: the prompt is selected, copy it with a long press."
        selectTargetId="prompt"
        {...(onCopied === undefined ? {} : { onCopied })}
      />
    </>,
  );
}

describe('CopyButton', () => {
  it('[IHM-39] puts the whole text on the clipboard in one touch and confirms it', async () => {
    const user = userEvent.setup();
    const onCopied = vi.fn();
    renderPrompt(onCopied);

    await user.click(screen.getByRole('button', { name: 'Copy the prompt' }));

    expect(await navigator.clipboard.readText()).toBe(PROMPT);
    expect(await screen.findByRole('status')).toHaveTextContent('Prompt copied');
    expect(onCopied).toHaveBeenCalledOnce();
  });

  it('selects the text and explains the long press when the phone refuses the clipboard', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
      new DOMException('Refused', 'NotAllowedError'),
    );
    const onCopied = vi.fn();
    renderPrompt(onCopied);

    await user.click(screen.getByRole('button', { name: 'Copy the prompt' }));

    expect(await screen.findByText(/copy it with a long press/u)).toBeVisible();
    expect(globalThis.getSelection()?.toString()).toBe(PROMPT);
    expect(onCopied).not.toHaveBeenCalled();
  });

  it('only explains the long press when it has no text on the screen to select', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
      new DOMException('Refused', 'NotAllowedError'),
    );
    render(
      <CopyButton
        text="Correct event 3."
        label="Copy the correction message"
        variant="secondary"
        copiedMessage="Message copied"
        fallbackMessage="Copy refused: copy the message with a long press."
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Copy the correction message' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Copy refused: copy the message with a long press.',
    );
  });

  it('selects nothing when the text it names is not on the screen', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
      new DOMException('Refused', 'NotAllowedError'),
    );
    render(
      <CopyButton
        text={PROMPT}
        label="Copy the prompt"
        copiedMessage="Prompt copied"
        fallbackMessage="Copy refused: copy the prompt with a long press."
        selectTargetId="missing-prompt"
      />,
    );
    globalThis.getSelection()?.removeAllRanges();

    await user.click(screen.getByRole('button', { name: 'Copy the prompt' }));

    expect(
      await screen.findByText('Copy refused: copy the prompt with a long press.'),
    ).toBeVisible();
    expect(globalThis.getSelection()?.toString()).toBe('');
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules once it confirmed', async () => {
    const user = userEvent.setup();
    renderPrompt();

    await user.click(screen.getByRole('button', { name: 'Copy the prompt' }));
    await screen.findByText('Prompt copied');

    await expect(axe.run(document.body, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
