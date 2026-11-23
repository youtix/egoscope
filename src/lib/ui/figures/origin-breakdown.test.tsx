import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { OriginBreakdown } from './origin-breakdown';

/** The written split of `historical` and `tracked` valid cases. */
function written(historical: number, tracked: number): string | null {
  return render(<OriginBreakdown historical={historical} tracked={tracked} />).container
    .textContent;
}

describe('OriginBreakdown', () => {
  it('[IHM-46] [CA-IHM-09] splits 7 valid cases into 5 historical and 2 tracked', () => {
    expect(written(5, 2)).toBe('7 valid cases: 5 historical, 2 tracked');
  });

  it('[IHM-46] [CL-IHM-24] still gives the split when every valid case has one origin', () => {
    expect([written(7, 0), written(0, 2), written(1, 0)]).toStrictEqual([
      '7 valid cases: 7 historical',
      '2 valid cases: 2 tracked',
      '1 valid case: 1 historical',
    ]);
  });

  it('counts a summary without a valid case', () => {
    expect(written(0, 0)).toBe('0 valid cases');
  });
});
