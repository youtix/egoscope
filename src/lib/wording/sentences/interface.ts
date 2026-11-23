/**
 * The fixed sentences of 12 Interface and access in English (glossary section 7), by
 * name, in commented groups, one per screen or task, each naming the requirements it
 * serves.
 */
export const interfaceSentences = {
  // The short notice of the profile and validation screens, which links to Method and
  // limits (IHM-50)
  shortNotice: 'A measure of the past, an unproven hypothesis, no betting recommendation',

  // Home at first launch (IHM-53)
  firstLaunchPresentation:
    'Egoscope measures how followed players played after public events. It does not predict games or give betting advice.',

  // Empty states, each with the action that fills it: no player (IHM-54); no validated
  // type (IHM-55, CA-IHM-13); a player without a backtest, a type without a case of the
  // backtest of {date}, nothing to do, and in Lot 2 no alert and no press source (IHM-56)
  addPlayer: 'Add a player',
  noValidatedType: 'no validated type',
  noBacktestYet: 'no backtest yet',
  requestBacktest: 'Request a backtest',
  noEventOfType: 'no event of this type found by the backtest of {date}',
  nothingToDo: 'Nothing to do right now',
  noAlertYet: 'an alert is produced when a profiled player has a new event',
  noPressSource: 'detection cannot work',

  // The figures of ui/figures: the split of the valid cases by origin, "7 valid cases:
  // 5 historical, 2 tracked", which names only the origins that hold cases (IHM-46,
  // CL-IHM-24); the active filter of a profile list and its total, '3 "probable"
  // profiles of 41' (IHM-49); the link of the short notice (IHM-50, IHM-69)
  bothOrigins: '{k} valid {k|case|cases}: {historical} historical, {tracked} tracked',
  historicalOnly: '{k} valid {k|case|cases}: {k} historical',
  trackedOnly: '{k} valid {k|case|cases}: {k} tracked',
  filterSummary: '{k} "{filter}" {k|profile|profiles} of {total}',
  methodAndLimits: 'Method and limits',

  // An area adds its groups below, one commented group per screen or task.
} as const;
