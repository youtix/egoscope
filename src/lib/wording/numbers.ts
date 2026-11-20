// The numbers people read (IHM-13, ADR 0010, CL-IHM-03): a decimal point, a comma
// between thousands from 1,000 on, and the decimals that CL-STA-09 gives each value,
// rounded half away from zero. A gap carries "+" or the true minus "−" (U+2212); any
// other value shows only its minus; a value that rounds to zero shows no sign, and a
// count none at all. The machine formats of prompts, imports and exports are written
// elsewhere, with a plain point and the ASCII hyphen-minus.

/** Where a value shows its sign: `explicit`, "+" or "−"; `negative`, "−" only. */
type Sign = 'explicit' | 'negative';

type NumberFormat = Readonly<{ decimals: number; sign: Sign }>;

// The decimals of CL-STA-09: three for the performance index (STA-12), a baseline's
// mean and standard deviation (CA-STA-02) and the expected noise; two for a normalized
// gap (SEN-09) and every mean or range of gaps, the dispersion and the signal-to-noise
// ratio.
const INDEX_DECIMALS = 3;
const GAP_DECIMALS = 2;
const NOISE_DECIMALS = 3;

const INDEX_FORMAT: NumberFormat = { decimals: INDEX_DECIMALS, sign: 'negative' };

/**
 * The numbers a profile computes from normalized gaps (SEN-09, SEN-20, SEN-22): `gap`,
 * a normalized gap, a mean gap, a bound of the plausible range or any other mean or
 * range of gaps; `dispersion`, the gap dispersion, observed or retained;
 * `expectedNoise`; `signalToNoise`, the signal-to-noise ratio.
 */
export type GapStatistic = 'gap' | 'dispersion' | 'expectedNoise' | 'signalToNoise';

const GAP_FORMATS: Readonly<Record<GapStatistic, NumberFormat>> = {
  gap: { decimals: GAP_DECIMALS, sign: 'explicit' },
  dispersion: { decimals: GAP_DECIMALS, sign: 'negative' },
  expectedNoise: { decimals: NOISE_DECIMALS, sign: 'negative' },
  signalToNoise: { decimals: GAP_DECIMALS, sign: 'negative' },
};

const TRUE_MINUS = '\u{2212}';
// From this magnitude on, toFixed writes an exponent, which no number people read needs.
const TO_FIXED_LIMIT = 1e21;
const THOUSANDS_GROUP = 3;
const PERCENT = 100;

/** A run of digits with a comma between thousands: "12,345". */
function groupThousands(digits: string): string {
  const remainder = digits.length % THOUSANDS_GROUP;
  const head = remainder === 0 ? THOUSANDS_GROUP : remainder;
  const groups = [digits.slice(0, head)];
  for (let start = head; start < digits.length; start += THOUSANDS_GROUP) {
    groups.push(digits.slice(start, start + THOUSANDS_GROUP));
  }
  return groups.join(',');
}

/**
 * The sign a value shows: none when it rounds to zero, whose written digits are all
 * zeros, the true minus when it is negative, and "+" when it is positive and its sign
 * is explicit.
 */
function signOf(value: number, digits: string, sign: Sign): string {
  if (!/[1-9]/u.test(digits)) {
    return '';
  }
  if (value < 0) {
    return TRUE_MINUS;
  }
  return sign === 'explicit' ? '+' : '';
}

/**
 * A finite value, rounded half away from zero and written as CL-IHM-03 says, with the
 * decimals of its format, of which every format has some.
 */
function formatNumber(value: number, format: NumberFormat): string {
  if (!Number.isFinite(value) || Math.abs(value) >= TO_FIXED_LIMIT) {
    throw new RangeError(`${String(value)} is not a number that people read.`);
  }
  // toFixed rounds the exact value of the magnitude, half up: half away from zero. It
  // writes the decimals it is asked for after the point.
  const fixed = Math.abs(value).toFixed(format.decimals);
  const point = fixed.length - format.decimals - 1;
  const digits = `${groupThousands(fixed.slice(0, point))}${fixed.slice(point)}`;
  return `${signOf(value, digits, format.sign)}${digits}`;
}

/**
 * A number on the scale of normalized gaps, as people read it (IHM-13, SEN-09,
 * CL-IHM-03, CL-STA-09). A gap, the default — a normalized gap, a mean gap, a bound of
 * the plausible range — has two decimals and an explicit sign: "+0.80", "−0.43", and
 * "0.00" for a value that rounds to zero. The dispersion and the signal-to-noise ratio
 * have two decimals and the expected noise three, signed only when negative: "0.78",
 * "2.26", "0.354".
 */
export function formatGap(value: number, statistic: GapStatistic = 'gap'): string {
  return formatNumber(value, GAP_FORMATS[statistic]);
}

/**
 * A number on the scale of the performance index, as people read it (IHM-13, STA-12,
 * CL-IHM-03, CL-STA-09): an index, or a baseline's mean or standard deviation, with
 * three decimals, signed only when negative: "0.751", "−0.120", "0.000".
 */
export function formatIndex(value: number): string {
  return formatNumber(value, INDEX_FORMAT);
}

/**
 * A count, as people read it (IHM-13, CL-IHM-03): no sign, and a comma between
 * thousands from 1,000 on: "7", "1,000", "12,345".
 */
export function formatCount(count: number): string {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError(`${String(count)} is not a count.`);
  }
  return groupThousands(String(count));
}

/**
 * The share that `part` is of `whole`, as a whole percentage rounded half away from
 * zero: "71%" for 15 of 21 (IHM-13, SEN-39, CL-SEN-21). The proportion is exact, taken
 * from the two counts. Below the number of cases from which shares are shown, a screen
 * shows the two counts instead (CL-SEN-21).
 */
export function formatShare(part: number, whole: number): string {
  const isShare =
    Number.isSafeInteger(part) && Number.isSafeInteger(whole) && part >= 0 && part <= whole;
  if (!isShare || whole === 0) {
    throw new RangeError(`${String(part)} of ${String(whole)} is not a share.`);
  }
  // 100 × part ÷ whole rounded half up, in integers: ⌊(200 × part + whole) ÷ (2 × whole)⌋.
  const percent = Math.floor((2 * PERCENT * part + whole) / (2 * whole));
  return `${String(percent)}%`;
}
