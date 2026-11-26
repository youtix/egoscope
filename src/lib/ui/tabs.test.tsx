import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { Tabs } from './tabs';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

const ITEMS = [
  { value: 'sources', label: 'Sources', panel: <p>Every source and its health.</p> },
  { value: 'queue', label: 'Queue', panel: <p>The articles waiting for classification.</p> },
  { value: 'log', label: 'Log', panel: <p>What each run read.</p> },
];

describe('Tabs', () => {
  it('[IHM-62] names its list, and shows the first panel at first', () => {
    render(<Tabs label="Collection and detection" items={ITEMS} />);

    expect(screen.getByRole('tablist', { name: 'Collection and detection' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Sources' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Sources' })).toHaveTextContent(
      'Every source and its health.',
    );
  });

  it('starts on the tab it is told', () => {
    render(<Tabs label="Collection and detection" items={ITEMS} defaultValue="log" />);

    expect(screen.getByRole('tabpanel', { name: 'Log' })).toHaveTextContent('What each run read.');
  });

  it('moves between its tabs with the arrow keys and shows the focused one on Enter', async () => {
    const user = userEvent.setup();
    render(<Tabs label="Collection and detection" items={ITEMS} />);

    await user.tab();
    await user.keyboard('{ArrowRight}');
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Queue' })).toHaveFocus();
    });
    await user.keyboard('{Enter}');

    expect(screen.getByRole('tab', { name: 'Queue' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Queue' })).toHaveTextContent(
      'The articles waiting for classification.',
    );
  });

  it('shows the panel of the tab that a tap picks', async () => {
    const user = userEvent.setup();
    render(<Tabs label="Collection and detection" items={ITEMS} />);

    await user.click(screen.getByRole('tab', { name: 'Log' }));

    expect(screen.getByRole('tabpanel', { name: 'Log' })).toHaveTextContent('What each run read.');
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules', async () => {
    const { container } = render(<Tabs label="Collection and detection" items={ITEMS} />);

    await expect(axe.run(container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
