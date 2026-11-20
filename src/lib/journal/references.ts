import type { Lot2ObjectKind } from './entries';
import type { SubjectKind } from './message-types';
import type { journalEntries } from '@/lib/db';

/**
 * The identifier that names each kind of subject, as the caller of `record` gives it.
 * Beside a Lot 2 object, an entry may name the event it concerns; an entry about an
 * event or a case names it alone, so that the display reads its player and type
 * through it (operations.md section 1.2).
 */
export type SubjectFields = {
  // An entry about nothing names no player and no event: a withdrawal, for one (CL-TRV-10).
  none: Readonly<{ playerId?: never; playerEventId?: never }>;
  player: Readonly<{ playerId: string }>;
  event: Readonly<{ playerEventId: number }>;
  eventType: Readonly<{ eventTypeId: string }>;
  backtestRequest: Readonly<{ backtestRequestId: number }>;
  import: Readonly<{ importId: number }>;
  case: Readonly<{ caseId: number }>;
  incident: Readonly<{ incidentId: number }>;
  taskRun: Readonly<{ taskRunId: number }>;
  pressSource: Readonly<{ pressSourceId: number }>;
  article: Readonly<{ articleId: number; playerEventId?: number }>;
  alertSheet: Readonly<{ alertSheetId: number; playerEventId?: number }>;
  notificationMessage: Readonly<{ notificationMessageId: number; playerEventId?: number }>;
};

/** Every reference an entry can hold, as `record` receives them. */
export type EntryReferences = Readonly<{
  playerId?: string;
  playerEventId?: number;
  eventTypeId?: string;
  backtestRequestId?: number;
  importId?: number;
  caseId?: number;
  incidentId?: number;
  taskRunId?: number;
  pressSourceId?: number;
  articleId?: number;
  alertSheetId?: number;
  notificationMessageId?: number;
}>;

type StoredRow = typeof journalEntries.$inferSelect;

/** The columns that hold an entry's references. */
export type ReferenceColumns = Pick<
  StoredRow,
  | 'playerId'
  | 'playerEventId'
  | 'eventTypeId'
  | 'backtestRequestId'
  | 'importId'
  | 'caseId'
  | 'incidentId'
  | 'taskRunId'
  | 'lot2ObjectKind'
  | 'lot2ObjectId'
>;

/** What an entry can lead to: every kind of subject but none. */
export type ObjectKind = Exclude<SubjectKind, 'none'>;

/** The object an entry leads to: the screen of its subject (IHM-38). */
export type JournalObjectRef = Readonly<{ kind: ObjectKind; id: string | number }>;

type Lot2Subject = 'pressSource' | 'article' | 'alertSheet' | 'notificationMessage';

const LOT2_KINDS: Readonly<Record<Lot2Subject, Lot2ObjectKind>> = {
  pressSource: 'press_source',
  article: 'article',
  alertSheet: 'alert_sheet',
  notificationMessage: 'notification_message',
};

/** The Lot 2 object among `references`, as its kind and identifier, or none. */
function lot2Object(
  references: EntryReferences,
): Pick<ReferenceColumns, 'lot2ObjectKind' | 'lot2ObjectId'> {
  const named = [
    ['pressSource', references.pressSourceId],
    ['article', references.articleId],
    ['alertSheet', references.alertSheetId],
    ['notificationMessage', references.notificationMessageId],
  ] as const;
  const [subject, id] = named.find(([, candidate]) => candidate !== undefined) ?? [];
  return subject === undefined || id === undefined
    ? { lot2ObjectKind: null, lot2ObjectId: null }
    : { lot2ObjectKind: LOT2_KINDS[subject], lot2ObjectId: id };
}

/** The columns that store `references`: an identifier each, the Lot 2 object as a pair. */
export function referenceColumns(references: EntryReferences): ReferenceColumns {
  return {
    playerId: references.playerId ?? null,
    playerEventId: references.playerEventId ?? null,
    eventTypeId: references.eventTypeId ?? null,
    backtestRequestId: references.backtestRequestId ?? null,
    importId: references.importId ?? null,
    caseId: references.caseId ?? null,
    incidentId: references.incidentId ?? null,
    taskRunId: references.taskRunId ?? null,
    ...lot2Object(references),
  };
}

/** The identifier of the Lot 2 object of `row`, when the pair names an object of `subject`. */
function lot2Id(row: ReferenceColumns, subject: Lot2Subject): number | null {
  return row.lot2ObjectKind === LOT2_KINDS[subject] ? row.lot2ObjectId : null;
}

// Where each kind of subject is stored; a Lot 2 object only when the pair names its kind.
const SUBJECT_IDS: Readonly<Record<ObjectKind, (row: ReferenceColumns) => string | number | null>> =
  {
    player: (row) => row.playerId,
    event: (row) => row.playerEventId,
    eventType: (row) => row.eventTypeId,
    backtestRequest: (row) => row.backtestRequestId,
    import: (row) => row.importId,
    case: (row) => row.caseId,
    incident: (row) => row.incidentId,
    taskRun: (row) => row.taskRunId,
    pressSource: (row) => lot2Id(row, 'pressSource'),
    article: (row) => lot2Id(row, 'article'),
    alertSheet: (row) => lot2Id(row, 'alertSheet'),
    notificationMessage: (row) => lot2Id(row, 'notificationMessage'),
  };

/**
 * The subject that a stored entry still names, or null once the item was erased, which
 * nulled its reference (CL-TRV-10).
 */
export function subjectOf(subject: SubjectKind, row: ReferenceColumns): JournalObjectRef | null {
  if (subject === 'none') {
    return null;
  }
  const id = SUBJECT_IDS[subject](row);
  return id === null ? null : { kind: subject, id };
}
