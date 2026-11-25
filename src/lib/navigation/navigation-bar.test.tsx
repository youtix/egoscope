import { render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { usePathname } from 'next/navigation';
import { describe, expect, it, vi } from 'vitest';

import { NavigationBar } from './navigation-bar';

import type { NavigationEntry, NavigationLink } from './entries';

vi.mock(import('next/navigation'), async (importOriginal) => ({
  ...(await importOriginal()),
  usePathname: vi.fn(),
}));

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

const LOT_1: readonly NavigationLink<NavigationEntry>[] = [
  { entry: 'home', href: '/', label: 'Home' },
  { entry: 'players', href: '/players', label: 'Players' },
  { entry: 'types', href: '/types', label: 'Types' },
  { entry: 'more', href: '/more', label: 'More' },
];

/** The navigation bar on the screen at `pathname`. */
function renderAt(pathname: string, todoCount: number | null = null) {
  vi.mocked(usePathname).mockReturnValue(pathname);
  return render(<NavigationBar entries={LOT_1} todoCount={todoCount} />);
}

/** The names of the links of the navigation bar, in their order. */
const linkNames = (): readonly string[] =>
  within(screen.getByRole('navigation'))
    .getAllByRole('link')
    .map((link) => link.textContent);

describe('NavigationBar', () => {
  it('[IHM-16] links to every entry it is given, in its order', () => {
    renderAt('/');

    expect(linkNames()).toStrictEqual(['Home', 'Players', 'Types', 'More']);
    expect(screen.getByRole('link', { name: 'Types' })).toHaveAttribute('href', '/types');
  });

  it('[IHM-16] [IHM-61] carries the number of items to do on the Home entry, said in words', () => {
    renderAt('/players', 1234);

    expect(screen.getByRole('link', { name: 'Home 1,234 to do' })).toHaveAttribute('href', '/');
    expect(screen.getByText('1,234')).toHaveAttribute('aria-hidden', 'true');
  });

  it('[IHM-16] shows a count of zero, and no count while it is unknown', () => {
    const { unmount } = renderAt('/', 0);

    expect(screen.getByRole('link', { name: 'Home 0 to do' })).toBeVisible();
    unmount();
    renderAt('/');

    expect(screen.getByRole('link', { name: 'Home' })).toBeVisible();
  });

  it('[IHM-61] tells screen readers which entry holds the current screen, below it too', () => {
    renderAt('/players/3f2b8c1e/edit');

    expect(screen.getByRole('link', { name: 'Players' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
  });

  it('[IHM-16] marks Home only on the Home screen itself', () => {
    renderAt('/');

    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'More' })).not.toHaveAttribute('aria-current');
  });

  it('[IHM-16] marks no entry on a screen that none of them leads to', () => {
    renderAt('/settings/account');

    expect(screen.queryByRole('link', { current: 'page' })).not.toBeInTheDocument();
  });

  it('[IHM-01] [CL-IHM-08] passes the accessibility rules, with and without a count', async () => {
    const { container, unmount } = renderAt('/types', 3);
    const { violations } = await axe.run(container, WCAG_22_AA);

    expect(violations).toStrictEqual([]);
    unmount();
    const view = renderAt('/');
    const withoutCount = await axe.run(view.container, WCAG_22_AA);

    expect(withoutCount.violations).toStrictEqual([]);
  });
});
