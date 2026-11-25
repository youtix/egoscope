// The public API of the research-result import (module map, section 2.4): the types of types.ts,
// then one slot per other file that the plan gives the module, with the operations
// it will export. A task adds its exports in its own file's slot only (section 9).

// types.ts
export type {
  ImportEventOutcomeRow,
  ImportPossibleDuplicateRow,
  ImportRow,
  NewImportEventOutcomeRow,
  NewImportPossibleDuplicateRow,
  NewImportRow,
} from './types';

// preview.ts: check

// save.ts: save

// correction-message.ts: correctionMessage

// historical-edit.ts: correctHistorical, deleteHistorical

// link-checks.ts: processLinkChecks, nextDueAt

// queries.ts: history, remainingRefusals, eventTrace
export { eventTrace, history, remainingRefusals, remainingRefusalSum } from './queries';
export type {
  EventTrace,
  ImportHistoryEntry,
  ImportTally,
  RemainingRefusal,
  TracedSource,
} from './queries';

// erase.ts: eraseEventData
export { eraseEventData } from './erase';
