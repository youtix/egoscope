import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DrillDownLink } from './drill-down-link';

describe('DrillDownLink', () => {
  it('[IHM-52] links a gap, written with its sign and two decimals, to the numbers it is made of', () => {
    render(<DrillDownLink gap={-0.434} href="/dev/ui#case" />);

    expect(screen.getByRole('link', { name: '\u{2212}0.43' })).toHaveAttribute(
      'href',
      '/dev/ui#case',
    );
  });
});
