// The recovery of a cut research result (IMP-05, CL-IMP-18). JSON isolation reports a
// text that ends inside the object as cut, with the object as far as it goes: its tokens
// without the spaces between them, then the token that the cut left unfinished. This
// scanner keeps what that partial text holds in full and decides whether the import can
// offer to recover it. It checks nothing else: the reader checks the recovered result
// like a whole one, so that every recovered event goes through every check.
import { calendarDate, isSorted, readDate } from './dates';

// The two lists of a result that its events list may come before (IMP-05).
type ResultList = 'limitations' | 'unverified_leads';

/**
 * A cut result that the import can offer to recover (IMP-05, CL-IMP-18). `value` holds
 * the members that the text writes in full before the cut. When the cut falls inside the
 * events list, `eventsListComplete` is false, `value.events` holds the events closed
 * before the cut and `value.covered_period` ends on the day before the last recovered
 * event's date, unless the declared period is one that the reader refuses in the whole
 * answer, its end missing, no date or before its start, which stays as written for the
 * reader to refuse (IMP-09). When the events list is closed before the cut, no event can
 * be missing: `eventsListComplete` is true and the covered period stays as written.
 * `lostLists` names the leads and limitations that the text does not write in full,
 * which `value` leaves out. `retainedCoverageEmpty` says that the shortened end comes
 * before the start of a valid declared period: the retained coverage is then empty, and
 * the recovered events can still be saved; it is false for a period left as written.
 * `truncationRecovered` marks the result as recovered, which the import trace records.
 */
export type CutRecovery = Readonly<{
  value: Readonly<Record<string, unknown>>;
  truncationRecovered: true;
  recoveredEventCount: number;
  retainedCoverageEmpty: boolean;
  lostLists: readonly ResultList[];
  eventsListComplete: boolean;
}>;

/**
 * Why the recovery of a cut result is not offered (IMP-05, CL-IMP-18):
 * - `header_incomplete`: the text holds no complete value of the request reference, the
 *   player, the covered types or the covered period;
 * - `no_complete_event`: the events list is not closed before the cut, and no event is;
 * - `events_not_sorted`: the complete events are not sorted by their date (CL-IMP-19);
 * - `no_dated_event`: no complete event has a calendar date, or the last of these dates
 *   is 0000-01-01, so the covered period has no day to end before that YYYY-MM-DD can
 *   write.
 */
export type RecoverCutError = Readonly<{
  kind: 'events_not_sorted' | 'header_incomplete' | 'no_complete_event' | 'no_dated_event';
}>;

/** The recovery that a cut result allows, or why there is none. */
export type RecoverCutResult =
  Readonly<{ ok: true; recovery: CutRecovery }> | Readonly<{ ok: false; error: RecoverCutError }>;

const EVENTS = 'events';
const COVERED_PERIOD = 'covered_period';
const PUBLIC_DATE = 'public_date';
// The members that a result needs complete for its recovery (CL-IMP-18).
const HEADER_KEYS: readonly string[] = [
  'request_reference',
  'player',
  'covered_types',
  COVERED_PERIOD,
];
// The lists that the cut loses unless the text writes them in full, in the format's order.
const RESULT_LISTS: readonly ResultList[] = ['unverified_leads', 'limitations'];

const PUNCTUATION = ',:[]{}';
// The depth of the root object's members, and of the elements of a list that one holds.
const MEMBER_DEPTH = 1;
const ELEMENT_DEPTH = 2;

// A member of the root object: its key, and where its value starts, after the colon.
type Member = Readonly<{ key: string; valueStart: number }>;

// What a recovery says of the result besides its value.
type RecoveryFacts = Pick<
  CutRecovery,
  'recoveredEventCount' | 'retainedCoverageEmpty' | 'eventsListComplete'
>;

/**
 * Reads the root object of a partial text one token at a time, without recursion, so
 * that no depth of nesting can overflow the stack: where the value of each member ends,
 * and where the last complete element of a list ends while a member's list is read.
 */
class MemberReader {
  readonly #text: string;
  readonly #members: Member[] = [];
  // The end of each member's value, in the members' order: the member being written at
  // the cut, the last one, may have none.
  readonly #valueEnds: number[] = [];
  // The end of the last element closed in the list that the last member holds.
  #elementsEnd: number | undefined;
  #depth = 0;
  // Whether the value open at ELEMENT_DEPTH is a list rather than an object, set when a
  // member's value opens there.
  #inList: boolean | undefined;
  // The token read last, set from the root's brace on.
  #previous: string | undefined;

  constructor(text: string) {
    this.#text = text;
  }

