import { render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { Pagination } from './pagination';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

describe('Pagination', () => {
  it('[IHM-18] leads to the previous and the next slice, around where the list stands', () => {
    render(
      <Pagination
        label="Pages of the players"
        status="Page 2 of 5"
        previous={{ href: '/?page=1', label: 'Previous page' }}
        next={{ href: '/?page=3', label: 'Next page' }}
      />,
    );

    const pages = screen.getByRole('navigation', { name: 'Pages of the players' });
    expect(within(pages).getByRole('link', { name: 'Previous page' })).toHaveAttribute(
      'href',
      '/?page=1',
    );
    expect(within(pages).getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      '/?page=3',
    );
    expect(within(pages).getByText('Page 2 of 5')).toBeVisible();
  });

  it('offers no link beyond the first and the last slice', () => {
    render(<Pagination label="Pages of the players" status="Page 1 of 1" />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('Page 1 of 1')).toBeVisible();
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules', async () => {
    const { container } = render(
      <Pagination
        label="Pages of the players"
        status="Page 1 of 5"
        next={{ href: '/?page=2', label: 'Next page' }}
      />,
    );

    await expect(axe.run(container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
