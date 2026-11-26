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

  // The general-trend block of the type sheet (IHM-31, IHM-56, SEN-19, SEN-28): the label
  // of the count of distinct players and of the archived mark, the link to the trend screen,
  // and the empty state of a type with no case, which says why and leaves the action that
  // fills it to the screen, "Request a backtest"
  distinctPlayers: 'Players',
  archived: 'Archived',
  openGeneralTrend: 'Open the general trend',
  noCaseForType: 'No case for this type yet',
  noCaseForTypeReason:
    "No event of this type has been found yet, so there is no case and no trend. A backtest looks for a player's past events.",

  // The notices and the warning of the general-trend block (IHM-48, SEN-36, CL-SEN-13,
  // CL-SEN-16): a recalculation or a wait for statistics, with the date of the last complete
  // values shown beside it; the permanent warning of a criterion switched off for the type,
  // {criterion} being one of the five labels of the criteria that a type can switch off
  recalculationInProgress: 'Recalculation in progress',
  awaitingStatistics: 'Awaiting statistics',
  lastCompleteValuesOf: 'Last complete values of {date}',
  criterionSwitchedOff:
    'Criterion switched off for this type: {criterion}. The effect cannot be separated from it.',
  playingTimeTooLow: 'Playing time too low',
  injuryReturn: 'Return from injury',
  unusualStakes: 'Unusual stakes',
  opponentStrength: 'Opponent strength',
  coOccurring: 'Co-occurring',

  // An area adds its groups above this line, one commented group per screen or task.
} as const;
