import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { Verdict } from './verdict';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

/** Whether each text shows, whole, in the rendered figure. */
function shown(texts: readonly string[]): boolean[] {
  return texts.map((text) => screen.queryByText(text, { exact: true }) !== null);
}

/**
 * The markup of a verdict with its direction word set aside, and without the
 * identifiers that tie a label to its definition: what it looks like.
 */
function presentation(figure: DocumentFragment): string {
  return new XMLSerializer()
    .serializeToString(figure)
    .replaceAll(/\s(?:id|popovertarget)="[^"]*"/gu, '')
    .replaceAll(/\b(?:in|de)crease\b/gu, 'direction');
}

describe('Verdict', () => {
  it('[SEN-38] [IHM-45] shows a verdict with its direction, its profile confidence and its case count', () => {
    render(
      <Verdict
        verdict={{ level: 'possible', direction: 'increase' }}
        confidence="low"
        validCount={8}
      />,
    );

    expect(shown(['possible, increase', 'Low', '8 valid cases'])).toStrictEqual([true, true, true]);
  });

  it('[SEN-38] writes every level and every profile confidence, and an inconclusive verdict without a direction', () => {
    render(
      <>
        <Verdict
          verdict={{ level: 'probable', direction: 'decrease' }}
          confidence="high"
          validCount={21}
        />
        <Verdict
          verdict={{ level: 'inconclusive', direction: null }}
          confidence="medium"
          validCount={1}
        />
      </>,
    );

    expect(
      shown([
        'probable, decrease',
        'High',
        '21 valid cases',
        'inconclusive',
        'Medium',
        '1 valid case',
      ]),
    ).toStrictEqual([true, true, true, true, true, true]);
  });

  it('[IHM-47] [CA-IHM-10] gives an increase and a decrease the same presentation', () => {
    const { asFragment: increase } = render(
      <Verdict
        verdict={{ level: 'possible', direction: 'increase' }}
        confidence="medium"
        validCount={9}
      />,
    );
    const { asFragment: decrease } = render(
      <Verdict
        verdict={{ level: 'possible', direction: 'decrease' }}
        confidence="medium"
        validCount={9}
      />,
    );

    expect(presentation(increase())).toBe(presentation(decrease()));
    expect(shown(['possible, increase', 'possible, decrease'])).toStrictEqual([true, true]);
  });

  it('[IHM-15] [CL-IHM-26] opens the definitions of the verdict and of the profile confidence from their labels', () => {
    render(
      <Verdict
        verdict={{ level: 'probable', direction: 'increase' }}
        confidence="high"
        validCount={30}
      />,
    );

    expect(screen.getAllByRole('button').map((button) => button.textContent)).toStrictEqual([
      'Verdict',
      'Profile confidence',
    ]);
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules', async () => {
    const { container } = render(
      <Verdict
        verdict={{ level: 'possible', direction: 'decrease' }}
        confidence="low"
        validCount={6}
      />,
    );

    const results = await axe.run(container, WCAG_22_AA);

    expect(results.violations).toStrictEqual([]);
  });
});
