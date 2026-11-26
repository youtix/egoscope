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

// queries.ts, with type-detail.ts and duplicates.ts beside it for the size limits
export {
  doNotReproposeList,
  handledByCalendarList,
  listByStatus,
  resolveTypeId,
  resolveTypeIds,
  sheetContent,
  validatedSheets,
} from './queries';
export type {
  CalendarDerivation,
  EventTypeOrigin,
  EventTypeStatus,
  ExplorationEntry,
  ListedType,
  NamedType,
  SheetContent,
  SheetPurpose,
  StatusGroup,
  TypeRef,
  TypeRejectionReason,
  TypeResolution,
  TypeWithdrawalReasonKind,
  ValidatedSheet,
} from './queries';
export { eventsToReview, getType, sheetHistory, versionCounters } from './type-detail';
export type {
  EventToReview,
  SheetChangeContent,
  SheetHistoryEntry,
  StatusTransition,
  TypeDetail,
  TypeLinkMark,
  VersionCounters,
} from './type-detail';
export { duplicateCloseness, possibleDuplicates } from './duplicates';
export type { Closeness, DuplicateCandidate, PossibleDuplicate } from './duplicates';
