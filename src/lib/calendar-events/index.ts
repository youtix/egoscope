// The public API of the calendar-derived events (module map, section 2.4): the types of types.ts,
// then one slot per other file that the plan gives the module, with the operations
// it will export. A task adds its exports in its own file's slot only (section 9).

// types.ts
export type {
  CalendarDerivationRequestRow,
  DerivationDrop,
  DerivationDropReason,
  DerivationReactions,
  NewCalendarDerivationRequestRow,
} from './types';

// derive.ts: processDerivations, previewBirthdayChange

// requests.ts: requestDerivation, nextDueAt
