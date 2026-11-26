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

  // The paste area of the import screen: its labels, what it says of the clipboard, the file
  // and the text received, and the confirmation of discarding the draft (IMP-02, IHM-28,
  // IHM-42, IHM-58, CL-IMP-27)
  pasteAreaLabel: 'Pasted text',
  pasteButton: 'Paste',
  chooseTextFile: 'Choose a text file',
  clipboardRefused:
    'Your phone did not allow reading the clipboard. Press and hold in the field, then choose Paste.',
  fileTooLarge: 'This file is {size} MB, over the {limit} MB limit: choose a smaller text file.',
  fileUnreadable: 'This file could not be read as text: choose another file or paste the text.',
  charactersReceived: '{k} {k|character|characters} received',
  endOfText: 'End of the text',
  checkButton: 'Check',
  clearButton: 'Clear',
  checkNeedsText: 'Paste the result first.',
  checkFailedTitle: 'The text could not be checked',
  discardDraftButton: 'Discard draft',
  discardDraftTitle: 'Discard this draft?',
  discardDraftDescription:
    'The pasted text is deleted from this device and from the app. This cannot be undone.',
  keepDraft: 'Keep the draft',
  discardDraftContinue: 'Continue discarding',
  discardDraftSecondTitle: 'Discard the draft for good?',
  discardDraftSecondDescription:
    'Once discarded, the pasted text is gone: only pasting it again brings it back.',
  discardDraftForGood: 'Discard the draft for good',
  discardNeedsNetwork:
    'The draft can only be discarded while you are online. Connect, then try again.',
  discardFailedTitle: 'The draft was not discarded',
  loadingDraft: 'Loading the draft',

  // An area adds its groups above this line, one commented group per screen or task.
} as const;
