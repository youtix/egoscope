import { describe, expect, it, vi } from 'vitest';

/** The lot gate of a server whose build sets EGOSCOPE_LOT to `lot`, or none. */
async function gate(lot: string) {
  vi.stubEnv('EGOSCOPE_LOT', lot);
  vi.resetModules();
  const { isLotActive } = await import('./lots');
  return isLotActive;
}

describe('isLotActive', () => {
  it('[IHM-16] serves Lot 1 alone while EGOSCOPE_LOT is 1', async () => {
    const isLotActive = await gate('1');

    expect(isLotActive(1)).toBe(true);
    expect(isLotActive(2)).toBe(false);
  });

  it('[IHM-16] serves both lots once EGOSCOPE_LOT is 2', async () => {
    const isLotActive = await gate('2');

    expect(isLotActive(1)).toBe(true);
    expect(isLotActive(2)).toBe(true);
  });

  it('[IHM-16] keeps Lot 2 closed when the build sets no lot', async () => {
    const isLotActive = await gate('');

    expect(isLotActive(2)).toBe(false);
  });
});
