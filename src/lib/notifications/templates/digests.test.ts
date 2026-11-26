import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { paths } from '@/lib/navigation';
import { MESSAGE_MAX_LENGTH, textLength } from '@/lib/telegram';
import { toEpochMs } from '@/lib/time';

import { digest } from './digests';

import type { DigestData, DigestLine } from './data';
import type { EpochMs } from '@/lib/time';

const PARIS = 'Europe/Paris';
const BASE = 'https://egoscope.example';
const HOME_URL = `${BASE}${paths.home()}`;
const EVERYTHING_LINK = '<a href="https://egoscope.example/">Everything is in the app</a>';
// An instant of Wednesday 18 November 2026, in UTC.
const onWednesday = (hour: number, minute = 0): EpochMs =>
  toEpochMs(Date.UTC(2026, 10, 18, hour, minute));
const linesOf = (text: string): readonly string[] => text.split('\n');

const PASS_DIGEST: DigestData = {
  kind: 'pass_digest',
  title: {
    kind: 'pass',
    taskName: 'Evening collection and detection',
    passStartedAt: onWednesday(22),
  },
  lines: [{ text: 'Alert — Player A', afterTipOff: false, url: `${BASE}${paths.alertSheet(14)}` }],
  moreCount: 0,
  homeUrl: HOME_URL,
};
const PASS_TITLE =
  '<b>Egoscope · Digest — Evening collection and detection, Wednesday 18 November 2026, 23:00 Paris time</b>';
const QUIET_HOURS_DIGEST: DigestData = {
  kind: 'quiet_hours_digest',
  title: { kind: 'quiet_hours', from: '23:00', to: '08:00' },
  lines: [
    { text: 'Tracked result — Player F', afterTipOff: true, url: `${BASE}${paths.case(40)}` },
  ],
  moreCount: 0,
  homeUrl: HOME_URL,
};
const QUIET_HOURS_TITLE = '<b>Egoscope · During quiet hours (23:00 – 08:00)</b>';

/** A fact as the digest should show it, written independently of the code. */
const shown = (fact: DigestLine): string => {
  const anchor = `<a href="${fact.url}">${fact.text.replaceAll('&', '&amp;')}</a>`;
  return fact.afterTipOff ? `${anchor} (after tip-off)` : anchor;
};
/** "and N more", linked to Home, or nothing when no fact is left out. */
const moreLines = (count: number): readonly string[] =>
  count === 0 ? [] : [`<a href="https://egoscope.example/">and ${String(count)} more</a>`];
/** How many of the facts lead the digest's lines, in their order. */
const keptCount = (lines: readonly string[], expected: readonly string[]): number => {
  const firstMissing = expected.findIndex((fact, index) => lines[index] !== fact);
  return firstMissing === -1 ? expected.length : firstMissing;
};
/** The first line of the digest of tracked results whose number is `count`. */
const resultsTitle = (count: number): string =>
  linesOf(digest({ ...PASS_DIGEST, title: { kind: 'tracked_results', count } }, PARIS))[0] ?? '';
/** The digest of `kept` facts, as it should read: title, facts, "and N more", footer. */
const composition = (
  head: Readonly<{ title: string; footer: readonly string[] }>,
  facts: readonly string[],
  more: number,
): string => [head.title, ...facts, ...moreLines(more), ...head.footer].join('\n');
/** Whether the digest keeps every fact, or whether one fact more would go over the limit. */
const doesKeepTheMostThatFit = (
  head: Readonly<{ title: string; footer: readonly string[] }>,
  expected: readonly string[],
  kept: Readonly<{ count: number; more: number }>,
): boolean =>
  kept.count === expected.length ||
  textLength(composition(head, expected.slice(0, kept.count + 1), kept.more - 1)) >
    MESSAGE_MAX_LENGTH;

// The two layouts of a digest: without the link to Home, and with it.
const LAYOUTS: readonly Readonly<{
  data: DigestData;
  head: Readonly<{ title: string; footer: readonly string[] }>;
}>[] = [
  { data: PASS_DIGEST, head: { title: PASS_TITLE, footer: [] } },
  { data: QUIET_HOURS_DIGEST, head: { title: QUIET_HOURS_TITLE, footer: [EVERYTHING_LINK] } },
];

