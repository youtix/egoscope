/**
 * The fixed sentences of 13 Sensitive data in English (glossary section 7), by name, in
 * commented groups, one per screen or task, each naming the requirements it serves.
 */
export const sensitiveDataSentences = {
  // The description the application writes for a calendar-derived event, naming only
  // the player and, for a former-team event, that team (CL-DSN-20, ADR 0015)
  birthdayDescription: '{player} plays on his birthday.',
  formerTeamDescription:
    '{player} faces his former team {team} for the first time since leaving it.',

  // The notice of a device whose drafts typed offline were discarded at its next contact,
  // in the withdrawn-events counter's own words (CL-DSN-22, CL-DSN-04)
  offlineDraftsDiscarded:
    'Drafts typed offline were discarded because events were withdrawn or declined for sensitivity meanwhile.',

  // An area adds its groups below, one commented group per screen or task.
} as const;
