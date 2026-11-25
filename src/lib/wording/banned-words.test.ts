import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { assertNoBettingWords } from './banned-words';
import { definition, GLOSSARY } from './glossary';
import { sentence } from './sentence';

const GLOSSARY_FILE = path.join(import.meta.dirname, '../../../docs/engineering/glossary.md');
const GLOSSARY_TEXT = readFileSync(GLOSSARY_FILE, 'utf8');
const SECTION_8_2 = GLOSSARY_TEXT.slice(
  GLOSSARY_TEXT.indexOf('### 8.2'),
  GLOSSARY_TEXT.indexOf('### 8.3'),
);
// The five entries of section 8.2 that it bans in one sense only, which the helper
// leaves to reviewers, since fixed sentences use them in their ordinary senses.
const IN_ONE_SENSE: ReadonlySet<string> = new Set([
  'line',
  'lines',
  'expected to',
  'should',
  'will',
]);

/**
 * An entry of section 8.2 without the sense it is banned in, which it gives in
 * parentheses: "tip" of "tip (betting advice)".
 */
const withoutSense = (entry: string): string => (entry.split('(', 1)[0] ?? '').trim();

/**
 * The banned words of a group of glossary section 8.2: "tip" of "tip (betting advice)",
 * "favorite" and "underdog" of "favorite and underdog (in the odds sense)", and none of
 * the five entries banned in one sense only.
 */
function bannedWordsOf(group: string): readonly string[] {
  const row = SECTION_8_2.split('\n').find((line) => line.startsWith(`| ${group} `));
  if (row === undefined) {
    throw new Error(`Glossary section 8.2 has no ${group} group.`);
  }
  // The Banned cell, second of the row: "bet, bets, …" of "| Betting | bet, bets, … |".
  return (row.split('|', 3)[2] ?? '')
    .split(',')
    .flatMap((entry) => withoutSense(entry).split(' and '))
    .filter((word) => !IN_ONE_SENSE.has(word));
}

/** A rendered line that holds `words`. */
const lineWith = (words: string): string => `Player A, ${words}: see the profile.`;

describe('banned betting vocabulary', () => {
  it.each(bannedWordsOf('Betting'))('[VUE-02] flags the betting word %s', (word) => {
    expect(() => {
      assertNoBettingWords(lineWith(word));
    }).toThrow(word);
  });

  it.each(bannedWordsOf('Forecasting'))(
    '[IHM-50] [TEL-05] flags the forecasting word %s',
    (word) => {
      expect(() => {
        assertNoBettingWords(lineWith(word));
      }).toThrow(word);
    },
  );

  it('[VUE-02] names every banned word it finds, whatever its letter case and spacing', () => {
    expect(() => {
      assertNoBettingWords('ODDS tonight. Cover  the\nspread, then Cash Out.');
    }).toThrow('The text holds banned betting words: odds, spread, cover the spread, cash out.');
  });

  it('[VUE-02] matches whole words only, never inside another word', () => {
    expect(() => {
      assertNoBettingWords(
        'Better alphabet, betweenness, stakeholders, a spreadsheet, a tipped edged lockout, profitable units-free picker.',
      );
    }).toThrow('units');
    expect(() => {
      assertNoBettingWords(
        'Better alphabet, betweenness, stakeholders, a spreadsheet, a tipped and edged lockout, a profitable picker.',
      );
    }).not.toThrow();
  });

  it('[IHM-50] lets through the look-alikes of glossary section 8.3', () => {
    expect(() => {
      assertNoBettingWords(
        'Tip-off at 01:30; tip-offs moved. Game stakes, unusual stakes, a high-stakes game. Expected noise, the expected game, expected by chance. The lock screen and the lockout. Return from injury, dispersion, coverage, the first line, a win-loss record.',
      );
    }).not.toThrow();
  });

  it('[IHM-50] [TEL-05] lets forecast through only in the terms of file 10 and the labels derived from them', () => {
    expect(() => {
      assertNoBettingWords(
        'Frozen forecast, late forecasts, no forecast. Forecast source: general trend. Forecast versions. Gap in forecast direction.',
      );
    }).not.toThrow();
    expect(() => {
      assertNoBettingWords('Forecast for the next game: possible, increase.');
    }).toThrow('forecast');
  });

  it('[ALE-17] [IHM-50] [TEL-05] accepts the fixed disclaimers and the closing line, and the same words anywhere else', () => {
    const disclaimers = [
      sentence('alerts.standingNotice'),
      sentence('interface.shortNotice'),
      sentence('interface.firstLaunchPresentation'),
      sentence('notifications.closingLine'),
    ].join(' ');

    expect(() => {
      assertNoBettingWords(disclaimers);
    }).not.toThrow();
    expect(() => {
      assertNoBettingWords('It does not predict the next game.');
    }).toThrow('predict');
    expect(() => {
      assertNoBettingWords('This is a betting recommendation.');
    }).toThrow('betting');
    expect(() => {
      assertNoBettingWords('A measure of the past, not a forecast of the next game.');
    }).toThrow('forecast');
  });

  it('[ALE-17] [IHM-50] [TEL-05] accepts a disclaimer whatever white space a screen puts between its words', () => {
    const inParagraphs = sentence('interface.firstLaunchPresentation').replace('. ', '.\n\n  ');
    const withNoBreakSpace = sentence('notifications.closingLine').replace('a ', 'a\u{A0}');

    expect(inParagraphs).toBe(
      'Egoscope measures how followed players played after public events.\n\n  It does not predict games or give betting advice.',
    );
    expect(() => {
      assertNoBettingWords(`${inParagraphs}\n${withNoBreakSpace}`);
    }).not.toThrow();
    expect(() => {
      assertNoBettingWords(withNoBreakSpace.replace('past', 'next game'));
    }).toThrow('forecast');
  });

  it('[IHM-15] accepts the definitions of glossary section 7.7, whose terms of file 10 name their forecast', () => {
    const definitions = Object.values(GLOSSARY).map((entry) => entry.text);

    expect(() => {
      assertNoBettingWords(definitions.join('\n'));
    }).not.toThrow();
    expect(() => {
      assertNoBettingWords(
        definition('lateForecast').text.replace('a tracked case', 'the next game'),
      );
    }).toThrow('forecast');
  });
});
