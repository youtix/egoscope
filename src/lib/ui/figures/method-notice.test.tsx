import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { MethodNotice } from './method-notice';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

describe('MethodNotice', () => {
  it('[IHM-50] [IHM-69] gives the short notice and links to Method and limits', () => {
    render(<MethodNotice href="/dev/ui" />);

    expect(
      screen.getByText('A measure of the past, an unproven hypothesis, no betting recommendation', {
        exact: true,
      }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Method and limits' })).toHaveAttribute(
      'href',
      '/dev/ui',
    );
  });

  it('[IHM-50] links to the page that its href names', () => {
    const { rerender } = render(<MethodNotice href="/dev/ui" />);
    const first = screen.getByRole('link', { name: 'Method and limits' }).getAttribute('href');

    rerender(<MethodNotice href="/api/health" />);
    const second = screen.getByRole('link', { name: 'Method and limits' }).getAttribute('href');

    expect([first, second]).toStrictEqual(['/dev/ui', '/api/health']);
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules', async () => {
    const { container } = render(<MethodNotice href="/dev/ui" />);

    const results = await axe.run(container, WCAG_22_AA);

    expect(results.violations).toStrictEqual([]);
  });
});
