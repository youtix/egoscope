import { journalEntries } from '@/lib/db';

import type { incidents, taskRuns } from '@/lib/db';

// The stored sets of the journal and of the rows it names, read from the one `as const`
// array each table builds its CHECK from, so that no second list can drift from it.

/** The categories of the journal, the complete closed list (TRV-41, TEL-34, CL-TRV-25). */
export const JOURNAL_ENTRY_CATEGORIES = journalEntries.category.enumValues;

/** An entry's category, by which the journal screen filters (glossary: `JournalEntryCategory`). */
export type JournalEntryCategory = (typeof JOURNAL_ENTRY_CATEGORIES)[number];

/** An entry's level: info, warning, or incident when a function no longer does its job (TRV-43). */
export type JournalLevel = (typeof journalEntries.level.enumValues)[number];

/** The kinds of Lot 2 objects that an entry names by kind and identifier, without a foreign key. */
export type Lot2ObjectKind = (typeof journalEntries.lot2ObjectKind.enumValues)[number];

/** A scheduled task, by its key in the task registry (module map, section 4). */
export type TaskKey = (typeof taskRuns.taskKey.enumValues)[number];

/** Whether a run was scheduled or asked for by the owner (TRV-33). */
export type TaskRunTrigger = (typeof taskRuns.trigger.enumValues)[number];

/** An incident kind (glossary section 9.2). */
export type IncidentKind = (typeof incidents.kind.enumValues)[number];

/** The role of an outside service (TRV-09). */
export type ServiceRole = (typeof incidents.serviceRole.enumValues)[number];
