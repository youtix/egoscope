import { render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { EmptyState } from './empty-state';
import { PagedList } from './paged-list';
import { Pagination } from './pagination';

import type { ListItem, NameSearch, StateFilter } from './paged-list';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

const STATES: StateFilter = {
  label: 'State',
  name: 'state',
  options: [
    { value: 'active', label: 'Active' },
    { value: 'paused', label: 'Paused' },
    { value: 'withdrawn', label: 'Withdrawn' },
  ],
  value: 'paused',
};

const SEARCH: NameSearch = { label: 'Search by name', name: 'q', value: 'Tor' };

const ITEMS: readonly ListItem[] = [
  { key: 'p1', content: 'Tormund Vale' },
  { key: 'p2', content: 'Ilario Tornquist' },
];

const EMPTY = <EmptyState title="No paused player" reason="Every followed player is active." />;

describe('PagedList', () => {
  it('[IHM-18] filters by state and searches by name with the values shown, on the address of the screen', () => {
    render(
      <PagedList
        label="Players"
        path="/"
        stateFilter={STATES}
        search={SEARCH}
        applyLabel="Apply"
        items={ITEMS}
        emptyState={EMPTY}
      />,
    );

    const filter = screen.getByRole('search');
    expect(within(filter).getByRole('combobox', { name: 'State' })).toHaveValue('paused');
    expect(within(filter).getByRole('combobox', { name: 'State' })).toHaveAttribute(
      'name',
      'state',
    );
    expect(within(filter).getByRole('searchbox', { name: 'Search by name' })).toHaveValue('Tor');
    expect(within(filter).getByRole('searchbox', { name: 'Search by name' })).toHaveAttribute(
      'name',
      'q',
    );
    expect(within(filter).getByRole('button', { name: 'Apply' })).toHaveAttribute('type', 'submit');
  });

  it('[IHM-18] lists the items of the slice shown, with the move to the other slices', () => {
    render(
      <PagedList
        label="Players"
        path="/"
        stateFilter={STATES}
        applyLabel="Apply"
        items={ITEMS}
        emptyState={EMPTY}
        pagination={
          <Pagination
            label="Pages of the players"
            status="Page 1 of 2"
            next={{ href: '/?page=2', label: 'Next page' }}
          />
        }
      />,
    );

    expect(
      within(screen.getByRole('list', { name: 'Players' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toStrictEqual(['Tormund Vale', 'Ilario Tornquist']);
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Next page' })).toBeVisible();
  });

  it('[IHM-56] shows its empty state instead of an empty slice', () => {
    render(
      <PagedList
        label="Players"
        path="/"
        stateFilter={STATES}
        applyLabel="Apply"
        items={[]}
        emptyState={EMPTY}
      />,
    );

    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No paused player' })).toBeVisible();
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules', async () => {
    const { container } = render(
      <PagedList
        label="Players"
        path="/"
        stateFilter={STATES}
        search={SEARCH}
        applyLabel="Apply"
        items={ITEMS}
        emptyState={EMPTY}
      />,
    );

    await expect(axe.run(container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
