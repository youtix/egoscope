import { messageOf } from './catalog';
import { writeParam } from './params';
import { subjectOf } from './references';

import type { ResolvedMessage } from './catalog';
import type { SubjectKind } from './message-types';
import type { JournalObjectRef, ObjectKind, ReferenceColumns } from './references';

/** A stored entry, as the text of its message is built from it. */
type StoredEntry = ReferenceColumns & Readonly<{ messageKey: string; messageParams: unknown }>;

/** An entry's text, built at display, and the object it leads to while that object exists. */
export type RenderedEntry = Readonly<{
  messageKey: string;
  text: string;
  objectRef: JournalObjectRef | null;
}>;

// How a text names a subject that still exists: by what it is, the entry leading to it;
// and one that an erasure removed (CL-TRV-10, glossary section 7.4).
const LIVE_SUBJECTS: Readonly<Record<ObjectKind, string>> = {
  player: 'a followed player',
  event: 'an event',
  eventType: 'an event type',
  backtestRequest: 'a backtest request',
  import: 'an import',
  case: 'a case',
  incident: 'an incident',
  taskRun: 'a task run',
  pressSource: 'a press source',
  article: 'an article',
  alertSheet: 'an alert sheet',
  notificationMessage: 'a Telegram message',
};
const DELETED_PLAYER = 'a deleted player';
const ITEM_NO_LONGER_EXISTS = 'an item that no longer exists';
const SUBJECT = 'subject';
const WHAT_TO_DO = 'What to do:';

// {name}, or the noun that agrees with the count `name`: {name|day|days}.
const PLACEHOLDER = /\{(?<name>[A-Za-z]+)(?:\|(?<one>[^{}|]+)\|(?<many>[^{}|]+))?\}/gu;

/** The parameter `name` of the stored parameters, whatever they hold. */
function storedParam(params: unknown, name: string): unknown {
  return typeof params === 'object' && params !== null ? Reflect.get(params, name) : undefined;
}

/** How the text names the subject: what it is, or what became of it once erased (CL-TRV-10). */
function designation(subject: SubjectKind, objectRef: JournalObjectRef | null): string {
  if (objectRef !== null) {
    return LIVE_SUBJECTS[objectRef.kind];
  }
  return subject === 'player' ? DELETED_PLAYER : ITEM_NO_LONGER_EXISTS;
}

const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * The text of `message` for a stored entry: its three parts with the subject named, or
 * said to be erased, and each parameter written by its kind, instants in `timeZone`
 * (TRV-42, CL-TRV-10).
 */
export function messageText(
  message: ResolvedMessage,
  entry: StoredEntry,
  timeZone: string,
): Omit<RenderedEntry, 'messageKey'> {
  const objectRef = subjectOf(message.subject, entry);
  const fill = (template: string): string =>
    template.replaceAll(
      PLACEHOLDER,
      (...[, name = '', one, many]: readonly (string | undefined)[]) => {
        if (name === SUBJECT) {
          return designation(message.subject, objectRef);
        }
        const kind = message.params?.[name];
        if (kind === undefined) {
          throw new Error(`A message names {${name}}, which is not one of its parameters.`);
        }
        const value = storedParam(entry.messageParams, name);
        if (one !== undefined && many !== undefined) {
          return value === 1 ? one : many;
        }
        return writeParam(kind, value, timeZone);
      },
    );
  const text = [
    capitalized(fill(message.happened)),
    capitalized(fill(message.consequence)),
    WHAT_TO_DO,
    fill(message.whatToDo),
  ].join(' ');
  return { text, objectRef };
}

/**
 * The text of a stored entry, built when it is displayed or exported from its message,
 * its parameters and its references (CL-TRV-10): what happened, the consequence and what
 * to do, the entry's instant saying when (TRV-42); a reference that an erasure nulled
 * reads "an item that no longer exists", or "a deleted player". Instants are written in
 * `timeZone`, the owner's (TRV-71). An entry of no message of the closed list is a bug.
 */
export function renderEntry(entry: StoredEntry, timeZone: string): RenderedEntry {
  const message = messageOf(entry.messageKey);
  if (message === undefined) {
    throw new Error(`The journal holds an entry of no known message: ${entry.messageKey}.`);
  }
  return { messageKey: entry.messageKey, ...messageText(message, entry, timeZone) };
}
