import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { MethodNotice } from './method-notice';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

describe('MethodNotice', () => {
  it('[IHM-50] [IHM-69] gives the short notice and links to Method and limits', () => {
    render(<MethodNotice />);

    expect(
      screen.getByText('A measure of the past, an unproven hypothesis, no betting recommendation', {
        exact: true,
      }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Method and limits' })).toHaveAttribute(
      'href',
      '/method',
    );
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules', async () => {
    const { container } = render(<MethodNotice />);

    const results = await axe.run(container, WCAG_22_AA);

    expect(results.violations).toStrictEqual([]);
  });
});
