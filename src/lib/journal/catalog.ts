import { LOT2_MESSAGES } from './catalog-lot2';
import { MACHINERY_MESSAGES } from './catalog-machinery';
import { OWNER_ACTION_MESSAGES } from './catalog-owner';
import { RESEARCH_MESSAGES } from './catalog-research';
import { TASK_MESSAGES } from './catalog-tasks';

import type { KeyedMessage, MessageDefinition, SubjectKind } from './message-types';
import type { ParamValues } from './params';

/**
 * Every message of the journal, the complete closed list: an entry holds the key of one
 * of them, and its text is built from it when the entry is displayed or exported, so
 * that an erased item's mentions disappear at once (TRV-41, TRV-42, CL-TRV-10). A new
 * message is a coordinator decision.
 */
export const JOURNAL_MESSAGES = [
  ...TASK_MESSAGES,
  ...MACHINERY_MESSAGES,
  ...OWNER_ACTION_MESSAGES,
  ...RESEARCH_MESSAGES,
  ...LOT2_MESSAGES,
] as const satisfies readonly KeyedMessage[];

type AnyMessage = (typeof JOURNAL_MESSAGES)[number];

/** The key of a message of the closed list, which an entry stores (operations.md section 1.2). */
export type JournalMessageKey = AnyMessage['key'];

type Definition<K extends JournalMessageKey> = Extract<AnyMessage, Readonly<{ key: K }>>;

/** What the entries of `K` are about: nothing, when its message names no subject. */
export type SubjectOf<K extends JournalMessageKey> =
  Definition<K> extends Readonly<{ subject: infer S extends SubjectKind }> ? S : 'none';

/** The parameters of the entries of `K`, with their types; never when its message has none. */
export type ParamsOf<K extends JournalMessageKey> =
  Definition<K> extends Readonly<{
    params: infer P extends Readonly<Record<string, keyof ParamValues>>;
  }>
    ? Readonly<{ [N in keyof P]: ParamValues[P[N]] }>
    : never;

/** A message with its defaults filled in: info, about nothing. */
export type ResolvedMessage = Required<Omit<MessageDefinition, 'params'>> &
  Pick<MessageDefinition, 'params'>;

const MESSAGES_BY_KEY: ReadonlyMap<string, KeyedMessage> = new Map(
  JOURNAL_MESSAGES.map((message) => [message.key, message]),
);

/**
 * The message of `key` with its defaults, the info level and no subject (TRV-43), or
 * undefined for a key outside the closed list.
 */
export function messageOf(key: string): ResolvedMessage | undefined {
  const message = MESSAGES_BY_KEY.get(key);
  return message === undefined ? undefined : { level: 'info', subject: 'none', ...message };
}
