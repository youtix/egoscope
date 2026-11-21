import { render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { Gallery } from './gallery';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

describe('Gallery', () => {
  it('shows every part of the design system, each under its own heading', () => {
    render(<Gallery />);

    expect(screen.getByRole('heading', { level: 1, name: 'Component gallery' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Back to Home' })).toHaveAttribute('href', '/');
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toStrictEqual([
      'Actions',
      'Long texts, copy and share',
      'Fields',
      'Changed elsewhere',
      'Paste area',
      'Dialogs',
      'Notices',
      'Blocks',
      'Lists',
    ]);
  });

  it('shows each action in each of its states', () => {
    render(<Gallery />);

    const actions = screen.getByRole('region', { name: 'Actions' });
    expect(
      within(actions)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toStrictEqual([
      'Main action',
      'Other action',
      'Erase',
      'Later',
      'Save',
      'Send the sample',
      'End the wait',
    ]);
    expect(within(actions).getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(within(actions).getByRole('button', { name: 'Send the sample' })).toBeEnabled();
    expect(
      within(actions)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toStrictEqual(['Open Home', 'Open the outside tool', 'back to Home']);
  });

  it('shows each notice, status pill and badge, in every tone', () => {
    render(<Gallery />);

    const notices = screen.getByRole('region', { name: 'Notices' });
    expect(within(notices).getAllByRole('status')).toHaveLength(5);
    expect(within(notices).getByRole('alert')).toHaveTextContent('The sample was refused.');
    expect(within(notices).getByText('State to watch')).toBeVisible();
  });

  it('shows the blocks: a card, an empty state and a loading placeholder', () => {
    render(<Gallery />);

    const blocks = screen.getByRole('region', { name: 'Blocks' });
    expect(within(blocks).getByRole('heading', { name: 'A card' })).toBeVisible();
    expect(within(blocks).getByRole('heading', { name: 'Nothing here yet' })).toBeVisible();
    expect(within(blocks).getByRole('status')).toHaveTextContent('Loading the samples');
  });

  it('shows the lists: a table, tabs, a paged list and an empty one', () => {
    render(<Gallery />);

    const lists = screen.getByRole('region', { name: 'Lists' });
    expect(within(lists).getByRole('table', { name: 'Sample sources' })).toBeInTheDocument();
    expect(within(lists).getByRole('tablist', { name: 'Sample panels' })).toBeVisible();
    expect(within(lists).getByRole('list', { name: 'Samples' })).toBeVisible();
    expect(within(lists).getByRole('navigation', { name: 'Pages of the samples' })).toBeVisible();
    expect(within(lists).getByRole('heading', { name: 'No closed sample' })).toBeVisible();
  });

  it('shows the first and the last slice of a list, each with its one link', () => {
    render(<Gallery />);

    const lists = screen.getByRole('region', { name: 'Lists' });
    const slices = ['The first slice', 'The last slice'].map((name) =>
      within(within(lists).getByRole('navigation', { name }))
        .getAllByRole('link')
        .map((link) => link.textContent),
    );
    expect(slices).toStrictEqual([['Next page'], ['Previous page']]);
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules as a whole', async () => {
    const { container } = render(<Gallery />);

    await expect(axe.run(container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
