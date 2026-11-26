import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import NotFound from './not-found';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

describe('the page of an address that matches no route', () => {
  it('[IHM-16] [CL-IHM-19] says in one sentence that the address leads to no screen, with the way to Home', async () => {
    render(<NotFound />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'This address leads to no screen' }),
    ).toBeVisible();
    await userEvent.tab();

    const home = screen.getByRole('link', { name: 'Go to Home' });
    expect(home).toHaveFocus();
    expect(home).toHaveAttribute('href', '/');
  });

  it('[IHM-16] stands outside the shell, in a main landmark of its own, without the navigation bar', () => {
    render(<NotFound />);

    expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading', { level: 1 }));
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules', async () => {
    const { container } = render(<NotFound />);

    await expect(axe.run(container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
