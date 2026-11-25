import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';

import ScreenError from './error';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

describe('ScreenError', () => {
  it('says in plain words that the screen could not be shown, and what the owner can do', async () => {
    const { container } = render(<ScreenError retry={vi.fn()} />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Something went wrong');
    expect(
      screen.getByText(
        'The app could not show this screen. Try again, and if it fails again, try later.',
      ),
    ).toBeVisible();
    const { violations } = await axe.run(container, WCAG_22_AA);

    expect(violations).toStrictEqual([]);
  });

  it('renders the screen afresh when the owner tries again, without reloading the page', async () => {
    const retry = vi.fn();
    render(<ScreenError retry={retry} />);

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(retry).toHaveBeenCalledOnce();
  });
});
