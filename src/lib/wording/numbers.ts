// The numbers people read (IHM-13, ADR 0010, CL-IHM-03): a decimal point, a comma
// between thousands from 1,000 on, and the decimals that CL-STA-09 gives each value,
// rounded half away from zero. A gap carries "+" or the true minus "−" (U+2212); any
// other value shows only its minus; a value that rounds to zero shows no sign, and a
// count none at all. The machine formats of prompts, imports and exports are written
// elsewhere, with a plain point and the ASCII hyphen-minus.
//
// Rounding works on the double that a calculation gives (CL-STA-09), so a decimal tie
// that no double holds exactly falls on the side of its double: 1.005, held as
// 1.00499…, shows "+1.00", and the mean of +0.03 and 0.00, held as 0.01499…, "+0.01".
// A test that feeds printed values (CL-SEN-24) expects these, not the tie rounded by
// hand.

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

// The digits of what chance alone would give (CL-SEN-20, CL-SUI-15): two significant
// digits for a share, one decimal for an expected count.
const CHANCE_SHARE_DIGITS = 2;
const EXPECTED_COUNT_DECIMALS = 1;

const INDEX_FORMAT: NumberFormat = { decimals: INDEX_DECIMALS, sign: 'negative' };
const EXPECTED_COUNT_FORMAT: NumberFormat = {
  decimals: EXPECTED_COUNT_DECIMALS,
  sign: 'negative',
};

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
 * A setting's number that a step of `decimals` places allows, as people read it
 * (IHM-13, CL-IHM-03, CL-TRV-16): at most those decimals, rounded half away from zero,
 * without the zeros that end them, signed only when negative: "0.25", "1.5", "2",
 * "1,440" for decimals of 2.
 */
export function formatDecimal(value: number, decimals: number): string {
  if (!Number.isSafeInteger(decimals) || decimals < 1) {
    throw new RangeError(`${String(decimals)} is not a number of decimals.`);
  }
  const written = formatNumber(value, { decimals, sign: 'negative' });
  // The zeros that end the decimals, then the point if no decimal is left.
  let end = written.length;
  while (written.endsWith('0', end)) {
    end -= 1;
  }
  return written.slice(0, written.endsWith('.', end) ? end - 1 : end);
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

/**
 * A share that chance alone would give, such as the share of pairs that would get an
 * at-least-possible verdict without any effect, as a percentage with two significant
 * digits rounded half up (SEN-41, CL-SEN-20): "4.6%" and "0.27%" for the 4.55% and
 * 0.27% of the defaults, "10%" for 9.96%, "0%" for none. `share` is the exact
 * proportion, from 0 to 1.
 */
export function formatChanceShare(share: number): string {
  if (Number.isNaN(share) || share < 0 || share > 1) {
    throw new RangeError(`${String(share)} is not a share.`);
  }
  if (share === 0) {
    return '0%';
  }
  // toPrecision rounds the exact value half up; the decimals then follow the rounded
  // value, so that 9.96 becomes "10", not "10.0", and 100 stays "100".
  const rounded = Number((share * PERCENT).toPrecision(CHANCE_SHARE_DIGITS));
  const decimals = Math.max(0, CHANCE_SHARE_DIGITS - 1 - Math.floor(Math.log10(rounded)));
  return `${rounded.toFixed(decimals)}%`;
}

/**
 * A count that chance alone would give, which need not be whole, with one decimal
 * rounded half away from zero and a comma between thousands (CL-SEN-20, CL-SUI-15):
 * "2.3" for 2.275, "0.1" for 0.135, "1,204.0" for 1,204.
 */
export function formatExpectedCount(count: number): string {
  if (Number.isNaN(count) || count < 0) {
    throw new RangeError(`${String(count)} is not an expected count.`);
  }
  return formatNumber(count, EXPECTED_COUNT_FORMAT);
}
