import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { Badge } from './badge';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

describe('Badge', () => {
  it('shows its label', () => {
    render(<Badge label="Lot 2" />);

    expect(screen.getByText('Lot 2')).toBeVisible();
  });

  it('[IHM-61] says what its count means to screen readers, beside what it marks', () => {
    render(
      <a href="/">
        Home <Badge label="3" spokenLabel="3 to do" />
      </a>,
    );

    expect(screen.getByRole('link', { name: 'Home 3 to do' })).toBeVisible();
    expect(screen.getByText('3')).toHaveAttribute('aria-hidden', 'true');
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules', async () => {
    const { container } = render(
      <p>
        <Badge label="12" spokenLabel="12 to do" />
        <Badge label="Lot 2" />
      </p>,
    );

    await expect(axe.run(container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
