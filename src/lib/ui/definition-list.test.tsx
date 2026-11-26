import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { DefinitionList } from './definition-list';
import { GlossaryTerm } from './figures/glossary-term';
import { StatusPill } from './status-pill';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

const FACTS = [
  { term: 'Team', details: 'Harbor City Gulls' },
  { term: 'State', details: <StatusPill label="Active" tone="success" /> },
];

describe('DefinitionList', () => {
  it('pairs each term with its value, in their order', () => {
    render(<DefinitionList items={FACTS} />);

    expect(screen.getAllByRole('term').map((term) => term.textContent)).toStrictEqual([
      'Team',
      'State',
    ]);
    expect(screen.getAllByRole('definition').map((value) => value.textContent)).toStrictEqual([
      'Harbor City Gulls',
      'Active',
    ]);
  });

  it('[IHM-15] takes a term that is not a text, such as the first label of a glossary term, keyed by its text', () => {
    render(
      <DefinitionList
        items={[
          { term: <GlossaryTerm term="followedPlayer" />, key: 'Player', details: 'Kade Orrin' },
          ...FACTS,
        ]}
      />,
    );

    expect(screen.getAllByRole('term').map((term) => term.textContent)).toStrictEqual([
      'PlayerAn NBA player you put on the follow list.',
      'Team',
      'State',
    ]);
    expect(screen.getByRole('button', { name: 'Player' })).toBeVisible();
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules', async () => {
    const { container } = render(<DefinitionList items={FACTS} />);

    await expect(axe.run(container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
