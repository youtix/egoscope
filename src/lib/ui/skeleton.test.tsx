import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { Skeleton } from './skeleton';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

describe('Skeleton', () => {
  it('says what is loading to screen readers, and only that', () => {
    render(<Skeleton label="Loading the players" />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading the players');
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules', async () => {
    const { container } = render(<Skeleton label="Loading the players" lines={6} />);

    await expect(axe.run(container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
