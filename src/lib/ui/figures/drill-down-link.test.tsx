import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { DrillDownLink } from './drill-down-link';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

describe('DrillDownLink', () => {
  it('[IHM-52] links a gap, written with its sign and two decimals, to the numbers it is made of', () => {
    render(<DrillDownLink gap={-0.434} href="/dev/ui#case" />);

    expect(screen.getByRole('link', { name: '\u{2212}0.43' })).toHaveAttribute(
      'href',
      '/dev/ui#case',
    );
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules', async () => {
    for (const gap of [0.8, -0.434, 0]) {
      const { container, unmount } = render(
        <p>
          <DrillDownLink gap={gap} href="/dev/ui" />
        </p>,
      );

      const results = await axe.run(container, WCAG_22_AA);

      expect(results.violations).toStrictEqual([]);
      unmount();
    }
  });
});
