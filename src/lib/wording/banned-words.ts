// The banned betting vocabulary, the betting and forecasting groups of glossary section
// 8.2, and the helper that screen and message tests call on what they render (VUE-02,
// IHM-50, ALE-18, TEL-05). Words and phrases match whole, in any letter case, with any
// white space between their words, never inside another word: "stake" is not "game
// stakes". A word that 8.2 bans in one sense is flagged in every sense, but for the
// look-alikes of section 8.3, except four that fixed sentences use in their ordinary
// senses, which no match can tell apart: "line" (the first line of a Telegram
// message), and "expected to", "should" and "will" about a performance ("all profiles
// will be recalculated"); reviewers check those. The certainty, superlative and
// judgment groups belong to the checks of alert sheets, descriptions and the
// validation table, where their exceptions live.
import { GLOSSARY } from './glossary';
import { sentence } from './sentence';

const BANNED_WORDS = [
  // Betting
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
  // Forecasting
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
] as const;

const WORD_BOUNDARY = String.raw`\b`;
const SPACES = String.raw`\s+`;

/** A word or phrase, matched whole: words apart from other letters, spaces of any width. */
const whole = (phrase: string, flags: string): RegExp =>
  new RegExp([WORD_BOUNDARY, phrase.split(' ').join(SPACES), WORD_BOUNDARY].join(''), flags);

const BANNED = BANNED_WORDS.map((word) => ({ word, pattern: whole(word, 'iu') }));

// A run of white space of any kind: spaces, tabs, line breaks, non-breaking spaces.
const WHITE_SPACE = /\s+/gu;

/** `text` with each run of white space made one space. */
const oneSpaced = (text: string): string => text.replaceAll(WHITE_SPACE, ' ');

// The texts that may hold a banned word (section 8): the fixed disclaimers that say
// what the app does not do, with "betting" and "predict" (ALE-17, IHM-50, IHM-53), the
// closing line of alert messages (TEL-05), and the one-sentence definitions of
// section 7.7, which the glossary words within this vocabulary, those of the terms of
// file 10 naming their own forecast. They are let through whatever white space a
// screen puts between their words: the two sentences of IHM-53 in two paragraphs, a
// non-breaking space before the last word of a line.
const ACCEPTED_TEXTS: readonly string[] = [
  sentence('alerts.standingNotice'),
  sentence('interface.shortNotice'),
  sentence('interface.firstLaunchPresentation'),
  sentence('notifications.closingLine'),
  ...Object.values(GLOSSARY).map((entry) => entry.text),
].map((text) => oneSpaced(text));

// The look-alikes of section 8.3 that hold a banned word, and the terms of file 10
// with the labels derived from them, the only places of "forecast" (section 8.1).
const ACCEPTED_PHRASES: readonly RegExp[] = [
  'tip-off',
  'tip-offs',
  'lock screen',
  'frozen forecast',
  'frozen forecasts',
  'late forecast',
  'late forecasts',
  'no forecast',
  'forecast source',
  'forecast sources',
  'forecast version',
  'forecast versions',
  'gap in forecast direction',
].map((phrase) => whole(phrase, 'giu'));

/** The banned words and phrases that `text` holds outside the accepted texts and phrases. */
function bettingWordsIn(text: string): readonly string[] {
  let scanned = oneSpaced(text);
  for (const accepted of [...ACCEPTED_TEXTS, ...ACCEPTED_PHRASES]) {
    scanned = scanned.replaceAll(accepted, ' ');
  }
  return BANNED.filter(({ pattern }) => pattern.test(scanned)).map(({ word }) => word);
}

/**
 * Fails when a rendered text holds a word of the banned betting vocabulary (VUE-02,
 * IHM-50, ALE-18, TEL-05, glossary section 8.2): odds, a stake, a bet, a bookmaker, a
 * tip, a prediction, or a forecast outside the terms of file 10. The fixed disclaimers,
 * the closing line of alert messages and the definitions of glossary section 7.7 may
 * hold some, as section 8 allows. Screen and message tests call it on what they show.
 */
export function assertNoBettingWords(text: string): void {
  const found = bettingWordsIn(text);
  if (found.length > 0) {
    throw new Error(`The text holds banned betting words: ${found.join(', ')}.`);
  }
}
