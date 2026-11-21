import { render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { Banner } from './banner';
import { Button } from './button';
import { LinkButton } from './link-button';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

describe('Banner', () => {
  it('[IHM-61] says its news in words, in a region that screen readers announce', () => {
    render(<Banner tone="warning" message="Offline: the data shown is the last loaded." />);

    expect(screen.getByRole('status')).toHaveTextContent(
      'Offline: the data shown is the last loaded.',
    );
  });

  it('offers its actions beside its message', () => {
    render(
      <Banner
        message="A new version is ready."
        actions={
          <>
            <LinkButton href="/" label="Paste the result" variant="primary" />
            <Button label="Later" variant="quiet" />
          </>
        }
      />,
    );

    const banner = screen.getByRole('status');
    expect(within(banner).getByRole('link', { name: 'Paste the result' })).toBeVisible();
    expect(within(banner).getByRole('button', { name: 'Later' })).toBeVisible();
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules in each tone', async () => {
    const { container } = render(
      <div>
        <Banner message="A new version is ready." actions={<Button label="Reload" />} />
        <Banner tone="warning" message="Offline: the data shown is the last loaded." />
      </div>,
    );

    await expect(axe.run(container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
