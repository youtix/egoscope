import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import citationMarkers from '@data/fixtures/ai-exchange/research-result/text-signals/citation-markers.json';
import statistics from '@data/fixtures/ai-exchange/research-result/text-signals/statistics.json';

import {
  CITATION_MARKER_PATTERNS,
  hasPossibleCitationMarker,
  hasPossibleStatistics,
  STATISTICS_PATTERNS,
} from './text-signals';

// The texts of each fixture, under the name of the pattern that they show.
const markerTexts: Readonly<Record<string, readonly string[]>> = citationMarkers.markers;
const statisticTexts: Readonly<Record<string, readonly string[]>> = statistics.signals;

// The characters that can start a citation marker: a square bracket, a lenticular
// bracket, a superscript digit, a dagger and a private-use character.
const MARKER_START = /[[【\u{00B9}\u{00B2}\u{00B3}\u{2070}\u{2074}-\u{2079}†‡\u{E000}-\u{F8FF}]/gu;

// The hyphens and dashes of Unicode: hyphen-minus, hyphen, non-breaking hyphen, figure
// dash, en dash, em dash and horizontal bar.
const HYPHENS_AND_DASHES = [
  '-',
  '\u{2010}',
  '\u{2011}',
  '\u{2012}',
  '\u{2013}',
  '\u{2014}',
  '\u{2015}',
];

/** The names of the patterns whose fixture holds no text. */
const emptyFixtures = (texts: Readonly<Record<string, readonly string[]>>): readonly string[] =>
  Object.keys(texts).filter((name) => texts[name]?.length === 0);

/** Says whether a number has the two or three digits of a score's number. */
const hasScoreDigits = (digits: string): boolean => digits.length === 2 || digits.length === 3;

describe('CITATION_MARKER_PATTERNS', () => {
  it('[CL-IMP-07] gives each pattern a fixture of at least one text, and each fixture its pattern', () => {
    expect(new Set(Object.keys(markerTexts))).toStrictEqual(
      new Set(Object.keys(CITATION_MARKER_PATTERNS)),
    );
    expect(emptyFixtures(markerTexts)).toStrictEqual([]);
  });

  it.each(Object.entries(CITATION_MARKER_PATTERNS))(
    '[CL-IMP-07] [IMP-04] finds the %s pattern in each text of its fixture',
    (name, pattern) => {
      const texts = markerTexts[name] ?? [];

      expect(texts.filter((text) => !pattern.test(text))).toStrictEqual([]);
    },
  );

  it.each([
    ['footnoteCall', '[^a[b]'],
    ['citeToken', '[cite[b]'],
  ])(
    '[CL-IMP-07] keeps an opening bracket out of the inside of the %s pattern, so that it does not match %s',
    (name, text) => {
      expect(CITATION_MARKER_PATTERNS[name]?.test(text)).toBe(false);
    },
  );
});

describe('hasPossibleCitationMarker', () => {
  it.each(Object.entries(markerTexts))(
    '[CL-IMP-07] [IMP-04] flags each text of the %s fixture',
    (_name, texts) => {
      expect(texts.filter((text) => !hasPossibleCitationMarker(text))).toStrictEqual([]);
    },
  );

  it.each(['¹', '²', '³', '⁰', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'])(
    '[CL-IMP-07] flags the superscript digit %s',
    (digit) => {
      const text = `The coach mocked the forward on television${digit}.`;

      expect(hasPossibleCitationMarker(text)).toBe(true);
    },
  );

  it.each([
    ['the first private-use character, U+E000', '\u{E000}'],
    ['the last private-use character, U+F8FF', '\u{F8FF}'],
  ])('[CL-IMP-07] flags %s', (_name, character) => {
    expect(hasPossibleCitationMarker(`The forward asked for a trade${character}.`)).toBe(true);
  });

  it.each(citationMarkers.plain)('[CL-IMP-07] [IMP-04] lets pass: %s', (text) => {
    expect(hasPossibleCitationMarker(text)).toBe(false);
  });

  it.each([
    ['the superscript letter i, U+2071, between the superscript zero and four', 'ⁱ'],
    ['the superscript plus sign, U+207A, after the superscript nine', '⁺'],
    ['the first character after the private-use area, U+F900', '\u{F900}'],
    ['digits on the line', '1, 2 and 3'],
    ['a bullet and an asterisk', '• *'],
  ])('[CL-IMP-07] lets pass %s', (_name, characters) => {
    expect(hasPossibleCitationMarker(`The forward asked for a trade ${characters}.`)).toBe(false);
  });

  it('[CL-IMP-07] [IMP-04] finds no marker in any text without a character that can start one', () => {
    const withoutMarkerStart = fc
      .string({ unit: 'binary', maxLength: 60 })
      .map((text) => text.replaceAll(MARKER_START, ''));

    fc.assert(
      fc.property(withoutMarkerStart, (text) => {
        expect(hasPossibleCitationMarker(text)).toBe(false);
      }),
    );
  });

  it('[CL-IMP-07] gives the same answer each time it checks a text', () => {
    const texts = Object.values(markerTexts).flat();

    expect(
      texts.map((text) => [hasPossibleCitationMarker(text), hasPossibleCitationMarker(text)]),
    ).toStrictEqual(texts.map(() => [true, true]));
  });
});

describe('STATISTICS_PATTERNS', () => {
  it('[CL-IMP-03] gives each pattern a fixture of at least one text, and each fixture its pattern', () => {
    expect(new Set(Object.keys(statisticTexts))).toStrictEqual(
      new Set(Object.keys(STATISTICS_PATTERNS)),
    );
    expect(emptyFixtures(statisticTexts)).toStrictEqual([]);
  });

  it.each(Object.entries(STATISTICS_PATTERNS))(
    '[CL-IMP-03] [IMP-13] finds the %s pattern in each text of its fixture',
    (name, pattern) => {
      const texts = statisticTexts[name] ?? [];

      expect(texts.filter((text) => !pattern.test(text))).toStrictEqual([]);
    },
  );
});

describe('hasPossibleStatistics', () => {
  it.each(Object.entries(statisticTexts))(
    '[CL-IMP-03] [IMP-13] flags each text of the %s fixture',
    (_name, texts) => {
      expect(texts.filter((text) => !hasPossibleStatistics(text))).toStrictEqual([]);
    },
  );

  it.each(['scored 31 points', '12 reb', '7-ast', 'a triple-double', '102-98', '99–101'])(
    '[CL-IMP-03] [IMP-13] flags %s, whatever its case',
    (text) => {
      const answers = [hasPossibleStatistics(text), hasPossibleStatistics(text.toUpperCase())];

      expect(answers).toStrictEqual([true, true]);
    },
  );

  it.each(statistics.words)(
    '[CL-IMP-03] [IMP-13] flags a number followed by %s, after a space, a hyphen or nothing, whatever its case',
    (word) => {
      const written = [' ', '-', ''].flatMap((separator) => [
        `7${separator}${word}`,
        `7${separator}${word.toUpperCase()}`,
      ]);

      expect(
        written.filter((text) => !hasPossibleStatistics(`The forward had ${text} that night.`)),
      ).toStrictEqual([]);
    },
  );

  it.each(statistics.words)(
    '[CL-IMP-03] [IMP-13] does not flag %s after a number written in words',
    (word) => {
      expect(hasPossibleStatistics(`The forward had seven ${word} that night.`)).toBe(false);
    },
  );

  it.each(['the 2023-24 season', 'game 7', 'a 3-game road trip'])(
    '[CL-IMP-03] [IMP-13] does not flag %s',
    (text) => {
      expect(hasPossibleStatistics(text)).toBe(false);
    },
  );

  it.each(statistics.plain)('[CL-IMP-03] [IMP-13] does not flag: %s', (text) => {
    expect(hasPossibleStatistics(text)).toBe(false);
  });

  it('[CL-IMP-03] [IMP-13] reads two numbers joined by any hyphen or dash as a score only when each has two or three digits', () => {
    const number = fc.stringMatching(/^\d{1,5}$/u);

    fc.assert(
      fc.property(number, fc.constantFrom(...HYPHENS_AND_DASHES), number, (left, dash, right) => {
        expect(hasPossibleStatistics(`The team won ${left}${dash}${right} that night.`)).toBe(
          hasScoreDigits(left) && hasScoreDigits(right),
        );
      }),
    );
  });

  it('[CL-IMP-03] [IMP-13] reads no score in a date, a pair that a dash and a number of exactly four digits come just before or just after', () => {
    const number = fc.stringMatching(/^\d{1,6}$/u);
    const scoreNumber = fc.stringMatching(/^\d{2,3}$/u);
    const dash = fc.constantFrom(...HYPHENS_AND_DASHES);
    const pair = fc.tuple(scoreNumber, dash, scoreNumber).map((parts) => parts.join(''));

    fc.assert(
      fc.property(number, dash, pair, (other, separator, scorePair) => {
        const isScore = other.length !== 4;

        expect([
          hasPossibleStatistics(`The forward spoke on ${other}${separator}${scorePair}.`),
          hasPossibleStatistics(`The forward spoke on ${scorePair}${separator}${other}.`),
        ]).toStrictEqual([isScore, isScore]);
      }),
    );
  });

  it('[CL-IMP-03] gives the same answer each time it checks a text', () => {
    const texts = Object.values(statisticTexts).flat();

    expect(
      texts.map((text) => [hasPossibleStatistics(text), hasPossibleStatistics(text)]),
    ).toStrictEqual(texts.map(() => [true, true]));
  });
});
