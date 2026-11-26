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

type ReadTodoCount = () => Promise<number | null>;

/** The bar of a signed-in owner on the screen at `pathname`, which reads its count with `read`. */
function liveBarAt(pathname: string, todoCount: number | null, read: ReadTodoCount) {
  vi.mocked(usePathname).mockReturnValue(pathname);
  return <NavigationBar entries={LOT_1} todoCount={todoCount} readTodoCount={read} />;
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

  describe('the count after a move to another screen', () => {
    it('[IHM-16] reads the number of items to do again once each time the owner moves to another screen', async () => {
      const read = vi.fn<ReadTodoCount>().mockResolvedValue(7);
      const { rerender } = render(liveBarAt('/', 5, read));

      expect(screen.getByRole('link', { name: 'Home 5 to do' })).toBeVisible();
      expect(read).not.toHaveBeenCalled();
      rerender(liveBarAt('/players', 5, read));

      await expect(screen.findByRole('link', { name: 'Home 7 to do' })).resolves.toBeVisible();
      rerender(liveBarAt('/players', 5, read));
      read.mockResolvedValue(2);
      rerender(liveBarAt('/types', 5, read));

      await expect(screen.findByRole('link', { name: 'Home 2 to do' })).resolves.toBeVisible();
      expect(read).toHaveBeenCalledTimes(2);
    });

    it('[IHM-16] shows no count once a read fails, or gives none', async () => {
      const read = vi.fn<ReadTodoCount>().mockRejectedValue(new TypeError('Failed to fetch'));
      const { rerender } = render(liveBarAt('/', 5, read));

      rerender(liveBarAt('/players', 5, read));

      await expect(screen.findByRole('link', { name: 'Home' })).resolves.toBeVisible();
      read.mockResolvedValue(4);
      rerender(liveBarAt('/types', 5, read));
      await expect(screen.findByRole('link', { name: 'Home 4 to do' })).resolves.toBeVisible();
      read.mockResolvedValue(null);
      rerender(liveBarAt('/more', 5, read));
      await expect(screen.findByRole('link', { name: 'Home' })).resolves.toBeVisible();
    });

    it('[IHM-16] shows a new count from the server over the one it read', async () => {
      const read = vi.fn<ReadTodoCount>().mockResolvedValue(7);
      const { rerender } = render(liveBarAt('/', 5, read));
      rerender(liveBarAt('/players', 5, read));
      await screen.findByRole('link', { name: 'Home 7 to do' });

      rerender(liveBarAt('/players', 9, read));

      expect(screen.getByRole('link', { name: 'Home 9 to do' })).toBeVisible();
      expect(read).toHaveBeenCalledOnce();
    });

    it('[IHM-16] keeps the answer of the last move when an earlier read answers after it', async () => {
      const first = Promise.withResolvers<number | null>();
      const read = vi
        .fn<ReadTodoCount>()
        .mockReturnValueOnce(first.promise)
        .mockResolvedValueOnce(8);
      const { rerender } = render(liveBarAt('/', 5, read));
      rerender(liveBarAt('/players', 5, read));
      rerender(liveBarAt('/types', 5, read));
      await screen.findByRole('link', { name: 'Home 8 to do' });

      first.resolve(7);
      await first.promise;

      expect(screen.getByRole('link', { name: 'Home 8 to do' })).toBeVisible();
    });
  });
});
