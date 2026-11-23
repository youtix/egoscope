import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { GlossaryTerm } from './glossary-term';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

const GAP_DEFINITION =
  "How far the measured game's performance index is from the season mean, in season standard deviations.";
const VERDICT_DEFINITION =
  'The conclusion of a profile or a trend: probable, possible or inconclusive.';
const RANGE_DEFINITION =
  'Twice the expected noise on either side of the mean gap, shown with it to show the uncertainty that comes from the number of cases.';

describe('GlossaryTerm', () => {
  it('[IHM-15] [CL-IHM-26] is a button named by the term label, which opens the definition of glossary section 7.7', () => {
    render(
      <h2>
        <GlossaryTerm term="normalizedGap" />
      </h2>,
    );

    const button = screen.getByRole('button', { name: 'Gap' });
    const opened = screen.getByText(GAP_DEFINITION, { exact: true });

    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('popovertarget', opened.id);
    expect(opened).toHaveAttribute('popover', 'auto');
  });

  it('[IHM-15] gives each term on a screen a definition of its own', () => {
    render(
      <p>
        <GlossaryTerm term="verdict" /> <GlossaryTerm term="plausibleRange" />
      </p>,
    );

    expect(screen.getByRole('button', { name: 'Verdict' })).toHaveAttribute(
      'popovertarget',
      screen.getByText(VERDICT_DEFINITION, { exact: true }).id,
    );
    expect(screen.getByRole('button', { name: 'Range' })).toHaveAttribute(
      'popovertarget',
      screen.getByText(RANGE_DEFINITION, { exact: true }).id,
    );
    expect(screen.getByText(VERDICT_DEFINITION).id).not.toBe(screen.getByText(RANGE_DEFINITION).id);
  });

  it('[IHM-15] [IHM-61] passes the WCAG 2.2 AA rules, in a heading as beside a value', async () => {
    const { container } = render(
      <div>
        <h2>
          <GlossaryTerm term="sensitivityProfile" />
        </h2>
        <p>
          <GlossaryTerm term="validCase" />: 7
        </p>
      </div>,
    );

    const results = await axe.run(container, WCAG_22_AA);

    expect(results.violations).toStrictEqual([]);
  });
});
