import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { Direction, shownDirection } from './direction';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

describe('Direction', () => {
  it('[IHM-47] [CA-IHM-10] writes the direction in full, both directions with the same element and classes', () => {
    render(
      <p>
        <Direction direction="increase" /> <Direction direction="decrease" />
      </p>,
    );

    const increase = screen.getByText('increase', { exact: true });
    const decrease = screen.getByText('decrease', { exact: true });

    expect(increase.tagName).toBe(decrease.tagName);
    // One weight for both, and no color of their own.
    expect(increase).toHaveClass('font-medium', { exact: true });
    expect(decrease).toHaveClass('font-medium', { exact: true });
  });

  it('[IHM-47] [CL-IHM-03] reads the direction from the sign of a written gap, and none from a gap that rounds to zero', () => {
    expect(['+0.60', '\u{2212}0.60', '0.00'].map((gap) => shownDirection(gap))).toStrictEqual([
      'increase',
      'decrease',
      undefined,
    ]);
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules', async () => {
    for (const direction of ['increase', 'decrease'] as const) {
      const { container, unmount } = render(
        <p>
          <Direction direction={direction} />
        </p>,
      );

      const results = await axe.run(container, WCAG_22_AA);

      expect(results.violations).toStrictEqual([]);
      unmount();
    }
  });
});
