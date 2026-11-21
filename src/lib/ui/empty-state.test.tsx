import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { Button } from './button';
import { EmptyState } from './empty-state';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

describe('EmptyState', () => {
  it('[IHM-56] says what is missing, why, and the action that fills it', () => {
    render(
      <EmptyState
        title="No player followed yet"
        reason="Profiles need players: add the first one to follow."
        action={<Button label="Add a player" variant="primary" />}
      />,
    );

    expect(screen.getByRole('heading', { level: 2, name: 'No player followed yet' })).toBeVisible();
    expect(screen.getByText('Profiles need players: add the first one to follow.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add a player' })).toBeVisible();
  });

  it('fits the outline of the block it empties', () => {
    render(
      <EmptyState
        title="Nothing to do for now"
        reason="Every request is imported."
        headingLevel="h3"
      />,
    );

    expect(screen.getByRole('heading', { level: 3, name: 'Nothing to do for now' })).toBeVisible();
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules', async () => {
    const { container } = render(
      <EmptyState
        title="No player followed yet"
        reason="Profiles need players."
        action={<Button label="Add a player" variant="primary" />}
      />,
    );

    await expect(axe.run(container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
