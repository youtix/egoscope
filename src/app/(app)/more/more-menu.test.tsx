import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { MoreMenu } from './more-menu';

import type { MoreMenuEntry, NavigationLink } from '@/lib/navigation';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

const ENTRIES: readonly NavigationLink<MoreMenuEntry>[] = [
  { entry: 'backtest_requests', href: '/backtests', label: 'Backtest requests' },
  { entry: 'profiles', href: '/profiles', label: 'Profiles' },
  { entry: 'help', href: '/help', label: 'Help' },
];

describe('MoreMenu', () => {
  it('[IHM-16] [CL-IHM-25] links to each entry it is given, in its order', () => {
    render(<MoreMenu entries={ENTRIES} />);

    expect(screen.getAllByRole('link').map((link) => link.textContent)).toStrictEqual([
      'Backtest requests',
      'Profiles',
      'Help',
    ]);
    expect(screen.getByRole('link', { name: 'Profiles' })).toHaveAttribute('href', '/profiles');
  });

  it('[IHM-16] holds its entries in one list, which the accessibility rules accept', async () => {
    const { container } = render(<MoreMenu entries={ENTRIES} />);

    expect(screen.getAllByRole('listitem')).toHaveLength(ENTRIES.length);
    const { violations } = await axe.run(container, WCAG_22_AA);

    expect(violations).toStrictEqual([]);
  });
});
