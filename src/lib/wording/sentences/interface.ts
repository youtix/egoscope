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

  // The consequence that the to-do list gives each open incident, in plain words (IHM-20,
  // TRV-42)
  incidentConsequencePressSourceDown: 'Articles from this source are no longer collected.',
  incidentConsequenceCollectionImpossible: 'No article is collected until a source answers again.',
  incidentConsequencePressSourceSilent: 'Events that only this source reports may be missed.',
  incidentConsequenceFeedTooShort: 'Articles published between two collection runs may be missed.',
  incidentConsequenceQuotaReached: 'The service stops working until this is resolved.',
  incidentConsequenceQuotaWarning: 'The service may stop working before its quota renews.',
  incidentConsequenceDatabaseVolumeWarning:
    'The database may soon be full and stop accepting new data.',
  incidentConsequenceStatsSourceUnavailable: 'Statistics are no longer updated.',
  incidentConsequenceStatsSourceSchemaChanged:
    'The statistics file that changed is not read, so its figures are not updated.',
  incidentConsequenceTaskNotRun: 'The task did not run, so its work is late.',
  incidentConsequenceBackupFailed: 'Your data has no recent backup.',
  incidentConsequenceLoginsRefused: 'Signing in is locked after repeated failures.',
  incidentConsequenceTelegramLinkBroken: 'Telegram messages are not delivered.',
  incidentConsequenceExportReminder: 'Your data has no recent full export.',

  // An area adds its groups below, one commented group per screen or task.
} as const;