  #open(isList: boolean): void {
    this.#depth += 1;
    if (this.#depth === ELEMENT_DEPTH) {
      this.#inList = isList;
    }
  }

  // A member's key is the scalar that opens it, at the root and not after a colon.
  #scalar(token: string, end: number): void {
    if (this.#depth === MEMBER_DEPTH && this.#previous !== ':') {
      // A key of the partial text is a JSON string.
      this.#members.push({ key: String(JSON.parse(token)), valueStart: end + 1 });
      this.#elementsEnd = undefined;
    } else {
      this.#complete(end);
    }
  }

  // A value ends at `end`: a member's, or an element of the list that a member holds.
  #complete(end: number): void {
    if (this.#depth === MEMBER_DEPTH) {
      this.#valueEnds.push(end);
    } else if (this.#depth === ELEMENT_DEPTH && this.#inList === true) {
      this.#elementsEnd = end;
    }
  }

  // The value of a member as written, when the text holds it in full; of the events list
  // being written at the cut, its complete events, the list closed after them.
  #valueText(index: number, member: Member): string | undefined {
    const end = this.#valueEnds[index];
    if (end !== undefined) {
      return this.#text.slice(member.valueStart, end);
    }
    if (member.key === EVENTS && this.#elementsEnd !== undefined) {
      return `${this.#text.slice(member.valueStart, this.#elementsEnd)}]`;
    }
    return undefined;
  }

  read(token: string, end: number): void {
    if (token === '{' || token === '[') {
      this.#open(token === '[');
    } else if (token === '}' || token === ']') {
      this.#depth -= 1;
      this.#complete(end);
    } else if (token !== ',' && token !== ':') {
      this.#scalar(token, end);
    }
    this.#previous = token;
  }

  /**
   * The members whose value the text holds in full, and the events list being written at
   * the cut with its complete events.
   */
  values(): Readonly<Record<string, unknown>> {
    const entries: [string, unknown][] = [];
    for (const [index, member] of this.#members.entries()) {
      const text = this.#valueText(index, member);
      if (text === undefined) {
        continue;
      }
      const value: unknown = JSON.parse(text);
      entries.push([member.key, value]);
    }
    // Defined, not assigned, keys: a `__proto__` key is a member like any other.
    return Object.fromEntries(entries);
  }

  /** Whether the text holds the events list in full, the last one when it writes several. */
  isEventsListComplete(): boolean {
    const events = this.#members.findLastIndex((member) => member.key === EVENTS);
    return this.#valueEnds[events] !== undefined;
  }
}

/**
 * Whether the token that ends the text may be cut short: a number, as 12 for 125, or a
 * token that JSON cannot read, such as an unfinished literal or a bad escape. A string
 * ends at its quotation mark, and true, false and null cannot grow into another value.
 */
function isCutShort(token: string): boolean {
  if (PUNCTUATION.includes(token)) {
    return false;
  }
  try {
    return typeof JSON.parse(token) === 'number';
  } catch {
    return true;
  }
}

// The members of the root object that the partial text holds in full (CL-IMP-18), read.
function readMembers(partialText: string): MemberReader {
  // A token of the partial text, which holds no space between two tokens: a punctuation
  // mark, a string, or a number, true, false or null written bare. The sticky pattern
  // reads each token where the one before ends, and none inside a string that the cut
  // left open.
  const token = /[,:[\]{}]|"(?:[^"\\]|\\.)*"|[^",:[\]{}]+/uy;
  const reader = new MemberReader(partialText);
  for (let match = token.exec(partialText); match !== null; match = token.exec(partialText)) {
    const end = token.lastIndex;
    if (end === partialText.length && isCutShort(match[0])) {
      break;
    }
    reader.read(match[0], end);
  }
  return reader;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function publicDay(event: unknown): string | undefined {
  return isRecord(event) ? calendarDate(event[PUBLIC_DATE]) : undefined;
}

// The calendar day before `day`, a date written YYYY-MM-DD that exists, or undefined when
// YYYY-MM-DD cannot write it: the day before 0000-01-01.
function dayBefore(day: string): string | undefined {
  const [year = NaN, month = NaN, date = NaN] = day.split('-').map(Number);
  const instant = new Date(0);
  // setUTCFullYear, unlike Date.UTC, reads the years 0 to 99 as written. Day 0 of a
  // month is the last day of the month before.
  instant.setUTCFullYear(year, month - 1, date - 1);
  return calendarDate(instant.toISOString());
}

type ShortenedPeriod = Readonly<{ period: unknown; retainedCoverageEmpty: boolean }>;

