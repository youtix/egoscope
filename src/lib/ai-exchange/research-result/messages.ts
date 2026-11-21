// The plain-English messages of the research-result import (IMP-20, CL-IMP-02): where a
// problem is, what is wrong and how to fix it, in the wording of glossary section 7.3
// ("Import messages per code"), one exhaustive switch per kind of code. This file words
// the refusals, the ignore reasons and the warnings of an event; result-messages.ts,
// those of the whole result. Screens word the codes with them, and nothing here is stored
// (06 « Ce qui n'est pas conservé »). A message quotes dates, identifiers and links as
// read, and a length with its maximum, never a description or another free text.
import type { ImportRefusal, ImportWarning } from './check-events';
import type { ImportIgnoreReason } from './check-scope';
import type { SourceDropCause, SourceWarning } from './check-sources';
import type { DateReading } from './dates';
import type { ResearchEvent, ResearchSource } from './format';

/**
 * What the messages take from their caller: how people read a count, the wording's
 * `formatCount` (IHM-13, CL-IHM-03), and the parameter `imports.maxSourceLeadDays`
 * (IMP-14, CL-IMP-11).
 */
export type MessageContext = Readonly<{
  writeCount: (count: number) => string;
  maxSourceLeadDays: number;
}>;

/**
 * A message of the import (IMP-20, CL-IMP-02): where the problem is, what is wrong and how
 * to fix it, the last two ending with their punctuation, and the three as one text, which
 * leaves out the location of a problem of the whole result.
 */
export type ImportMessage = Readonly<{
  location: string;
  problem: string;
  fix: string;
  text: string;
}>;

/** An event of the result as read, at its 1-based position in the events list as pasted (CL-IMP-02). */
export type EventAsRead = Readonly<{ position: number; event: ResearchEvent }>;

/** A problem of an event: a refusal, a warning, or the reason why it is ignored (IMP-11 to IMP-17). */
export type EventProblem = ImportRefusal | ImportWarning | ImportIgnoreReason;

/** What is wrong and how to fix it, each ending with its punctuation. */
export type MessageParts = Readonly<{ problem: string; fix: string }>;

type FieldWarning = Extract<ImportWarning, Readonly<{ field: string }>>;
type OtherRefusal = Exclude<ImportRefusal, Readonly<{ sourcePosition: number }>>;
type OtherWarning = Exclude<ImportWarning, FieldWarning | SourceWarning>;
type LinkCause = Extract<SourceDropCause, 'incomplete_address' | 'home_page' | 'disallowed_domain'>;

// The placeholders of a type or a date missing or unreadable, without their parentheses
// inside those of the location (glossary section 7.3).
const NO_TYPE = 'no type';
const NO_DATE = 'no date';
// A type as read is quoted when, trimmed, it has the shape of an event type's identifier
// (CL-IMP-02, CL-IMP-22): ASCII letters of either case and digits, in groups joined by
// single hyphens. The ranges name both cases, since under the `i` flag case folding
// would let [a-z] match the long s and the Kelvin sign.
const TYPE_SHAPE = /^[\dA-Za-z]+(?:-[\dA-Za-z]+)*$/u;
const MAX_TYPE_LENGTH = 50;
const LEFT_OUT = 'Nothing to correct: the event is left out of this import.';
const GIVE_PUBLIC_DATE = 'Give the public date as YYYY-MM-DD.';
const GIVE_PUBLICATION_DATE = 'Give the publication date as YYYY-MM-DD.';
const GIVE_FULL_ADDRESS = 'Give the full address, starting with https://.';
const CHECK_AFTER_SAVING = 'Check it, and correct the event after saving if it does.';
const ADDED_WITHOUT_IT = 'Nothing to correct: the event is added without it.';

/** The fix of a problem that needs none (IMP-20). */
export const NOTHING_TO_CORRECT = 'Nothing to correct.';

