/**
 * The fixed sentences of 08 Sensitivity and verdict in English (glossary section 7), by
 * name, in commented groups, one per screen or task, each naming the requirements it
 * serves.
 */
export const sensitivitySentences = {
  // Every general trend shown, beside a profile or on its own (SEN-30)
  generalTrendReminder: 'The general trend describes all observed players, not any one of them.',

  // A profile under the case threshold of H-03, {n} being the threshold in force, and
  // "case" agreeing with the count {k}, "1 valid case" (SEN-31, CL-SEN-15, CL-TEL-16)
  inconclusiveForPlayer:
    'inconclusive for this player ({k} valid {k|case|cases} of the {n} needed)',
  generalTrendTitle: 'general trend of the type, does not describe this player',

  // The figures of ui/figures (SEN-38, SEN-39, IHM-45, IHM-47): the mean gap's label;
  // its plausible range, as the example of 08 writes it, "from +0.09 to +1.51"; the
  // valid-case count; a verdict's level and its written direction, "possible,
  // increase" (glossary section 7.2, SEN-23, SEN-24); the profile confidence (SEN-25);
  // a proportion as counts below the case number of SEN-39, "5 of 7" (CL-SEN-21)
  meanGap: 'Mean gap',
  rangeBounds: 'from {low} to {high}',
  validCaseCount: '{k} valid {k|case|cases}',
  inconclusive: 'inconclusive',
  possible: 'possible',
  probable: 'probable',
  increase: 'increase',
  decrease: 'decrease',
  levelAndDirection: '{level}, {direction}',
  lowConfidence: 'Low',
  mediumConfidence: 'Medium',
  highConfidence: 'High',
  proportionAsCounts: '{k} of {m}',

  // The case detail (IHM-25, IHM-46, IHM-52, SEN-16 to SEN-18, CL-SEN-11, CL-VUE-15):
  // the labels of its facts, as glossary sections 3.3, 3.6 and 3.7 give them; the
  // mentions of glossary section 7.2; where a source was published, the opponent of the
  // measured game by his team's full name, the link to the event's sheet (IHM-67) and
  // the games of the baseline; the status a manual decision found (SEN-17); and the
  // values that triggered each criterion (SEN-11 to SEN-15, SEN-06), "case" and "game"
  // agreeing with their counts
  caseOrigin: 'Origin',
  caseStatus: 'Status',
  statusReason: 'Reason',
  sources: 'Sources',
  referenceDate: 'Reference date',
  returnFromInjury: 'Return from injury',
  gameStakes: 'Game stakes',
  gameScore: 'Game Score',
  minutesPlayed: 'MIN',
  season: 'Season',
  baselinePhase: 'Baseline',
  seasonMean: 'Mean',
  seasonStandardDeviation: 'SD',
  criteriaMet: 'Criteria met',
  notEvaluable: 'Not evaluable',
  flaggedForReview: 'Flagged for review',
  manualDecision: 'Manual decision',
  comment: 'Comment',
  caseHistory: 'History',
  changeCause: 'Cause',
  roundedMinutes: 'rounded minutes',
  partialBaseline: 'partial',
  uncertainPrecedence: 'uncertain precedence',
  coOccurring: 'co-occurring',
  noEjectionReported:
    'The stats source does not report ejections, so an ejection is flagged only if you notice it.',
  publishedOn: 'Published {date}',
  againstTeam: 'against {location} {name}',
  openTheEvent: 'Open the event',
  baselineGames: '{k} {k|game|games}',
  statusBeforeDecision: 'Status before the decision: {status}',
  playingTimeValues: '{minutes} minutes played, under the threshold of {threshold}',
  injuryReturnFlaggedValues: 'Return from injury: {value}',
  injuryReturnCalculatedValues:
    '{k} team {k|game|games} missed in a row before the game, {m} of them without a box score',
  gameStakesFlaggedValues: 'Game stakes: {value}',
  playInGameValues: 'A play-in game',
  eliminationGameValues: 'A playoff game that eliminates one of the two teams',
  playoffGameValues: 'A playoff game',
  opponentRecordValues: "The opponent's record this season: {w} {w|win|wins}, {l} {l|loss|losses}",
  previousOpponentRecordValues:
    "The opponent's final record last season: {w} {w|win|wins}, {l} {l|loss|losses}",
  coOccurringValues: 'Same game as a case of {type}',

  // An area adds its groups above this line, one commented group per screen or task.
} as const;
