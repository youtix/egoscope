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

  // An area adds its groups below, one commented group per screen or task.
} as const;