/** What is wrong and how to fix it, two of the three parts of a message (IMP-20, CL-IMP-02). */
export function parts(problem: string, fix: string): MessageParts {
  return { problem, fix };
}

/** A lead of a number of days as a message writes it, "one day" or "2 days" (IMP-14, CL-IMP-11). */
export function dayCount(days: number, { writeCount }: MessageContext): string {
  return days === 1 ? 'one day' : `${writeCount(days)} days`;
}

/** A located message: its location, then what is wrong and how to fix it (CL-IMP-02). */
export function locatedMessage(location: string, { problem, fix }: MessageParts): ImportMessage {
  return { location, problem, fix, text: `${location}: ${problem} ${fix}` };
}

/** A date as read, when it has the shape of a date of the format; otherwise the placeholder (CL-IMP-02, CL-IMP-08). */
function dateAsRead(reading: DateReading): string {
  if (reading.ok) {
    return reading.text;
  }
  return reading.error.kind === 'nonexistent' ? reading.error.text : NO_DATE;
}

/** The publication date of a source as read, the placeholder for a source that the event does not hold. */
function sourceDate(source: ResearchSource | undefined): string {
  return source === undefined ? NO_DATE : dateAsRead(source.publicationDate);
}

/** A type as read, trimmed, when it has the shape of an identifier; otherwise the placeholder (CL-IMP-02). */
function typeAsRead(eventType: string | undefined): string {
  const trimmed = eventType?.trim();
  const isIdentifier =
    trimmed !== undefined && trimmed.length <= MAX_TYPE_LENGTH && TYPE_SHAPE.test(trimmed);
  return isIdentifier ? trimmed : NO_TYPE;
}

/** The refusals of an event that name no source (IMP-11 to IMP-14). */
function refusalParts(refusal: OtherRefusal, { writeCount }: MessageContext): MessageParts {
  switch (refusal.reason) {
    case 'type_missing': {
      return parts('the event type is missing.', 'Give the ID of one of the requested types.');
    }
    case 'type_unknown': {
      return parts(
        'this type is not an event type of the app.',
        'Use the ID of one of the requested types.',
      );
    }
    case 'public_date_missing': {
      return parts('the public date is missing.', GIVE_PUBLIC_DATE);
    }
    case 'public_date_malformed': {
      return parts('the public date is not written in an accepted form.', GIVE_PUBLIC_DATE);
    }
    case 'public_date_nonexistent': {
      return parts('this date does not exist.', GIVE_PUBLIC_DATE);
    }
    case 'description_missing': {
      return parts('the description is missing.', 'Write one factual sentence in English.');
    }
    case 'description_too_long': {
      const max = writeCount(refusal.maxLength);
      return parts(
        `the description has ${writeCount(refusal.length)} characters, more than the maximum of ${max}.`,
        `Shorten it to ${max} characters at most.`,
      );
    }
    case 'description_quotation_mark': {
      return parts(
        `the description contains a quotation mark (${refusal.character}).`,
        'Quotations are not allowed: summarize what was said instead.',
      );
    }
    case 'no_valid_source': {
      return parts(
        'no valid source is left.',
        'Give at least one dated article of the public press, with its full address.',
      );
    }
  }
}

/** Why an event is left out of the import, and what the owner can do (IMP-11, IMP-12, CL-IMP-29). */
function ignoredParts(reason: ImportIgnoreReason): MessageParts {
  switch (reason) {
    case 'type_not_validated': {
      return parts(
        'this type is not validated to date.',
        'Nothing to correct: once the type is validated, import the result again to add it.',
      );
    }
    case 'type_not_requested': {
      return parts(
        'this type is not part of the request.',
        'Nothing to correct: request a backtest of this type to add its events.',
      );
    }
    case 'outside_requested_period': {
      return parts('this date is outside the period requested for this type.', LEFT_OUT);
    }
    case 'before_first_nba_game': {
      return parts("this date is before the player's first NBA game.", LEFT_OUT);
    }
    case 'calendar_derived_type': {
      return parts(
        'this type is derived from the calendar.',
        'Nothing to correct: the app finds these events itself.',
      );
    }
    case 'split_type_ignored': {
      return parts(
        'you chose to ignore this event of a split type.',
        'Choose one of the types it was split into to add it.',
      );
    }
  }
}

