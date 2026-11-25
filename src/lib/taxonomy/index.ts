// The public API of the event types (module map, section 2.4): the types of types.ts,
// then one slot per other file that the plan gives the module, with the operations
// it will export. A task adds its exports in its own file's slot only (section 9).

// types.ts
export type {
  EventTypeRow,
  EventTypeStatusChangeRow,
  NewEventTypeRow,
  NewEventTypeStatusChangeRow,
  NewTypeIllustrationSourceRow,
  NewTypeOccurrenceRow,
  NewTypeSheetChangeRow,
  NewTypeSheetVersionRow,
  TypeIllustrationSourceRow,
  TypeOccurrenceRow,
  TypeSheetChangeRow,
  TypeSheetVersionRow,
} from './types';

// seed.ts
export { seedCandidateTypes } from './seed';

// proposals.ts
export { createProposal, editProposal } from './proposals';
export type {
  CoverageThreshold,
  DocumentationDifficulty,
  InvalidProposalFields,
  ProposalEdit,
  ProposalEditRefusal,
  ProposalFieldErrors,
  ProposalOrigin,
  ProposalSheet,
  SwitchedOffCriterion,
} from './proposals';

// validate.ts: validate, checklistFor

// modify.ts: modify, defaultQualification, recordProposedSupplements

// criterion-switch.ts: setSwitchedOffCriterion

// merge.ts: merge

// split.ts: split

// review-events.ts: requalifyEvent, distributeEvent, eventsToReview

// lifecycle.ts: reject, reopen, withdrawType, reactivate

// exploration.ts: generateExplorationPrompt, previewExplorationResponse, createFromExploration

// detection-proposals.ts: receiveDetectionProposal, addOccurrence, attachAsOccurrence,
//   detachOccurrence, eraseOccurrencesOf, proposalArticleReferences (Lot 2)

// queries.ts: listByStatus, getType, validatedSheets, handledByCalendarList, doNotReproposeList,
//   resolveTypeId, versionCounters, sheetHistory, possibleDuplicates
