// The terms of the 00 glossary that screens show, each with its label and its
// one-sentence definition (IHM-15): the definitions of glossary section 7.7, verbatim,
// written for the owner, never the Meaning column of sections 3 and 4, a note for
// engineers. A term that section 7.7 does not define, such as the retained dispersion,
// is never shown and has no entry. One key gives both, so that a screen renders the
// first label of a term as a GlossaryTerm (coordinator decision, gap h).
//
// A term's label is the UI label of its row in glossary section 3, the label screens
// show it under: "Gap" for the normalized gap, "Range" for the plausible range. A term
// with two rows takes the label of the row that names the term itself: "Tracked case"
// of section 3.11, not the case origin "Tracked"; "Sheet version" of section 3.3, not
// the "Version" of a type's version list. Two terms have no label of their own there
// and keep their name: the historical case, whose "Historical" is a case origin, and
// the dismissal, whose "Dismiss" and "Dismissed" are an action and a status.

/** The label of a term that screens show, and its one-sentence definition (IHM-15). */
export type GlossaryEntry = Readonly<{ label: string; text: string }>;

/** Each term of glossary section 7.7, by its English term in camelCase. */
export const GLOSSARY = {
  followedPlayer: { label: 'Player', text: 'An NBA player you put on the follow list.' },
  eventType: {
    label: 'Type',
    text: 'A category of events, defined by a type sheet you validated.',
  },
  typeSheet: {
    label: 'Type sheet',
    text: 'The definition of an event type: what it covers, its inclusion and exclusion criteria, and an example.',
  },
  article: { label: 'Article', text: 'A press item collected from a news feed.' },
  event: {
    label: 'Event',
    text: 'A public, dated fact about a followed player that may touch his ego, filed under one event type and dated by the moment it became public.',
  },
  detectedEvent: {
    label: 'Detected event',
    text: 'An event that the daily detection found in the press.',
  },
  historicalEvent: { label: 'Historical event', text: 'A past event that a backtest reported.' },
  backtest: {
    label: 'Backtest',
    text: "The search for all of a player's past events, followed by the measure of his performance in the games concerned.",
  },
  backtestRequest: {
    label: 'Backtest request',
    text: 'A request to you to run a deep research for one player.',
  },
  researchPrompt: {
    label: 'Prompt',
    text: 'The text the app writes for you to paste into a deep-research AI.',
  },
  researchResult: {
    label: 'Research result',
    text: 'The JSON that the research AI returns and you paste into the app.',
  },
  measuredGame: {
    label: 'Measured game',
    text: 'The first game the player played after the event became public.',
  },
  case: {
    label: 'Case',
    text: 'An event and its measured game, the unit every calculation counts.',
  },
  historicalCase: {
    label: 'Historical case',
    text: 'A case that comes from a backtest, or from a game read in the calendar after it started.',
  },
  trackedCase: {
    label: 'Tracked case',
    text: 'A case observed in real conditions: from a detected event, or from a game read in the calendar before it started.',
  },
  performanceIndex: {
    label: 'Index',
    text: "The game's Game Score divided by the minutes played.",
  },
  seasonBaseline: {
    label: 'Season baseline',
    text: "The mean and standard deviation of the player's performance index over the season.",
  },
  normalizedGap: {
    label: 'Gap',
    text: "How far the measured game's performance index is from the season mean, in season standard deviations.",
  },
  doubtfulCase: {
    label: 'Doubtful case',
    text: 'A case left out of the calculations because a confounding factor may explain the game.',
  },
  sensitivityProfile: {
    label: 'Profile',
    text: 'For one player and one event type, the number of valid cases, the mean gap, the verdict and the profile confidence.',
  },
  generalTrend: {
    label: 'General trend',
    text: 'The same calculation for one event type, over all followed players.',
  },
  verdict: {
    label: 'Verdict',
    text: 'The conclusion of a profile or a trend: probable, possible or inconclusive.',
  },
  alertSheet: {
    label: 'Alert sheet',
    text: 'The full write-up the app produces when a profiled player has a new event.',
  },
  validationTable: {
    label: 'Validation table',
    text: 'The view that sets the profiles against the tracked cases.',
  },
  precedence: {
    label: 'Precedence',
    text: 'For a historical event, whether its sources came before the tip-off of its measured game: established, uncertain, not established, or to verify while game dates are missing, the last two giving no counted case.',
  },
  assessment: {
    label: 'Assessment',
    text: 'The conclusion of a row of the validation table, given only from a minimum number of tracked cases with a forecast: confirmed, confirmed with a weaker effect than announced, refuted or undecided.',
  },
  coOccurringCase: {
    label: 'Co-occurring',
    text: 'A case whose measured game is also that of an event of another type; it counts in the profile of each of these types and carries this mark.',
  },
  recordedInTime: {
    label: 'Recorded in time',
    text: "A tracked case created before its measured game's scheduled start; only these cases test the hypothesis, the others being counted apart as recorded after tip-off.",
  },
  validCase: {
    label: 'Valid case',
    text: 'A measured case whose normalized gap is computed with no doubtful-case criterion met; only valid cases enter a verdict.',
  },
  caseCategory: {
    label: 'Category',
    text: 'Where a valid tracked case stands against its frozen forecast: confirmed, refuted, neutral or no forecast.',
  },
  supplementaryRequest: {
    label: 'Supplementary request',
    text: "A backtest request that covers only what the player's coverage lacks: a type validated since, a period gone by, or a gap an import left.",
  },
  detectionConfidence: {
    label: 'Detection confidence',
    text: "A score from 0 to 100 that the classification gives a fact, the model's own rating rather than a probability; below the detection threshold, no event is created.",
  },
  researchConfidence: {
    label: 'Research confidence',
    text: "The level, high, medium or low, that the research AI gives each historical event under the prompt's rule.",
  },
  profileConfidence: {
    label: 'Profile confidence',
    text: 'The level, low, medium or high, of a profile or a general trend, which says what its verdict rests on.',
  },
  statsSourceMapping: {
    label: 'Stats-source mapping',
    text: 'The pairing of a followed player with his record in the stats source, which you check and approve.',
  },
  coverage: {
    label: 'Coverage',
    text: 'For a player, the event types and periods that an imported research result already covers, even an empty one: a player with no covered period has no backtest, the others are profiled.',
  },
  dismissal: {
    label: 'Dismissal',
    text: 'Your correction of a detection error: the detected event becomes dismissed and leaves every calculation without being erased; you can undo it, and it never depends on the result of the game.',
  },
  alertSheetStatus: {
    label: 'Status',
    text: 'Open while one of its events awaits its game, closed when their cases are measured, excluded or not measurable, and canceled when all its events are dismissed or a correction leaves it no event for this player; the late mark can come on top.',
  },
  seasonBaselineStatus: {
    label: 'Status',
    text: 'Final, provisional, being built or insufficient, sometimes marked partial; only a final or provisional baseline lets a case be measured.',
  },
  boxScore: {
    label: 'Box score',
    text: "A player's individual statistics for one game, from which the Game Score is computed.",
  },
  lateSheet: {
    label: 'Late',
    text: 'An alert sheet produced, or completed with the profile values, after the tip-off of its measured game; it is kept for the history and the validation.',
  },
  plausibleRange: {
    label: 'Range',
    text: 'Twice the expected noise on either side of the mean gap, shown with it to show the uncertainty that comes from the number of cases.',
  },
  referenceInstant: {
    label: 'Reference instant',
    text: 'The moment an event is taken to have become public, from which its measured game is searched; a date without a time is moved, for caution, to the end of that day, except for an event known in advance.',
  },
  profiledPlayer: {
    label: 'Profiled',
    text: 'A followed player for whom at least one research result has been imported, even an empty one.',
  },
  toDoList: { label: 'To do', text: 'The actions in the app that are waiting for you.' },
  usableGame: {
    label: 'Usable',
    text: 'A game the player played whose box score is complete and consistent and in which he reached the playing-time threshold; only these games enter a season baseline.',
  },
  pass: {
    label: 'Pass',
    text: "One run of a scheduled task, such as the day's collection and detection or the statistics fetched after the games.",
  },
  quietHours: {
    label: 'Quiet hours',
    text: 'Hours you set during which no Telegram message leaves, except an urgent one before a game; the held messages leave together when they end.',
  },
  frozenForecast: {
    label: 'Frozen forecast',
    text: "For a tracked case, the last version before its measured game's scheduled start of the verdict drawn from historical cases only, the player's profile when it reaches the case threshold and otherwise the general trend; the case is judged against it.",
  },
  lateForecast: {
    label: 'Late forecast',
    text: 'The forecast of a tracked case that had none at tip-off, for lack of an imported backtest or of measured historical cases, computed once that profile exists and counted apart, since the result of the case was already known.',
  },
  explorationPrompt: {
    label: 'Explore new types',
    text: 'The text the app writes for you to paste into a deep-research AI to get proposals of clean and datable event types.',
  },
  typeProposal: {
    label: 'Proposal',
    text: 'An event type with the proposed status: its sheet is not validated yet, and it serves no calculation.',
  },
  signalToNoiseRatio: {
    label: 'Signal-to-noise',
    text: "A profile's mean gap divided by the expected noise, the size that chance commonly gives a mean of that many cases; the verdict depends on it.",
  },
  deepResearch: {
    label: 'Deep research',
    text: 'A mode of an AI that explores the web at length and returns a sourced result; you use it outside the app.',
  },
  remainingRefusals: {
    label: 'Remaining refusals',
    text: "The events refused at a request's last import, which the backtest lacks until they are corrected and imported again; they show with the request and beside the profile.",
  },
  datingRule: {
    label: 'Dating rule',
    text: 'The part of a type sheet that says how an event of the type gets its reference date, and whether its events are known in advance.',
  },
  fullRedo: {
    label: 'Full redo',
    text: 'A backtest request that redoes, for a profiled player, every validated type over his whole career; at the import, you can replace what exists.',
  },
  eventWithdrawal: {
    label: 'Withdraw and erase',
    text: "Your permanent erasure of an event and its traces, for a sensitivity reason, which only a global counter of withdrawn events records, unlike a dismissal, an exclusion or a player's or type's withdrawal, which erase nothing.",
  },
  playingTimeThreshold: {
    label: 'Playing-time threshold',
    text: 'The playing time below which a game is not usable; a case whose measured game falls below it is a doubtful case.',
  },
  nameVariants: {
    label: 'Name variants',
    text: 'The display name, spellings and nicknames under which the press names a followed player.',
  },
  fragileVerdict: {
    label: 'Fragile',
    text: 'A verdict whose level or direction changes when the case that supports it most is set aside; the profile confidence then drops one level.',
  },
  sheetVersion: {
    label: 'Sheet version',
    text: 'The dated content of a type sheet; every event keeps the version it was qualified under.',
  },
} as const satisfies Readonly<Record<string, GlossaryEntry>>;

/** A term that a screen shows with its one-sentence definition (IHM-15): `'normalizedGap'`. */
export type DefinedTerm = keyof typeof GLOSSARY;

/**
 * A term's label and its one-sentence definition, under one key, so that a screen
 * renders the term's first label as a GlossaryTerm, which opens the definition with
 * one tap (IHM-15, VUE-08, CL-VUE-02): for `normalizedGap`, the label "Gap" and "How
 * far the measured game's performance index is from the season mean, in season
 * standard deviations."
 */
export function definition(term: DefinedTerm): GlossaryEntry {
  return GLOSSARY[term];
}