/**
 * The warnings on a text of an event (IMP-13, IMP-15, CL-IMP-03, CL-IMP-05, CL-IMP-07): a
 * text too long with its length and the maximum, one ignored for a quotation mark with
 * the mark found (CL-IMP-02).
 */
function fieldWarningParts(warning: FieldWarning, { writeCount }: MessageContext): MessageParts {
  // The text as the glossary names it: the key of format 1.0 in words, but for `detail`,
  // whose term names the context it belongs to.
  const field = warning.field === 'detail' ? 'context detail' : warning.field.replaceAll('_', ' ');
  switch (warning.kind) {
    case 'possible_statistics': {
      return parts(`the ${field} may contain statistics or a score.`, CHECK_AFTER_SAVING);
    }
    case 'possible_citation_marker': {
      return parts(`the ${field} may contain a citation marker.`, CHECK_AFTER_SAVING);
    }
    case 'text_too_long_ignored': {
      return parts(
        `the ${field} has ${writeCount(warning.length)} characters, more than the maximum of ${writeCount(warning.maxLength)}, and is ignored.`,
        ADDED_WITHOUT_IT,
      );
    }
    case 'text_quotation_mark_ignored': {
      return parts(
        `the ${field} contains a quotation mark (${warning.character}) and is ignored.`,
        ADDED_WITHOUT_IT,
      );
    }
  }
}

/** What is wrong with the link of a dropped source, quoted as read (IMP-14, CL-IMP-15). */
function linkParts(cause: LinkCause, link: string): MessageParts {
  switch (cause) {
    case 'incomplete_address': {
      return parts(`${link} is not the full address of an article.`, GIVE_FULL_ADDRESS);
    }
    case 'home_page': {
      return parts(
        `${link} is the address of a home page.`,
        'Give the address of the article itself.',
      );
    }
    case 'disallowed_domain': {
      return parts(`${link} is on a disallowed domain.`, 'Give a press article instead.');
    }
  }
}

/**
 * What is wrong with a dropped source (IMP-14, CL-IMP-15): its link, trimmed, quoted as
 * read, or missing; its publication date as read.
 */
function droppedParts(cause: SourceDropCause, url: string | undefined, date: string): MessageParts {
  switch (cause) {
    case 'incomplete_address':
    case 'home_page':
    case 'disallowed_domain': {
      return url === undefined
        ? parts('the link is missing.', GIVE_FULL_ADDRESS)
        : linkParts(cause, `"${url}"`);
    }
    case 'publication_date_missing': {
      return parts('the publication date is missing.', GIVE_PUBLICATION_DATE);
    }
    case 'publication_date_malformed': {
      return parts('the publication date is malformed or does not exist.', GIVE_PUBLICATION_DATE);
    }
    case 'publication_date_in_future': {
      return parts(
        `the source is dated ${date}, after the import day.`,
        'Correct the publication date or remove this source.',
      );
    }
  }
}

