// The public API of the alert sheets (module map, section 2.5): the types of types.ts,
// then one slot per other file that the plan gives the module, with the operations
// it will export. A task adds its exports in its own file's slot only (section 9).

// types.ts
export type {
  AlertSheetCaveatRow,
  AlertSheetEventRow,
  AlertSheetExpectedGameRow,
  AlertSheetOutcomeRow,
  AlertSheetRow,
  AlertSheetSectionRow,
  AlertSheetSnapshotRow,
  AlertSheetUpdateRow,
  NewAlertSheetCaveatRow,
  NewAlertSheetEventRow,
  NewAlertSheetExpectedGameRow,
  NewAlertSheetOutcomeRow,
  NewAlertSheetRow,
  NewAlertSheetSectionRow,
  NewAlertSheetSnapshotRow,
  NewAlertSheetUpdateRow,
} from './types';

// produce.ts: produceForPass, produceAfterImport, completeProfileValues, addEvent
// update.ts: addSource, onEventDismissed, onEventReinstated, onExpectedGameChanged, refreshExpectedGames, onContextCorrected, recordProfileChanges
// membership.ts: onAttachmentCorrected, onCalendarEventDropped
// close.ts: recordOutcomeChange, close
// queries.ts: list, get, sheetOfEvent, openSheets, lateSheets
// erase.ts: eraseEventData, erasePlayerData, erasedWith
