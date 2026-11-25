// The public API of the event record (module map, section 2.4): the types of types.ts,
// then one slot per other file that the plan gives the module, with the operations
// it will export. A task adds its exports in its own file's slot only (section 9).

// types.ts
export type {
  DeletedPlayerEntryRow,
  EventCorrectionRow,
  EventImportWarningRow,
  EventMarkRow,
  EventRow,
  EventSourceRow,
  EventStatusChangeRow,
  NewDeletedPlayerEntryRow,
  NewEventCorrectionRow,
  NewEventImportWarningRow,
  NewEventMarkRow,
  NewEventRow,
  NewEventSourceRow,
  NewEventStatusChangeRow,
  NewTallyExitRow,
  NewWithdrawalFingerprintRow,
  NewWithdrawnEventCounterRow,
  TallyExitRow,
  WithdrawalFingerprintRow,
  WithdrawnEventCounterRow,
} from './types';

// create.ts: createHistorical, createCalendarDerived (createDetected sits in status.ts)
export { createCalendarDerived, createHistorical } from './create';
export type {
  CalendarCreation,
  CalendarDescription,
  CreatedHistorical,
  HistoricalImport,
  HistoricalRefusal,
  NewCalendarDerivedEvent,
  NewHistoricalEvent,
  NewImportWarning,
  TextRefusal,
} from './create';

// sources.ts: addSources, recordLinkCheck, recordSpotCheck
export { addSources, recordLinkCheck, recordSpotCheck } from './sources';
export type {
  DateOrInstant,
  LinkStatus,
  NewSource,
  SourceAddition,
  SourceGone,
  SpotCheckVerdict,
} from './sources';

// corrections.ts
export { applyCorrection } from './corrections';
export type { Corrected, CorrectionRefusal, EventCorrection } from './corrections';
export {
  clearTypeLink,
  markTypeLink,
  reassignType,
  recordCaseLinks,
  restampSheetVersion,
} from './links';
export type { CaseLink, TypeNotValidated } from './links';
export type {
  CorrectedField,
  CorrectionFieldErrors,
  EventChanges,
  TextProblem,
} from './correction-fields';
export type { CorrectedSource, PublicDate } from './correction-sources';

// status.ts (Lot 2): createDetected, setDetectedStatus; the detected branch of applyCorrection
export { createDetected, setDetectedStatus } from './status';
export type {
  DetectedStatusChange,
  NewDetectedEvent,
  NewDismissal,
  StatusRefusal,
  StatusSaved,
} from './status';

// delete.ts
export { deleteHistorical } from './delete';
export type { DeletionReason, DeletionRefusal, HistoricalDeletion } from './delete';

// ledger.ts: incrementWithdrawnEventCount, withdrawnEventCount, keepWithdrawnCountAtLeast,
//   recordFingerprint, matchesWithdrawalFingerprint, eraseMatchingFingerprints,
//   recordDeletedPlayer, isDeletedPlayer, purgeExpiredFingerprints

// erase.ts
export { eraseEvent, scrubPlayerFromCorrections } from './erase';
export type { ErasedEvent, ErasureVariant } from './erase';

// queries.ts: getEvent, eventsOfPlayer, uncheckedSources, and the views they give
export { eventsOfPlayer, getEvent, uncheckedSources } from './queries';
export type { UncheckedSource } from './queries';
export type {
  CalendarDerivedEvent,
  ClassificationOrigin,
  ContextIndication,
  ContextIndicationOrigin,
  ContextIndications,
  DetectedEvent,
  DetectedEventMark,
  DetectedReference,
  DetectedState,
  DismissalReason,
  HistoricalEvent,
  ImportWarning,
  OwnerAddedSource,
  PlayerEvent,
  PlayerEventSource,
  ReferenceDateRule,
  StatusChange,
  StoredEventMark,
} from './views';
