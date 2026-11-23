import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  formatChanceShare,
  formatCount,
  formatExpectedCount,
  formatGap,
  formatIndex,
  formatShare,
} from './numbers';

const MINUS = '\u{2212}';
// What people read: an optional sign, digits grouped by thousands, the decimals.
const SHOWN = /^(?<sign>[+\u{2212}]?)(?<whole>\d{1,3}(?:,\d{3})*)(?:\.(?<fraction>\d+))?$/u;

/** The parts of a shown number: its sign and its value, read back. */
function readBack(shown: string): Readonly<{ sign: string; value: number; decimals: number }> {
  const groups = SHOWN.exec(shown)?.groups;
  if (groups === undefined) {
    throw new Error(`"${shown}" is not a shown number.`);
  }
  const fraction = groups['fraction'] ?? '';
  const magnitude = Number(`${(groups['whole'] ?? '').replaceAll(',', '')}.${fraction}0`);
  const sign = groups['sign'] ?? '';
  return { sign, value: sign === MINUS ? -magnitude : magnitude, decimals: fraction.length };
}

/** The sign that a rounded value shows: none at zero, "−" below, `positive` above. */
const expectedSign = (rounded: number, positive: string): string => {
  if (rounded === 0) {
    return '';
  }
  return rounded < 0 ? MINUS : positive;
};

/** A shown gap with the opposite sign: "+0.80" for "−0.80", and the reverse. */
function withOppositeSign(shown: string): string {
  if (shown.startsWith('+')) {
    return `${MINUS}${shown.slice(1)}`;
  }
  return shown.startsWith(MINUS) ? `+${shown.slice(1)}` : shown;
}

// Values whose magnitude stays where the doubles are dense enough for 3 decimals.
const VALUES = fc.double({ min: -1e9, max: 1e9, noNaN: true });
// n + j/8 and n + j/16 with j odd: exact halves of the second and of the third decimal.
const HALF_OF_SECOND_DECIMAL = fc.tuple(fc.nat(100_000), fc.constantFrom(1, 3, 5, 7));
const HALF_OF_THIRD_DECIMAL = fc.tuple(fc.nat(100_000), fc.integer({ min: 0, max: 7 }));