/** The other warnings on an event (IMP-11, IMP-12, IMP-15, IMP-17, CL-IMP-08). */
function otherWarningParts(warning: OtherWarning, { writeCount }: MessageContext): MessageParts {
  switch (warning.kind) {
    case 'attached_to_surviving_type': {
      return parts(
        `this type was merged: the event is attached to the surviving type ${warning.typeId}.`,
        NOTHING_TO_CORRECT,
      );
    }
    case 'type_not_declared_covered': {
      return parts(
        'the result does not declare this type as covered.',
        'Nothing to correct: the type stays among the coverage gaps.',
      );
    }
    case 'outside_declared_period': {
      return parts(
        'this date is outside the covered period that the result declares.',
        'Nothing to correct: the event is added all the same.',
      );
    }
    case 'non_standard_date': {
      return parts('a date is written in a non-standard form.', 'Check that it was read as meant.');
    }
    case 'time_ignored': {
      return parts(
        'a time without an offset, or at midnight, is ignored.',
        'Nothing to correct: the date alone is kept.',
      );
    }
    case 'confidence_defaulted': {
      return parts(
        'the research confidence is missing or not high, medium or low.',
        'Nothing to correct: it is set to low.',
      );
    }
    case 'context_defaulted': {
      return parts(
        'the context is missing or holds a value outside its list.',
        'Nothing to correct: it is set to unknown.',
      );
    }
    case 'shared_link': {
      return parts(
        `this event cites the same link as event ${writeCount(warning.otherPosition)}.`,
        'Check that the two events are distinct facts.',
      );
    }
  }
}

/**
 * What is wrong with an event, and how to fix it, for a refusal or a warning, a source
 * named by its position in the event's sources (IMP-14).
 */
function problemParts(
  problem: ImportRefusal | ImportWarning,
  { sources }: ResearchEvent,
  context: MessageContext,
): MessageParts {
  if ('reason' in problem) {
    return 'sourcePosition' in problem
      ? parts(
          `the source is dated ${sourceDate(sources[problem.sourcePosition - 1])}, more than ${dayCount(context.maxSourceLeadDays, context)} before the public date.`,
          'Correct the public date or remove this source.',
        )
      : refusalParts(problem, context);
  }
  if ('field' in problem) {
    return fieldWarningParts(problem, context);
  }
  if (!('position' in problem)) {
    return otherWarningParts(problem, context);
  }
  const source = sources[problem.position - 1];
  return problem.kind === 'source_dropped'
    ? droppedParts(problem.cause, source?.url?.trim(), sourceDate(source))
    : parts('the outlet or the title is missing.', 'Nothing to correct: the source is kept.');
}

/** The 1-based position of the source that a problem of an event names, if it names one (CL-IMP-02). */
function sourcePositionOf(problem: ImportRefusal | ImportWarning): number | undefined {
  if ('sourcePosition' in problem) {
    return problem.sourcePosition;
  }
  return 'position' in problem ? problem.position : undefined;
}

/**
 * Where a problem of an event lies (IMP-20, CL-IMP-02): "Event 4 (public-humiliation,
 * 2021-02-30)", the event by its position, its type and its date as read, a missing or
 * unreadable one shown with its placeholder, and ", source 2" after it when the problem
 * names a source.
 */
function eventLocation(
  at: EventAsRead,
  sourcePosition: number | undefined,
  { writeCount }: MessageContext,
): string {
  const { eventType, publicDate } = at.event;
  const event = `Event ${writeCount(at.position)} (${typeAsRead(eventType)}, ${dateAsRead(publicDate)})`;
  return sourcePosition === undefined ? event : `${event}, source ${writeCount(sourcePosition)}`;
}

/**
 * The message of a problem of an event (IMP-11 to IMP-17, IMP-20, CL-IMP-02, CL-IMP-05):
 * located at the event, by its position, its type as read and its date as read (the
 * placeholder of glossary section 7.3 for one missing, or that has not the shape of an
 * identifier or of a date), and at the source that the problem names; what is wrong,
 * quoting the dates, the identifiers and the links as read, and a length with its
 * maximum; and how to fix it. A refusal says what to correct; a warning or an ignore
 * reason, that nothing needs correcting, or what the owner can check or do.
 */
export function eventMessage(
  problem: EventProblem,
  at: EventAsRead,
  context: MessageContext,
): ImportMessage {
  return typeof problem === 'string'
    ? locatedMessage(eventLocation(at, undefined, context), ignoredParts(problem))
    : locatedMessage(
        eventLocation(at, sourcePositionOf(problem), context),
        problemParts(problem, at.event, context),
      );
}
