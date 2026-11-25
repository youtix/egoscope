import { render } from '@testing-library/react';
import axe from 'axe-core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { CountOrShare } from './count-or-share';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

// The default of the `sensitivity.countsBelowCases` parameter (SEN-39).
const COUNTS_BELOW_CASES = 20;

/** The written proportion of `part` cases out of `whole`, below `countsBelowCases`. */
function written(part: number, whole: number, countsBelowCases = COUNTS_BELOW_CASES): string {
  const { container, unmount } = render(
    <CountOrShare part={part} whole={whole} countsBelowCases={countsBelowCases} />,
  );
  const text = container.textContent;
  unmount();
  return text;
}

describe('CountOrShare', () => {
  it('[SEN-39] [CL-SEN-21] writes 5 cases above zero out of 7 as counts, never as a percentage', () => {
    expect(written(5, 7)).toBe('5 of 7');
  });

  it('[SEN-39] [CL-SEN-21] switches to a percentage when the denominator reaches the parameter it receives', () => {
    expect([written(15, 19), written(15, 20), written(15, 21)]).toStrictEqual([
      '15 of 19',
      '75%',
      '71%',
    ]);
    expect([written(5, 7, 5), written(5, 7, 8)]).toStrictEqual(['71%', '5 of 7']);
  });

  it('[SEN-39] [CL-SEN-21] shows a percentage exactly when the denominator is not below the parameter', () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: 1, max: 200 })
          .chain((whole) => fc.tuple(fc.integer({ min: 0, max: whole }), fc.constant(whole))),
        fc.integer({ min: 1, max: 100 }),
        ([part, whole], countsBelowCases) => {
          const text = written(part, whole, countsBelowCases);

          expect(text.endsWith('%')).toBe(whole >= countsBelowCases);
          expect(text === `${String(part)} of ${String(whole)}`).toBe(whole < countsBelowCases);
        },
      ),
    );
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules', async () => {
    const states = [
      { part: 5, whole: 7 },
      { part: 15, whole: 21 },
      { part: 1, whole: 1 },
    ];

    for (const { part, whole } of states) {
      const { container, unmount } = render(
        <CountOrShare part={part} whole={whole} countsBelowCases={COUNTS_BELOW_CASES} />,
      );

      const results = await axe.run(container, WCAG_22_AA);

      expect(results.violations).toStrictEqual([]);
      unmount();
    }
  });
});
