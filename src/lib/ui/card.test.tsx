import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { Button } from './button';
import { Card } from './card';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

describe('Card', () => {
  it('titles its content at the level of the outline it fits in, and offers its actions', () => {
    render(
      <Card
        title="Season baseline"
        headingLevel="h3"
        actions={<Button label="Fetch the statistics" />}
      >
        <p>82 games played.</p>
      </Card>,
    );

    expect(screen.getByRole('heading', { level: 3, name: 'Season baseline' })).toBeVisible();
    expect(screen.getByText('82 games played.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Fetch the statistics' })).toBeVisible();
  });

  it('titles its content at the second level unless told otherwise, and needs no title', () => {
    render(
      <>
        <Card title="Backtest">
          <p>No backtest yet.</p>
        </Card>
        <Card>
          <p>Untitled block.</p>
        </Card>
      </>,
    );

    expect(screen.getAllByRole('heading').map((heading) => heading.tagName)).toStrictEqual(['H2']);
    expect(screen.getByText('Untitled block.')).toBeVisible();
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules', async () => {
    const { container } = render(
      <Card title="Season baseline" actions={<Button label="Fetch the statistics" />}>
        <p>82 games played.</p>
      </Card>,
    );

    await expect(axe.run(container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
