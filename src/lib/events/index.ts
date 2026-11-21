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

// create.ts: createHistorical, createDetected, createCalendarDerived

// sources.ts: addSources, recordLinkCheck, recordSpotCheck

// corrections.ts: applyCorrection, reassignType, markTypeLink, clearTypeLink, restampSheetVersion,
//   recordCaseLinks

// status.ts: setDetectedStatus (Lot 2)

// delete.ts: deleteHistorical

// ledger.ts: incrementWithdrawnEventCount, withdrawnEventCount, keepWithdrawnCountAtLeast,
//   recordFingerprint, matchesWithdrawalFingerprint, eraseMatchingFingerprints,
//   recordDeletedPlayer, isDeletedPlayer, purgeExpiredFingerprints

// erase.ts: eraseEvent, scrubPlayerFromCorrections

// queries.ts: getEvent, eventsOfPlayer, uncheckedSources
