/**
 * The fixed sentences of 14 Cross-cutting requirements in English (glossary section 7),
 * by name, in commented groups, one per screen or task, each naming the requirements it
 * serves.
 */
export const crossCuttingSentences = {
  // The activity journal: how an entry names an item that an erasure removed, a deleted
  // player and any other item, and how it records a withdrawal, which names nothing
  // (CL-TRV-10, CL-JOU-24)
  eventWithdrawn: 'an event was withdrawn',
  itemNoLongerExists: 'an item that no longer exists',
  deletedPlayer: 'a deleted player',

  // The quota use in plain words that the status screen lists, its reset in the owner's
  // zone, which the screen states once at its top; a limit not entered yet; and the
  // reference values the app does not enforce (TRV-03, TRV-46, CL-TRV-12)
  quotaUseToday: '{service}: {used} of {limit} today, resets at {time}',
  quotaUseThisMonth: '{service}: {used} of {limit} this month, resets on {date}',
  quotaUseThisMinute: '{service}: {used} of {limit} this minute, resets at {time}',
  quotaUseThisSecond: '{service}: {used} of {limit} this second',
  quotaUseLastMinute: '{service}: {used} of {limit} over the last minute',
  quotaUseLast24Hours: '{service}: {used} of {limit} over the last 24 hours',
  quotaLimitNotEntered: '{limit}: not entered yet',
  quotaReferenceValue: '{limit}: {value}, a reference value that the app does not enforce',
  quotaServiceStatsSource: 'Stats source',
  quotaServiceWorkersAi: 'Workers AI',
  quotaServiceGroq: 'Groq',
  quotaServiceBackupStorage: 'Backup storage',
  quotaServiceTelegram: 'Telegram',
  quotaServiceDatabase: 'Database',

  // An area adds its groups above this line, one commented group per screen or task.
} as const;
