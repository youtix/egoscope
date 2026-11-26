import { render, screen } from '@testing-library/react';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { FigureSamples } from './figure-samples';

import type { ProfileConfidence, VerdictDirection, VerdictLevel } from '@/lib/stats-engine';
import type { FigureProfileConfidence, FigureVerdictDirection, FigureVerdictLevel } from '@/lib/ui';

/** How many times each text shows, whole, in the rendered samples. */
function counts(texts: readonly string[]): number[] {
  return texts.map((text) => screen.queryAllByText(text, { exact: true }).length);
}

describe('FigureSamples', () => {
  it('[SEN-38] [IHM-45] shows a verdict of each level and of each profile confidence, each with its case count', () => {
    render(<FigureSamples />);

    expect(
      counts([
        'possible, increase',
        'Low',
        '8 valid cases',
        'probable, decrease',
        'High',
        '21 valid cases',
        'inconclusive',
        'Medium',
        '1 valid case',
      ]),
    ).toStrictEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it('[IHM-45] [IHM-47] [CL-IHM-03] shows mean gaps of each sign and one that rounds to zero, with no direction', () => {
    render(<FigureSamples />);

    expect(
      counts([
        'Mean gap',
        '+0.60',
        '\u{2212}0.60',
        '0.00',
        'increase',
        'decrease',
        'from +0.10 to +1.10',
        'from \u{2212}1.10 to \u{2212}0.10',
        'from \u{2212}0.40 to +0.40',
        '9 valid cases',
      ]),
    ).toStrictEqual([3, 1, 1, 1, 1, 1, 1, 1, 1, 3]);
  });

  it('[IHM-46] shows the split by origin with both origins, and with a single one', () => {
    render(<FigureSamples />);

    expect(
      counts([
        '7 valid cases: 5 historical, 2 tracked',
        '7 valid cases: 7 historical',
        '2 valid cases: 2 tracked',
        '1 valid case: 1 historical',
      ]),
    ).toStrictEqual([1, 1, 1, 1]);
  });

  it('[SEN-39] [IHM-49] writes proportions below the case number as counts, and the filter summaries in the singular and the plural', () => {
    render(<FigureSamples />);

    expect(
      counts([
        '5 of 7',
        '71%',
        '1 of 1',
        '3 "probable" profiles of 41',
        '1 "probable" profile of 1',
      ]),
    ).toStrictEqual([1, 1, 1, 1, 1]);
  });

  it('[IHM-15] [CL-IHM-26] opens the definition of each term from its first label only, the later ones plain', () => {
    render(<FigureSamples />);

    expect(screen.getAllByRole('button').map((button) => button.textContent)).toStrictEqual([
      'Range',
      'Verdict',
      'Profile confidence',
    ]);
    expect(counts(['Range', 'Verdict', 'Profile confidence'])).toStrictEqual([3, 3, 3]);
  });
});

// The figures of `ui` keep their own copies of the engine's value sets, since `ui`
// cannot import `stats-engine`. The type check compares each pair both ways, so a
// value added, removed or renamed on either side fails `bun run typecheck`.
describe("the figures' value sets", () => {
  it('[SEN-23] hold the levels of a verdict that the engine gives', () => {
    expectTypeOf<FigureVerdictLevel>().toEqualTypeOf<VerdictLevel>();
  });

  it('[SEN-24] hold the directions of a verdict that the engine gives', () => {
    expectTypeOf<FigureVerdictDirection>().toEqualTypeOf<VerdictDirection>();
  });

  it('[SEN-25] hold the profile confidences that the engine gives', () => {
    expectTypeOf<FigureProfileConfidence>().toEqualTypeOf<ProfileConfidence>();
  });
});
