/**
 * The fixed sentences of 06 Research-result import in English (glossary section 7), by
 * name, in commented groups, one per screen or task, each naming the requirements it
 * serves.
 */
export const importsSentences = {
  // The recovery notice of a cut result, by where the cut fell, {lost} naming the lists
  // that it lost, and the label of the save button that accepts the recovery (IMP-05,
  // CL-IMP-18, coordinator decision of 20 November)
  recoveryDuringEvents:
    'The answer stops during event {n}. {k} complete {k|event|events} can be recovered: the covered period then ends on {date}, and {lost}. To get the rest instead, copy the correction message for the AI.',
  recoveryAfterEvents:
    'The answer stops after its events. Its {k} {k|event is|events are all} complete and can be recovered: the covered period stays as declared, and {lost}. To get the rest instead, copy the correction message for the AI.',
  recoveryAfterEventsNothingLost:
    'The answer stops after its events. Its {k} {k|event is|events are all} complete and can be recovered: the covered period stays as declared, and nothing is lost.',
  leadsAndLimitationsLost: 'the leads and limitations are lost',
  leadsLost: 'the leads are lost',
  limitationsLost: 'the limitations are lost',
  nothingElseLost: 'nothing else is lost',
  saveRecoveredEvents: 'Save {k} recovered {k|event|events}',
  saveRecoveredResult: 'Save the recovered result',

  // An area adds its groups below, one commented group per screen or task.
} as const;