describe('the digests', () => {
  it('[TEL-08] [CL-TEL-11] lays out a pass digest: title with the task and its start, one linked line per fact, "and N more"', () => {
    expect(linesOf(digest({ ...PASS_DIGEST, moreCount: 4 }, PARIS))).toStrictEqual([
      PASS_TITLE,
      '<a href="https://egoscope.example/alerts/14">Alert — Player A</a>',
      '<a href="https://egoscope.example/">and 4 more</a>',
    ]);
  });

  it('[TEL-08] [CL-TEL-11] titles a digest of tracked results by their number', () => {
    expect([resultsTitle(2), resultsTitle(1)]).toStrictEqual([
      '<b>Egoscope · Results of 2 tracked games</b>',
      '<b>Egoscope · Results of 1 tracked game</b>',
    ]);
  });

  it('[TEL-08] [CL-TEL-12] marks a fact after tip-off in the quiet-hours digest, which ends with the link to Home', () => {
    expect(linesOf(digest(QUIET_HOURS_DIGEST, PARIS))).toStrictEqual([
      QUIET_HOURS_TITLE,
      '<a href="https://egoscope.example/cases/40">Tracked result — Player F</a> (after tip-off)',
      EVERYTHING_LINK,
    ]);
  });

  it('[TEL-04] [CL-TEL-12] writes the catch-up with the period it covers, in the zone of the owner, and the link to Home', () => {
    const catchUp: DigestData = {
      kind: 'catch_up',
      title: { kind: 'catch_up', periodStartAt: onWednesday(8), periodEndAt: onWednesday(10, 30) },
      lines: [
        {
          text: 'Backtest to do — Player B',
          afterTipOff: false,
          url: `${BASE}${paths.request(12)}`,
        },
      ],
      moreCount: 2,
      homeUrl: HOME_URL,
    };

    expect(linesOf(digest(catchUp, PARIS))).toStrictEqual([
      '<b>Egoscope · Catch-up</b>',
      'Not received between Wednesday 18 November 2026, 09:00 Paris time and Wednesday 18 November 2026, 11:30 Paris time:',
      '<a href="https://egoscope.example/backtests/12">Backtest to do — Player B</a>',
      '<a href="https://egoscope.example/">and 2 more</a>',
      EVERYTHING_LINK,
    ]);
  });

  it('[CL-TEL-14] keeps no fact when the title alone is over the limit, every fact counted in "and N more"', () => {
    const title: DigestData['title'] = {
      kind: 'pass',
      taskName: 'a'.repeat(MESSAGE_MAX_LENGTH),
      passStartedAt: onWednesday(22),
    };

    expect(linesOf(digest({ ...PASS_DIGEST, title, moreCount: 2 }, PARIS)).slice(1)).toStrictEqual([
      '<a href="https://egoscope.example/">and 3 more</a>',
    ]);
  });

  it('[TEL-08] [CL-TEL-14] drops whole fact lines from the end of a digest over the limit and counts them in "and N more"', () => {
    const line = { text: 'a'.repeat(450), afterTipOff: false, url: `${BASE}${paths.case(1)}` };
    const text = digest(
      { ...PASS_DIGEST, lines: Array.from({ length: 10 }, () => line), moreCount: 3 },
      PARIS,
    );

    expect(textLength(text)).toBe(3717);
    expect(linesOf(text)).toStrictEqual([
      PASS_TITLE,
      ...Array.from(
        { length: 8 },
        () => `<a href="https://egoscope.example/cases/1">${line.text}</a>`,
      ),
      '<a href="https://egoscope.example/">and 5 more</a>',
    ]);
  });

  it('[TEL-08] [CL-TEL-14] keeps every digest within the limit by the most whole lines that fit, in their order', () => {
    const lineArbitrary = fc.record({
      text: fc
        .tuple(fc.constantFrom('a', 'Z', 'é', '&'), fc.integer({ min: 1, max: 900 }))
        .map(([letter, length]) => letter.repeat(length)),
      afterTipOff: fc.boolean(),
      url: fc.constantFrom(`${BASE}${paths.case(1)}`, `${BASE}${paths.journal(2)}`),
    });

    fc.assert(
      fc.property(
        fc.constantFrom(...LAYOUTS),
        fc.array(lineArbitrary, { minLength: 1, maxLength: 20, size: 'max' }),
        fc.nat({ max: 50 }),
        ({ data, head }, facts, moreCount) => {
          const text = digest({ ...data, lines: facts, moreCount }, PARIS);
          const expected = facts.map((fact) => shown(fact));
          const count = keptCount(linesOf(text).slice(1), expected);
          const more = moreCount + facts.length - count;

          expect(textLength(text)).toBeLessThanOrEqual(MESSAGE_MAX_LENGTH);
          expect(text).toBe(composition(head, expected.slice(0, count), more));
          expect(doesKeepTheMostThatFit(head, expected, { count, more })).toBe(true);
        },
      ),
    );
  });
});
