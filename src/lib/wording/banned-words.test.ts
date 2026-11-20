import { describe, expect, it } from 'vitest';

import { assertNoBettingWords } from './banned-words';
import { definition, GLOSSARY } from './glossary';
import { sentence } from './sentence';

/** A rendered line that holds `words`. */
const lineWith = (words: string): string => `Player A, ${words}: see the profile.`;

describe('banned betting vocabulary', () => {
  it.each([
    'bet',
    'bets',
    'betting',
    'wager',
    'gamble',
    'gambling',
    'odds',
    'betting line',
    'bookmaker line',
    'spread',
    'point spread',
    'moneyline',
    'over/under',
    'prop',
    'parlay',
    'stake',
    'bankroll',
    'bookmaker',
    'bookie',
    'sportsbook',
    'pick',
    'picks',
    'tip',
    'tips',
    'tipster',
    'lock',
    'sure thing',
    'value bet',
    'edge',
    'cover the spread',
    'handicap',
    'favorite',
    'underdog',
    'payout',
    'winnings',
    'profit',
    'return on investment',
    'cash out',
    'hedge',
    'units',
  ])('[VUE-02] flags the betting word %s', (word) => {
    expect(() => {
      assertNoBettingWords(lineWith(word));
    }).toThrow(word);
  });

  it.each([
    'prediction',
    'predict',
    'predicted',
    'projection',
    'projected',
    'outlook',
    'likely to',
    'due for',
    'bounce back',
    'forecast',
    'prognosis',
  ])('[IHM-50] [TEL-05] flags the forecasting word %s', (word) => {
    expect(() => {
      assertNoBettingWords(lineWith(word));
    }).toThrow(word);
  });

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
