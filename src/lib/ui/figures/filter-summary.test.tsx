import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FilterSummary } from './filter-summary';

describe('FilterSummary', () => {
  it('[IHM-49] [CA-IHM-12] shows the active filter and the total of the profile list', () => {
    render(<FilterSummary filter="probable" count={3} total={41} />);

    expect(screen.getByText('3 "probable" profiles of 41', { exact: true })).toBeVisible();
  });

  it('[IHM-49] writes one kept profile in the singular, and the total with its thousands', () => {
    render(<FilterSummary filter="possible" count={1} total={1204} />);

    expect(screen.getByText('1 "possible" profile of 1,204', { exact: true })).toBeVisible();
  });
});
