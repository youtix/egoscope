// The row and insert types of the tables of the event record (module map, section
// 2.4), as Drizzle derives them from the schema of `@/lib/db`.
import type {
  deletedPlayerEntries,
  eventCorrections,
  eventImportWarnings,
  eventMarks,
  events,
  eventSources,
  eventStatusChanges,
  tallyExits,
  withdrawalFingerprints,
  withdrawnEventCounter,
} from '@/lib/db';

export type EventRow = typeof events.$inferSelect;
export type NewEventRow = typeof events.$inferInsert;
export type EventSourceRow = typeof eventSources.$inferSelect;
export type NewEventSourceRow = typeof eventSources.$inferInsert;
export type EventImportWarningRow = typeof eventImportWarnings.$inferSelect;
export type NewEventImportWarningRow = typeof eventImportWarnings.$inferInsert;
export type EventMarkRow = typeof eventMarks.$inferSelect;
export type NewEventMarkRow = typeof eventMarks.$inferInsert;
export type EventStatusChangeRow = typeof eventStatusChanges.$inferSelect;
export type NewEventStatusChangeRow = typeof eventStatusChanges.$inferInsert;
export type EventCorrectionRow = typeof eventCorrections.$inferSelect;
export type NewEventCorrectionRow = typeof eventCorrections.$inferInsert;
export type TallyExitRow = typeof tallyExits.$inferSelect;
export type NewTallyExitRow = typeof tallyExits.$inferInsert;
export type WithdrawalFingerprintRow = typeof withdrawalFingerprints.$inferSelect;
export type NewWithdrawalFingerprintRow = typeof withdrawalFingerprints.$inferInsert;
export type DeletedPlayerEntryRow = typeof deletedPlayerEntries.$inferSelect;
export type NewDeletedPlayerEntryRow = typeof deletedPlayerEntries.$inferInsert;
export type WithdrawnEventCounterRow = typeof withdrawnEventCounter.$inferSelect;
export type NewWithdrawnEventCounterRow = typeof withdrawnEventCounter.$inferInsert;
