import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Direction, shownDirection } from './direction';

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
});
