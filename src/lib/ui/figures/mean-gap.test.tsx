import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { MeanGap } from './mean-gap';

import type { MeanGapProps } from './mean-gap';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

/**
 * The markup of a figure with its signed gaps and direction words set aside, and
 * without the identifiers that tie a label to its definition: what it looks like.
 */
function presentation(figure: DocumentFragment): string {
  return new XMLSerializer()
    .serializeToString(figure)
    .replaceAll(/\s(?:id|popovertarget)="[^"]*"/gu, '')
    .replaceAll(/[+\u{2212}]\d+\.\d{2}/gu, 'gap')
    .replaceAll(/\b(?:in|de)crease\b/gu, 'direction');
}

/** Whether each text shows, whole, in the rendered figure. */
function shown(texts: readonly string[]): boolean[] {
  return texts.map((text) => screen.queryByText(text, { exact: true }) !== null);
}

describe('MeanGap', () => {
  it('[SEN-38] [IHM-45] shows the mean gap with its sign, two decimals, its direction, its range and its case count', () => {
    render(<MeanGap meanGap={0.8} rangeLow={0.09} rangeHigh={1.51} validCount={8} />);

    expect(
      shown(['Mean gap', '+0.80', 'increase', 'from +0.09 to +1.51', '8 valid cases']),
    ).toStrictEqual([true, true, true, true, true]);
  });

  it('[IHM-15] [CL-IHM-26] opens the definition of the plausible range from its label', () => {
    render(<MeanGap meanGap={0.8} rangeLow={0.09} rangeHigh={1.51} validCount={8} />);

    expect(screen.getByRole('button', { name: 'Range' })).toHaveAttribute('popovertarget');
  });

  it('[IHM-47] [CA-IHM-10] gives gaps of +0.60 and −0.60 on the same case count the same presentation, with "increase" and "decrease"', () => {
    const { asFragment: increase } = render(
      <MeanGap meanGap={0.6} rangeLow={0.1} rangeHigh={1.1} validCount={9} />,
    );
    const { asFragment: decrease } = render(
      <MeanGap meanGap={-0.6} rangeLow={-1.1} rangeHigh={-0.1} validCount={9} />,
    );

    expect(presentation(increase())).toBe(presentation(decrease()));
    expect(
      shown([
        '+0.60',
        'increase',
        'from +0.10 to +1.10',
        '\u{2212}0.60',
        'decrease',
        'from \u{2212}1.10 to \u{2212}0.10',
      ]),
    ).toStrictEqual([true, true, true, true, true, true]);
    expect(screen.getAllByText('9 valid cases', { exact: true })).toHaveLength(2);
  });

  it('[IHM-47] [CL-IHM-03] writes no sign and no direction for a mean gap that rounds to zero, and one valid case in the singular', () => {
    render(<MeanGap meanGap={-0.004} rangeLow={-2.1} rangeHigh={2.09} validCount={1} />);

    expect(
      shown(['0.00', 'increase', 'decrease', 'from \u{2212}2.10 to +2.09', '1 valid case']),
    ).toStrictEqual([true, false, false, true, true]);
  });

  it('[SEN-38] cannot be given a mean gap without its case count', () => {
    // @ts-expect-error: a mean gap without its valid-case count is no MeanGap
    const withoutCount: MeanGapProps = { meanGap: 0.6, rangeLow: 0.1, rangeHigh: 1.1 };

    expect(withoutCount).not.toHaveProperty('validCount');
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules', async () => {
    const { container } = render(
      <MeanGap meanGap={-0.43} rangeLow={-0.9} rangeHigh={0.04} validCount={12} />,
    );

    const results = await axe.run(container, WCAG_22_AA);

    expect(results.violations).toStrictEqual([]);
  });
});
