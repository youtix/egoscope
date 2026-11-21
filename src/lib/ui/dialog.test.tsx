import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { Dialog } from './dialog';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

/** A dialog that explains how to install the app. */
function renderInstallHelp(): void {
  render(
    <Dialog
      triggerLabel="How to install"
      title="Install the app"
      description="Add Egoscope to the home screen from the browser's menu."
      closeLabel="Close"
    >
      <p>The app then opens full screen.</p>
    </Dialog>,
  );
}

describe('Dialog', () => {
  it('[IHM-62] opens from its button as a dialog named by its title and described by its sentence', async () => {
    const user = userEvent.setup();
    renderInstallHelp();

    await user.click(screen.getByRole('button', { name: 'How to install' }));

    const dialog = await screen.findByRole('dialog', { name: 'Install the app' });
    expect(dialog).toHaveAccessibleDescription(
      "Add Egoscope to the home screen from the browser's menu.",
    );
    expect(screen.getByText('The app then opens full screen.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('closes on Escape and gives the focus back to its button', async () => {
    const user = userEvent.setup();
    renderInstallHelp();

    await user.click(screen.getByRole('button', { name: 'How to install' }));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'How to install' })).toHaveFocus();
  });

  it('closes from its close button', async () => {
    const user = userEvent.setup();
    renderInstallHelp();

    await user.click(screen.getByRole('button', { name: 'How to install' }));
    await user.click(await screen.findByRole('button', { name: 'Close' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules, open', async () => {
    const user = userEvent.setup();
    renderInstallHelp();

    await user.click(screen.getByRole('button', { name: 'How to install' }));
    await screen.findByRole('dialog');

    await expect(axe.run(document.body, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
