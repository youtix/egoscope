import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShareButton } from './share-button';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

const PROMPT = 'You are a research assistant. Return JSON.';

/** Gives the page the phone's share sheet, which `share` stands for. */
function installShareSheet(share: (data: ShareData) => Promise<void>): void {
  Object.defineProperty(navigator, 'share', { value: share, configurable: true });
}

/** The share button of a request. */
function renderShare(): void {
  render(
    <ShareButton
      text={PROMPT}
      label="Share"
      copiedMessage="Prompt copied, to paste where you want"
      fallbackMessage="Copy refused: copy the prompt with a long press."
    />,
  );
}

describe('ShareButton', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'share');
  });

  it("hands the whole text to the phone's share sheet", async () => {
    const user = userEvent.setup();
    const share = vi.fn<(data: ShareData) => Promise<void>>(async () => {
      await Promise.resolve();
    });
    installShareSheet(share);
    renderShare();

    await user.click(screen.getByRole('button', { name: 'Share' }));

    expect(share).toHaveBeenCalledWith({ text: PROMPT });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('copies the text instead where the phone has no share sheet, and says so', async () => {
    const user = userEvent.setup();
    renderShare();

    await user.click(screen.getByRole('button', { name: 'Share' }));

    expect(await navigator.clipboard.readText()).toBe(PROMPT);
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Prompt copied, to paste where you want',
    );
  });

  it('copies the text instead when the share sheet fails', async () => {
    const user = userEvent.setup();
    installShareSheet(async () => {
      await Promise.reject(new DOMException('No target', 'NotAllowedError'));
    });
    renderShare();

    await user.click(screen.getByRole('button', { name: 'Share' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Prompt copied, to paste where you want',
    );
  });

  it('does nothing when the owner closes the share sheet', async () => {
    const user = userEvent.setup();
    const copy = vi.spyOn(navigator.clipboard, 'writeText');
    installShareSheet(async () => {
      await Promise.reject(new DOMException('Closed', 'AbortError'));
    });
    renderShare();

    await user.click(screen.getByRole('button', { name: 'Share' }));

    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(copy).not.toHaveBeenCalled();
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules', async () => {
    const { container } = render(
      <ShareButton
        text={PROMPT}
        label="Share"
        copiedMessage="Prompt copied"
        fallbackMessage="Copy refused."
        selectTargetId="prompt"
      />,
    );

    await expect(axe.run(container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
