import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { StatusPill } from './status-pill';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

describe('StatusPill', () => {
  it('[IHM-61] writes the state in words, which an icon only adds to', () => {
    render(<StatusPill label="Paused" tone="warning" />);

    expect(screen.getByText('Paused')).toBeVisible();
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules in each tone', async () => {
    const { container } = render(
      <p>
        <StatusPill label="Withdrawn" />
        <StatusPill label="To do" tone="info" />
        <StatusPill label="Imported" tone="success" />
        <StatusPill label="Paused" tone="warning" />
        <StatusPill label="Canceled" tone="danger" />
      </p>,
    );

    await expect(axe.run(container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
