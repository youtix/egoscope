import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { LinkButton, TextLink } from './link-button';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

// An outside address, such as the research tool's (IHM-44).
const RESEARCH_TOOL = new URL('https://research.example/new');

describe('LinkButton', () => {
  it('[IHM-62] is a link named by its visible label, to a route of the app', () => {
    render(<LinkButton href="/" label="Open Home" variant="primary" />);

    expect(screen.getByRole('link', { name: 'Open Home' })).toHaveAttribute('href', '/');
  });

  it('leads to an outside address', () => {
    render(<LinkButton href={RESEARCH_TOOL} label="Open the research tool" />);

    expect(screen.getByRole('link', { name: 'Open the research tool' })).toHaveAttribute(
      'href',
      'https://research.example/new',
    );
  });
});

describe('TextLink', () => {
  it('[IHM-62] is a link named by its visible label, inside text', () => {
    render(
      <p>
        Read <TextLink href={RESEARCH_TOOL} label="the source" /> first.
      </p>,
    );

    expect(screen.getByRole('link', { name: 'the source' })).toHaveAttribute(
      'href',
      'https://research.example/new',
    );
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules, with link buttons of every variant', async () => {
    const { container } = render(
      <div>
        <p>
          Back to <TextLink href="/" label="Home" />.
        </p>
        <LinkButton href="/" label="Main" variant="primary" />
        <LinkButton href="/" label="Other" />
        <LinkButton href="/" label="Delete" variant="danger" />
        <LinkButton href="/" label="Later" variant="quiet" />
      </div>,
    );

    await expect(axe.run(container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
