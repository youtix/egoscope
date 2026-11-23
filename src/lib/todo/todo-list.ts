import { activeLot } from '@/lib/env';

import { incidentsSection } from './incidents';

import type { IncidentRef, IncidentTodoItem } from './incidents';
import type { Database, Transaction } from '@/lib/db';
import type { Lot } from '@/lib/env';

type Reader = Database | Transaction;

/**
 * The sections of the to-do list, the glossary's `TodoSection`, in the order IHM-20
 * presents them.
 */
export const SECTIONS_IN_ORDER = [
  'requests_to_do',
  'proposed_supplements',
  'incidents',
  'players',
  'proposed_types',
  'events_and_cases_to_review',
] as const;

/** A section of the to-do list (IHM-20). */
export type TodoSectionId = (typeof SECTIONS_IN_ORDER)[number];

/** The object an item opens, which a screen turns into a link; each section adds its own. */
export type TodoObjectRef = IncidentRef;

/** One entry of the to-do list; each section adds its own kind of item. */
export type TodoItem = IncidentTodoItem;

/** A section with something to show: its items, and the incidents hidden from it (IHM-20). */
export type TodoSection = Readonly<{
  section: TodoSectionId;
  items: readonly TodoItem[];
  hiddenCount: number;
}>;

/** The to-do list: its non-empty sections in order and the number of items they hold (IHM-20). */
export type TodoList = Readonly<{
  sections: readonly TodoSection[];
  count: number;
}>;

type SectionContent = Readonly<{ items: readonly TodoItem[]; hiddenCount: number }>;

// A section that no source fills yet, which its owner replaces by its own line.
const emptySection = (section: TodoSectionId): TodoSection => ({
  section,
  items: [],
  hiddenCount: 0,
});

const isShown = (section: SectionContent): boolean =>
  section.items.length > 0 || section.hiddenCount > 0;

// One line per section, in the order of `SECTIONS_IN_ORDER`; an owner replaces its line.
async function allSections(db: Reader, lot: Lot): Promise<readonly TodoSection[]> {
  return [
    emptySection('requests_to_do'),

    emptySection('proposed_supplements'),

    { section: 'incidents', ...(await incidentsSection(db, lot)) },

    emptySection('players'),

    emptySection('proposed_types'),

    emptySection('events_and_cases_to_review'),
  ];
}

/**
 * The to-do list of Home: the six sections in the order of IHM-20, a section with
 * neither item nor hidden incident left out, and the number of items shown. When that
 * number is zero, Home says "Nothing to do right now" (IHM-20, IHM-56). A Lot 2 item
 * appears only when `lot`, the active lot by default, is 2.
 */
export async function todoList(db: Reader, lot: Lot = activeLot()): Promise<TodoList> {
  const all = await allSections(db, lot);
  const sections = all.filter((section) => isShown(section));
  return {
    sections,
    count: sections.reduce((total, section) => total + section.items.length, 0),
  };
}

/**
 * The count that the navigation bar shows on the Home entry: the number of items of the
 * to-do list, hidden incidents not counted (IHM-20).
 */
export async function todoCount(db: Reader, lot: Lot = activeLot()): Promise<number> {
  const list = await todoList(db, lot);
  return list.count;
}
