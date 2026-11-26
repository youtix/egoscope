/**
 * The fixed sentences of 02 Event taxonomy in English (glossary section 7), by name, in
 * commented groups, one per screen or task, each naming the requirements it serves.
 */
export const taxonomySentences = {
  // Appended to the dating rule of a sheet that has a coverage threshold, wherever the
  // sheet is sent, {N} distinct outlets within {D} days (CL-TAX-14, TAX-33)
  coverageThreshold: 'Coverage threshold: {N} distinct outlets within {D} days.',

  // The Types screen (IHM-31, TAX-10, TAX-15, CL-TAX-20): the number of types of a state,
  // the label of a type's origin and the UI labels of the EventTypeOrigin set (glossary
  // section 4.1), and the mark of the dating rule of a calendar-derived type
  typeCount: '{k} {k|type|types}',
  origin: 'Origin',
  originScoping: 'Scoping',
  originExploration: 'Exploration',
  originDetection: 'Detection',
  derivedFromCalendar: 'derived from the calendar',

  // The versions block of the type sheet: its titles, the facts of a version and of a
  // history entry, and the empty and failure states (TAX-20, TAX-21, TAX-26, CL-TAX-06,
  // CA-TAX-14, IHM-56)
  versionsTitle: 'Versions',
  changeHistoryTitle: 'Change history',
  versionDate: 'Date',
  versionReason: 'Reason',
  changeKind: 'Kind of change',
  countConforms: 'Conforms to the new version',
  countReassigned: 'Reassigned to another validated type',
  countErased: 'Erased',
  countSupplements: 'Supplementary requests proposed',
  noVersionTitle: 'No version yet',
  noVersionProposed:
    'A proposal has no version: the first one is created when you validate the type.',
  noVersionRejected:
    'A rejected proposal was never validated, so it has no version. Reopen it to validate it.',
  validateTypeAction: 'Validate this type',
  noChangeTitle: 'No change recorded yet',
  noChangeReason:
    'Every change you save to a validated sheet is recorded here, with its date, its kind, its reason and the content before and after.',
  versionsUnavailable: 'The versions could not be read: reload the screen to try again.',

  // The kinds of a version, the scopes of a substantive change and the kinds of an entry
  // of the change history (TAX-20, TAX-21, TAX-22, TAX-27, CL-TAX-06, CL-TAX-17)
  versionKindValidation: 'Validation',
  substantiveChange: 'Substantive change',
  versionKindMerge: 'Merge',
  scopeBroadens: 'Broadens the type',
  scopeNarrows: 'Narrows the type',
  scopeBoth: 'Both',
  changeKindFormal: 'Formal change',
  changeKindCriterionSwitch: 'Criterion switch changed',

  // The content before and after of a history entry, on demand: the fields of a sheet that
  // the change touched, with the value that a field has when it is empty, true or false
  // (TAX-21, CL-TAX-17)
  showContentChange: 'Show the content before and after',
  contentBefore: 'Before',
  contentAfter: 'After',
  fieldName: 'Name',
  fieldDefinition: 'Definition',
  fieldInclusionCriteria: 'Inclusion criteria',
  fieldExclusionCriteria: 'Exclusion criteria',
  fieldDatingRule: 'Dating rule',
  fieldKnownInAdvance: 'Known in advance',
  fieldExample: 'Example',
  fieldDocumentationDifficulty: 'Documentation difficulty',
  fieldCautionNotes: 'Caution notes',
  fieldIntimateSubject: 'Intimate subject',
  fieldCoverageThresholdOutlets: 'Coverage threshold, outlets',
  fieldCoverageThresholdDays: 'Coverage threshold, days',
  fieldCriterionSwitchedOff: 'Criterion switched off',
  difficultyEasy: 'Easy',
  difficultyMedium: 'Medium',
  difficultyHard: 'Hard',
  criterionPlayingTimeTooLow: 'Playing time too low',
  criterionInjuryReturn: 'Return from injury',
  criterionUnusualStakes: 'Unusual stakes',
  criterionOpponentStrength: 'Opponent strength',
  criterionCoOccurring: 'Co-occurring',
  valueNone: 'None',
  valueYes: 'Yes',
  valueNo: 'No',

  // An area adds its groups above this line, one commented group per screen or task.
} as const;
