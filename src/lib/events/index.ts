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

// corrections.ts: applyCorrection, reassignType, markTypeLink, clearTypeLink, restampSheetVersion,
//   recordCaseLinks

// status.ts: setDetectedStatus (Lot 2)

// delete.ts: deleteHistorical

// ledger.ts: incrementWithdrawnEventCount, withdrawnEventCount, keepWithdrawnCountAtLeast,
//   recordFingerprint, matchesWithdrawalFingerprint, eraseMatchingFingerprints,
//   recordDeletedPlayer, isDeletedPlayer, purgeExpiredFingerprints

// erase.ts: eraseEvent, scrubPlayerFromCorrections

// queries.ts: getEvent, eventsOfPlayer, uncheckedSources
export { eventsOfPlayer, getEvent, uncheckedSources } from './queries';
export type {
  CalendarDerivedEvent,
  ContextIndication,
  ContextIndicationOrigin,
  ContextIndications,
  HistoricalEvent,
  ImportWarning,
  PlayerEvent,
  PlayerEventSource,
  UncheckedSource,
} from './queries';
