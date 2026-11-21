import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { Button } from './button';
import { PageHeader } from './page-header';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

describe('PageHeader', () => {
  it('gives the screen its only first-level heading, its sentence and its actions', () => {
    render(
      <PageHeader
        title="Players"
        description="Times in Paris time."
        actions={<Button label="Add a player" variant="primary" />}
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Players' })).toBeVisible();
    expect(screen.getByText('Times in Paris time.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add a player' })).toBeVisible();
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules', async () => {
    const { container } = render(
      <main>
        <PageHeader
          title="Players"
          description="Times in Paris time."
          actions={<Button label="Add a player" />}
        />
      </main>,
    );

    await expect(axe.run(container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
