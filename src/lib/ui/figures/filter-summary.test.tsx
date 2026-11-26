import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { FilterSummary } from './filter-summary';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

describe('FilterSummary', () => {
  it('[IHM-49] [CA-IHM-12] shows the active filter and the total of the profile list', () => {
    render(<FilterSummary filter="probable" count={3} total={41} />);

    expect(screen.getByText('3 "probable" profiles of 41', { exact: true })).toBeVisible();
  });

  it('[IHM-49] writes one kept profile in the singular, and the total with its thousands', () => {
    render(<FilterSummary filter="possible" count={1} total={1204} />);

    expect(screen.getByText('1 "possible" profile of 1,204', { exact: true })).toBeVisible();
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules', async () => {
    for (const count of [3, 1]) {
      const { container, unmount } = render(
        <FilterSummary filter="probable" count={count} total={41} />,
      );

      const results = await axe.run(container, WCAG_22_AA);

      expect(results.violations).toStrictEqual([]);
      unmount();
    }
  });
});
