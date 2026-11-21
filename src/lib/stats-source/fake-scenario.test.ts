import { describe, expect, it } from 'vitest';

import { at, dayAfter, isBefore, LEAGUE } from './fake-scenario';

describe('the scenario of the invented league', () => {
  it('[CL-TRV-03] counts days across a change of the US clock without moving to another day', () => {
    // The US clocks go back on 2 November 2025 and forward on 8 March 2026.
    expect(dayAfter('2025-11-01', 3)).toBe('2025-11-04');
    expect(dayAfter('2026-03-07', 1)).toBe('2026-03-08');
    expect(dayAfter('2026-03-07', 0)).toBe('2026-03-07');
  });

  it('orders two days', () => {
    expect(isBefore('2025-10-31', '2025-11-01')).toBe(true);
    expect(isBefore('2025-11-01', '2025-11-01')).toBe(false);
  });

  it('refuses an item that the scenario lacks, which is a bug of the scenario', () => {
    expect(at(LEAGUE.teams, -1).id).toBe('6');
    expect(() => at(LEAGUE.teams, LEAGUE.teams.length)).toThrow(
      'The invented league lacks item 6 of a list.',
    );
  });
});