/**
 * The covered period of a recovered result (IMP-05, IMP-09, CL-IMP-18): it ends on `end`,
 * the day before the last recovered event's date, or keeps, as written, a declared end
 * that comes no later. A period that the reader refuses whatever the cut stays exactly as
 * written, so that the reader refuses it as in the whole answer, as the coordinator
 * decided on 20 November, ahead of the documents: one that is no object, one whose end is
 * missing or no date that readDate reads, and one whose end comes before a start that
 * readDate reads, compared by their calendar dates as the reader compares them. A start
 * that names no date leaves the period shortened, for the reader to refuse its start.
 * The retained coverage is empty when the shortened end comes before a start that
 * readDate reads.
 */
function shortenedPeriod(period: unknown, end: string): ShortenedPeriod {
  if (!isRecord(period)) {
    return { period, retainedCoverageEmpty: false };
  }
  const start = readDate(period['start']);
  const declaredEnd = readDate(period['end']);
  const isKeptAsWritten =
    !declaredEnd.ok ||
    (start.ok && start.date.on > declaredEnd.date.on) ||
    declaredEnd.date.on <= end;
  return isKeptAsWritten
    ? { period, retainedCoverageEmpty: false }
    : { period: { ...period, end }, retainedCoverageEmpty: start.ok && start.date.on > end };
}

function refused(kind: RecoverCutError['kind']): RecoverCutResult {
  return { ok: false, error: { kind } };
}

function recovered(
  value: Readonly<Record<string, unknown>>,
  facts: RecoveryFacts,
): RecoverCutResult {
  const lostLists = RESULT_LISTS.filter((list) => !Object.hasOwn(value, list));
  return { ok: true, recovery: { value, truncationRecovered: true, ...facts, lostLists } };
}

/**
 * A result cut after its events list is closed (coordinator decision of 20 November):
 * no event can be missing, so every member written in full is kept, wherever it is
 * written, and the covered period stays as written, whether the events are sorted,
 * dated or none at all, since those conditions only serve the shortening.
 */
function afterEventsList(value: Readonly<Record<string, unknown>>): RecoverCutResult {
  const events = value[EVENTS];
  const recoveredEventCount = Array.isArray(events) ? events.length : 0;
  return recovered(value, {
    recoveredEventCount,
    retainedCoverageEmpty: false,
    eventsListComplete: true,
  });
}

/**
 * A result cut inside its events list (IMP-05, CL-IMP-18): the events closed before the
 * cut, when there are some and they are sorted, and the covered period shortened to the
 * day before the last of their dates.
 */
function insideEventsList(value: Readonly<Record<string, unknown>>): RecoverCutResult {
  const written = value[EVENTS];
  const events: readonly unknown[] = Array.isArray(written) ? written : [];
  if (events.length === 0) {
    return refused('no_complete_event');
  }
  const days = events.map((event) => publicDay(event)).filter((day) => day !== undefined);
  if (!isSorted(days)) {
    return refused('events_not_sorted');
  }
  const lastDay = days.at(-1);
  const end = lastDay === undefined ? undefined : dayBefore(lastDay);
  if (end === undefined) {
    return refused('no_dated_event');
  }
  const { period, retainedCoverageEmpty } = shortenedPeriod(value[COVERED_PERIOD], end);
  const recoveredEventCount = events.length;
  return recovered(
    { ...value, [COVERED_PERIOD]: period },
    { recoveredEventCount, retainedCoverageEmpty, eventsListComplete: false },
  );
}

/**
 * Recovers the complete part of a cut research result (IMP-05, BKT-25, CL-IMP-18) from
 * the partial text that JSON isolation reports for it: the members written in full before
 * the cut and, of an events list being written at the cut, the events closed before it,
 * the event being written at the cut dropped whole. A number that ends the text may be cut
 * short, and is dropped. The recovery is offered when the request reference, the player,
 * the covered types and the covered period are complete. When the cut falls inside the
 * events list, it also needs at least one complete event, the complete events sorted by
 * the date part of their public date as written, `YYYY-MM-DD` (CL-BKT-15, CL-IMP-19), an
 * event without such a date taking no part in the order, and the covered period then ends
 * on the day before the last of these dates, never after the end that the result declares;
 * a declared period whose end is missing, no date or before its start stays as written,
 * for the reader to refuse as in the whole answer (IMP-09). When the events list is closed
 * before the cut, the covered period stays as written. Both rules are the coordinator's
 * decisions of 20 November, ahead of the documents.
 */
export function recoverCut(partialText: string): RecoverCutResult {
  const reader = readMembers(partialText);
  const value = reader.values();
  if (HEADER_KEYS.some((key) => !Object.hasOwn(value, key))) {
    return refused('header_incomplete');
  }
  return reader.isEventsListComplete() ? afterEventsList(value) : insideEventsList(value);
}
