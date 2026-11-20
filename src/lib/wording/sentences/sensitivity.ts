/**
 * The fixed sentences of 08 Sensitivity and verdict in English (glossary section 7), by
 * name, in commented groups, one per screen or task, each naming the requirements it
 * serves.
 */
export const sensitivitySentences = {
  // Every general trend shown, beside a profile or on its own (SEN-30)
  generalTrendReminder: 'The general trend describes all observed players, not any one of them.',

  // A profile under the case threshold of H-03, {n} being the threshold in force (SEN-31)
  inconclusiveForPlayer: 'inconclusive for this player ({k} valid cases of the {n} needed)',
  generalTrendTitle: 'general trend of the type, does not describe this player',

  // An area adds its groups below, one commented group per screen or task.
} as const;
