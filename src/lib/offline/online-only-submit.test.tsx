import { act, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';

import { OnlineOnlySubmit } from './online-only-submit';

import type { ReactNode } from 'react';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };
const OFFLINE_REASON = 'Unavailable offline: connect to the internet to do this.';
const NO_TYPE = 'Validate a type first: a backtest needs one.';

/** A form whose action needs the server, with a field and the submit button. */
function ImportForm({ onSubmit }: Readonly<{ onSubmit: (text: string) => void }>): ReactNode {
  return (
    <form
      aria-label="Import"
      onSubmit={(event) => {
        event.preventDefault();
        const text = new FormData(event.currentTarget).get('text');
        onSubmit(typeof text === 'string' ? text : '');
      }}
    >
      <label>
        Pasted text
        <input name="text" />
      </label>
      <OnlineOnlySubmit label="Save the import" />
    </form>
  );
}

/** The device losing or finding its connection, as the browser says it. */
function connection(isOnline: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(isOnline);
  act(() => {
    globalThis.dispatchEvent(new Event(isOnline ? 'online' : 'offline'));
  });
}

describe('OnlineOnlySubmit', () => {
  it('[IHM-58] [CA-TRV-38] [CL-IHM-14] offline, is disabled with its reason, sends nothing, not even with Enter, and keeps what was typed', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    render(<ImportForm onSubmit={onSubmit} />);
    connection(false);

    await user.type(screen.getByLabelText('Pasted text'), 'A pasted research text{Enter}');
    await user.click(screen.getByRole('button', { name: 'Save the import' }));

    expect(screen.getByRole('button', { name: 'Save the import' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save the import' })).toHaveAccessibleDescription(
      OFFLINE_REASON,
    );
    expect(screen.getByLabelText('Pasted text')).toHaveValue('A pasted research text');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('[IHM-58] [CL-IHM-14] [H-IHM-07] sends nothing later when the network returns, and sends what was typed once the owner submits again', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    render(<ImportForm onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText('Pasted text'), 'A pasted research text{Enter}');

    connection(true);

    expect(screen.getByRole('button', { name: 'Save the import' })).toBeEnabled();
    expect(screen.queryByText(OFFLINE_REASON)).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Save the import' }));

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('A pasted research text');
  });

  it('says the reason of its own online, and the offline one in its place offline', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    render(<OnlineOnlySubmit label="Request a backtest" disabledReason={NO_TYPE} />);

    expect(screen.getByRole('button', { name: 'Request a backtest' })).toHaveAccessibleDescription(
      NO_TYPE,
    );

    connection(false);

    expect(screen.getByRole('button', { name: 'Request a backtest' })).toHaveAccessibleDescription(
      OFFLINE_REASON,
    );
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules online and offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const { container } = render(<ImportForm onSubmit={vi.fn()} />);

    await expect(axe.run(container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);

    connection(false);

    await expect(axe.run(container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
