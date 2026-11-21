import { render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { Table } from './table';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

const COLUMNS = [
  { key: 'source', header: 'Source' },
  { key: 'language', header: 'Language' },
  { key: 'articles', header: 'Articles', numeric: true },
];

const ROWS = [
  { key: 'gazette', cells: { source: 'Harbor Gazette', language: 'English', articles: '1,204' } },
  { key: 'courrier', cells: { source: 'Courrier du Sport', language: 'French', articles: '87' } },
];

describe('Table', () => {
  it('lists its rows under their column headers on a wide screen', () => {
    render(<Table caption="Press sources" columns={COLUMNS} rows={ROWS} />);

    const table = screen.getByRole('table', { name: 'Press sources' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toStrictEqual(['Source', 'Language', 'Articles']);
    expect(within(table).getByRole('cell', { name: '1,204' })).toHaveClass(
      'text-right',
      'tabular-nums',
    );
  });

  it('[IHM-01] makes each row a block on a phone, titled by its first cell, its values under their headers', () => {
    render(<Table caption="Press sources" columns={COLUMNS} rows={ROWS} />);

    const list = screen.getByRole('list', { name: 'Press sources' });
    const blocks = within(list).getAllByRole('listitem');
    expect(within(list).getByText('Harbor Gazette')).toBeVisible();
    expect(within(list).getByText('Courrier du Sport')).toBeVisible();
    expect(
      blocks.map((block) =>
        within(block)
          .getAllByRole('term')
          .map((term) => term.textContent),
      ),
    ).toStrictEqual([
      ['Language', 'Articles'],
      ['Language', 'Articles'],
    ]);
    expect(
      blocks.map((block) =>
        within(block)
          .getAllByRole('definition')
          .map((value) => value.textContent),
      ),
    ).toStrictEqual([
      ['English', '1,204'],
      ['French', '87'],
    ]);
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules', async () => {
    const { container } = render(<Table caption="Press sources" columns={COLUMNS} rows={ROWS} />);

    await expect(axe.run(container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