describe('number formats', () => {
  describe('gaps and the statistics of gaps', () => {
    it('[IHM-13] [CL-STA-09] writes the gaps of the worked example of 08 as it prints them', () => {
      expect([
        formatGap((0.498 - 0.587) / 0.208),
        formatGap((0.78 - 0.583) / 0.207),
        formatGap((0.98 - 0.599) / 0.211),
        formatGap((0.533 - 0.576) / 0.212),
      ]).toStrictEqual([`${MINUS}0.43`, '+0.95', '+1.81', `${MINUS}0.20`]);
      expect([
        formatGap(6.4 / 8),
        formatGap(0.8 - 2 * 0.354),
        formatGap(0.8 + 2 * 0.354),
      ]).toStrictEqual(['+0.80', '+0.09', '+1.51']);
    });

    it('[IHM-13] [CL-STA-09] writes the dispersion and the signal-to-noise ratio with two decimals and the expected noise with three, signed only when negative', () => {
      expect(formatGap(Math.sqrt(4.2534 / 7), 'dispersion')).toBe('0.78');
      expect(formatGap(1 / Math.sqrt(8), 'expectedNoise')).toBe('0.354');
      expect(formatGap(0.8 / 0.354, 'signalToNoise')).toBe('2.26');
      expect(formatGap(-0.8 / 0.354, 'signalToNoise')).toBe(`${MINUS}2.26`);
      expect(formatGap(1.12 / Math.sqrt(63), 'expectedNoise')).toBe('0.141');
    });

    it('[IHM-13] [CL-IHM-03] writes a gap that rounds to zero without a sign', () => {
      expect([formatGap(0), formatGap(-0), formatGap(0.0049), formatGap(-0.0049)]).toStrictEqual([
        '0.00',
        '0.00',
        '0.00',
        '0.00',
      ]);
      expect(formatGap(-0.0004, 'expectedNoise')).toBe('0.000');
    });

    it('[IHM-13] [CL-IHM-03] gives any gap two decimals, an explicit sign with a true minus, and the nearest value', () => {
      fc.assert(
        fc.property(VALUES, (value) => {
          const shown = readBack(formatGap(value));

          expect(shown.decimals).toBe(2);
          expect(Math.abs(shown.value - value)).toBeLessThanOrEqual(0.005 + 1e-6);
          expect(shown.sign).toBe(expectedSign(shown.value, '+'));
        }),
      );
    });

    it('[IHM-13] [CL-STA-09] rounds the half of the second decimal away from zero', () => {
      fc.assert(
        fc.property(HALF_OF_SECOND_DECIMAL, ([whole, eighths]) => {
          const digits = `${formatCount(whole)}.${String(Math.ceil((eighths * 100) / 8))}`;

          expect(formatGap(whole + eighths / 8)).toBe(`+${digits}`);
          expect(formatGap(-(whole + eighths / 8))).toBe(`${MINUS}${digits}`);
        }),
      );
    });

    it('[IHM-13] [CL-STA-09] rounds the double a calculation gives, so a decimal tie that no double holds falls on its side', () => {
      expect([formatGap(1.005), formatGap((0.03 + 0) / 2), formatGap(1.125)]).toStrictEqual([
        '+1.00',
        '+0.01',
        '+1.13',
      ]);
    });

    it('[IHM-13] [CL-IHM-03] writes the opposite of a gap with the opposite sign', () => {
      fc.assert(
        fc.property(VALUES, (value) => {
          expect(formatGap(-value)).toBe(withOppositeSign(formatGap(value)));
        }),
      );
    });

    it('[IHM-13] [CL-IHM-03] puts a comma between thousands', () => {
      expect(formatGap(1234.567)).toBe('+1,234.57');
      expect(formatGap(-1_234_567.891)).toBe(`${MINUS}1,234,567.89`);
      expect(formatGap(999.994)).toBe('+999.99');
    });
  });

  describe('the performance index and the baselines', () => {
    it('[IHM-13] [STA-12] writes the index of 25.9 points of Game Score in 34 min 30 s as 0.751', () => {
      expect(formatIndex(25.9 / 34.5)).toBe('0.751');
    });

    it('[IHM-13] [CL-STA-09] writes indices, baseline means and deviations with three decimals, signed only when negative', () => {
      expect([formatIndex(0.498), formatIndex(0.587), formatIndex(0.208)]).toStrictEqual([
        '0.498',
        '0.587',
        '0.208',
      ]);
      expect(formatIndex(-0.12)).toBe(`${MINUS}0.120`);
      expect([formatIndex(-0.0004), formatIndex(0)]).toStrictEqual(['0.000', '0.000']);
    });

    it('[IHM-13] [CL-IHM-03] gives any index three decimals, no plus, a true minus, and the nearest value', () => {
      fc.assert(
        fc.property(VALUES, (value) => {
          const shown = readBack(formatIndex(value));

          expect(shown.decimals).toBe(3);
          expect(Math.abs(shown.value - value)).toBeLessThanOrEqual(0.0005 + 1e-6);
          expect(shown.sign).toBe(expectedSign(shown.value, ''));
        }),
      );
    });

    it('[IHM-13] [CL-STA-09] rounds the half of the third decimal away from zero', () => {
      fc.assert(
        fc.property(HALF_OF_THIRD_DECIMAL, ([whole, sixteenths]) => {
          const thousandths = String(Math.ceil(((2 * sixteenths + 1) * 1000) / 16)).padStart(
            3,
            '0',
          );
          const digits = `${formatCount(whole)}.${thousandths}`;

          expect(formatIndex(whole + (2 * sixteenths + 1) / 16)).toBe(digits);
          expect(formatIndex(-(whole + (2 * sixteenths + 1) / 16))).toBe(`${MINUS}${digits}`);
        }),
      );
    });

    it('[IHM-13] refuses a value that no one can read', () => {
      expect(() => formatIndex(NaN)).toThrow(RangeError);
      expect(() => formatGap(Infinity)).toThrow('is not a number that people read');
      expect(() => formatGap(1e21)).toThrow(RangeError);
    });
  });

  describe('counts and shares', () => {
    it('[IHM-13] [CL-IHM-03] writes counts without a sign, with a comma between thousands from 1,000 on', () => {
      expect([0, 7, 999, 1000, 12_345, 1_234_567].map((count) => formatCount(count))).toStrictEqual(
        ['0', '7', '999', '1,000', '12,345', '1,234,567'],
      );
    });

    it('[IHM-13] [CL-IHM-03] writes any count as its digits, grouped by thousands', () => {
      fc.assert(
        fc.property(fc.maxSafeNat(), (count) => {
          const shown = formatCount(count);

          expect(shown).toMatch(/^\d{1,3}(?:,\d{3})*$/u);
          expect(shown.replaceAll(',', '')).toBe(String(count));
        }),
      );
    });

    it('[IHM-13] refuses what is not a count', () => {
      expect(() => formatCount(-1)).toThrow('-1 is not a count');
      expect(() => formatCount(1.5)).toThrow(RangeError);
    });

    it('[SEN-39] [CL-SEN-21] writes the percentage form of a share, whole and rounded half away from zero', () => {
      expect([formatShare(15, 21), formatShare(4, 10), formatShare(2, 10)]).toStrictEqual([
        '71%',
        '40%',
        '20%',
      ]);
      expect([formatShare(1, 8), formatShare(1, 3), formatShare(2, 3)]).toStrictEqual([
        '13%',
        '33%',
        '67%',
      ]);
      expect([formatShare(0, 20), formatShare(20, 20)]).toStrictEqual(['0%', '100%']);
    });

    it('[SEN-39] [CL-SEN-21] gives any share the nearest whole percentage, a half going up', () => {
      fc.assert(
        fc.property(
          fc
            .integer({ min: 1, max: 100_000 })
            .chain((whole) => fc.tuple(fc.integer({ min: 0, max: whole }), fc.constant(whole))),
          ([part, whole]) => {
            const percent = Number(formatShare(part, whole).replace(/%$/u, ''));
            // |100 × part ÷ whole − percent| ≤ ½, a half only below: −whole ≤ 200 × part − 2 × percent × whole < whole.
            const gap = 200 * part - 2 * percent * whole;

            expect(gap).toBeGreaterThanOrEqual(-whole);
            expect(gap).toBeLessThan(whole);
          },
        ),
      );
    });

    it('[SEN-39] refuses what is not a share', () => {
      expect(() => formatShare(1, 0)).toThrow('1 of 0 is not a share');
      expect(() => formatShare(3, 2)).toThrow(RangeError);
      expect(() => formatShare(-1, 5)).toThrow(RangeError);
      expect(() => formatShare(1.5, 3)).toThrow(RangeError);
    });
  });

  describe('what chance alone would give', () => {
    // 2 × (1 − Φ(t)) at the default "possible" and "probable" thresholds, t = 2 and t = 3.
    const POSSIBLE_BY_CHANCE = 0.04550026389635842;
    const PROBABLE_BY_CHANCE = 0.0026997960632601866;
    // The evaluated pairs of the example of CL-SEN-20.
    const PAIRS = 50;
    // 1 − Φ(0.25), the share of confirmed cases that chance gives at the default category threshold.
    const CONFIRMED_BY_CHANCE = 0.40129367431707624;
    const TRACKED_CASES = 7;

    it('[CL-SEN-20] writes the shares of the default thresholds with two significant digits', () => {
      expect([
        formatChanceShare(POSSIBLE_BY_CHANCE),
        formatChanceShare(PROBABLE_BY_CHANCE),
      ]).toStrictEqual(['4.6%', '0.27%']);
      expect([
        formatChanceShare(0),
        formatChanceShare(0.0996),
        formatChanceShare(0.000999),
        formatChanceShare(1),
      ]).toStrictEqual(['0%', '10%', '0.10%', '100%']);
    });

    it('[CL-SEN-20] gives any share two significant digits and the nearest value', () => {
      fc.assert(
        fc.property(fc.double({ min: 1e-12, max: 1, noNaN: true }), (share) => {
          const shown = formatChanceShare(share);
          const value = Number(shown.replace(/%$/u, ''));
          const digits = shown.replaceAll(/[.%]/gu, '').replace(/^0+/u, '');
          // Half a unit of the second significant digit of the shown value.
          const halfUnit = 10 ** (Math.floor(Math.log10(value)) - 1) / 2;

          expect(shown).toMatch(/^\d+(?:\.\d+)?%$/u);
          expect(digits).toHaveLength(value === 100 ? 3 : 2);
          expect(Math.abs(value - share * 100)).toBeLessThanOrEqual(halfUnit * (1 + 1e-9));
        }),
      );
    });

    it('[CL-SEN-20] [CL-SUI-15] writes the expected counts with one decimal', () => {
      expect([
        formatExpectedCount(PAIRS * POSSIBLE_BY_CHANCE),
        formatExpectedCount(PAIRS * PROBABLE_BY_CHANCE),
        formatExpectedCount(TRACKED_CASES * CONFIRMED_BY_CHANCE),
        formatExpectedCount(0),
        formatExpectedCount(1204),
      ]).toStrictEqual(['2.3', '0.1', '2.8', '0.0', '1,204.0']);
    });

    it('[CL-SEN-20] [CL-SUI-15] gives any expected count one decimal and the nearest value', () => {
      fc.assert(
        fc.property(fc.double({ min: 0, max: 1e6, noNaN: true }), (count) => {
          const shown = readBack(formatExpectedCount(count));

          expect(shown.sign).toBe('');
          expect(shown.decimals).toBe(1);
          expect(Math.abs(shown.value - count)).toBeLessThanOrEqual(0.05 + 1e-9);
        }),
      );
    });

    it('[CL-SEN-20] refuses what is not a share or an expected count', () => {
      expect(() => formatChanceShare(1.5)).toThrow('1.5 is not a share');
      expect(() => formatChanceShare(-0.1)).toThrow(RangeError);
      expect(() => formatChanceShare(NaN)).toThrow(RangeError);
      expect(() => formatExpectedCount(-1)).toThrow('-1 is not an expected count');
      expect(() => formatExpectedCount(NaN)).toThrow(RangeError);
    });
  });
});
