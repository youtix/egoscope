import type { JournalEntryCategory, JournalLevel } from './entries';

/**
 * What an entry is about, and the screen it leads to (IHM-38): a row it names by its
 * identifier, never by a copied text (CL-TRV-10). A Lot 2 object is named by its kind
 * and identifier, without a foreign key.
 */
export type SubjectKind =
  | 'none'
  | 'player'
  | 'event'
  | 'eventType'
  | 'backtestRequest'
  | 'import'
  | 'case'
  | 'incident'
  | 'taskRun'
  | 'pressSource'
  | 'article'
  | 'alertSheet'
  | 'notificationMessage';

/**
 * The kinds of values a message's parameters hold, each written at display in its own
 * way: counts, instants and durations through the formatters of `@/lib/wording` and
 * `@/lib/time`, the values of stored sets by their English words. None of them is ever
 * a player, a type, a date, a description, a title, a link, a birthday or a request
 * reference: those the display reads through the entry's subject (CL-TRV-10, DSN-11).
 */
export type ParamKind =
  | 'count'
  | 'instant'
  | 'duration'
  | 'task'
  | 'trigger'
  | 'service'
  | 'incident'
  | 'parameter'
  | 'value'
  | 'conversation'
  | 'refusal'
  | 'cause'
  | 'notificationCategory'
  | 'code';

/**
 * One message of the closed list: its category and level, what it is about, the kinds
 * of its parameters, and its text in three parts, which answer what happened, with what
 * consequence and what to do, the entry's instant saying when (TRV-42, TRV-43). A part
 * names the subject as `{subject}` and a parameter as `{name}`; `{name|day|days}` is the
 * noun that agrees with the count `name`.
 */
export type MessageDefinition = Readonly<{
  category: JournalEntryCategory;
  /** Info when left out. */
  level?: JournalLevel;
  /** Nothing when left out. */
  subject?: SubjectKind;
  params?: Readonly<Record<string, ParamKind>>;
  happened: string;
  consequence: string;
  whatToDo: string;
}>;

/** A message of the closed list with its key, the `message_key` its entries store. */
export type KeyedMessage = MessageDefinition & Readonly<{ key: string }>;
