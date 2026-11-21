// The row and insert types of the tables of the research-result import (module map, section
// 2.4), as Drizzle derives them from the schema of `@/lib/db`.
import type { importEventOutcomes, importPossibleDuplicates, imports } from '@/lib/db';

export type ImportRow = typeof imports.$inferSelect;
export type NewImportRow = typeof imports.$inferInsert;
export type ImportEventOutcomeRow = typeof importEventOutcomes.$inferSelect;
export type NewImportEventOutcomeRow = typeof importEventOutcomes.$inferInsert;
export type ImportPossibleDuplicateRow = typeof importPossibleDuplicates.$inferSelect;
export type NewImportPossibleDuplicateRow = typeof importPossibleDuplicates.$inferInsert;
