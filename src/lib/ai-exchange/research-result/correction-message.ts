// The correction message for the research AI (IMP-21, CL-IMP-04), composed only when the
// result is refused, cut or holds refused events, in the fixed structure of CL-IMP-04 and
// the wording of glossary section 7.3: the title, the reference and the format version,
// the instruction, the paragraph of a cut answer, then the numbered problems, each with
// its expected correction. It lists no warning and no ignored event, quotes no
// description or other free text (CL-IMP-02), writes the English keys of format 1.0 and
// is never stored (06 « Ce qui n'est pas conservé »).
import { FORMAT_VERSION } from './format';
import { dayCount, eventMessage } from './messages';
import { eventAt } from './result-messages';

import type { JsonPath } from '../extract-json';
import type { EventCheck, ImportRefusal } from './check-events';
import type { MessageContext } from './messages';
import type { ReadResultError, ReadResultOutcome } from './read-result';

/**
 * What the correction message is made from (IMP-21): the reference of the request it was
 * pasted for, the reading of the pasted text, and the checks of the events of the result
 * read, none when it was refused.
 */
export type CorrectionMessageInput = Readonly<{
  reference: string;
  reading: ReadResultOutcome;
  checks: readonly EventCheck[];
}>;

type OtherRefusal = Exclude<ImportRefusal, Readonly<{ sourcePosition: number }>>;
type PlainError = Exclude<ReadResultError, Readonly<{ path: unknown }>>;
// What the AI is asked to correct: the key of format 1.0 that the problem lies in, if
// any, and the expected correction.
type Correction = Readonly<{ key: string | undefined; correction: string }>;
// A problem of the whole result as the AI reads it: its key, what is wrong and the
// expected correction.
type ResultCorrection = Correction & Readonly<{ wrong: string }>;
// A problem as a line of the list says it: its location, its key, then what is wrong and
// the expected correction.
type Problem = Readonly<{ location: string; key: string | undefined; text: string }>;

const TITLE = 'Correction request for an Egoscope backtest result';
const INSTRUCTION =
  'The result you returned cannot be imported as it is. Correct the problems listed below and send back the complete corrected result: one JSON object in one piece, with no text before or after it, no code fence and no citation marker. Keep the other events unchanged. Invent nothing: a fact you cannot support with a dated public press article published before the next NBA game the player played goes in "unverified_leads", never in "events".';
const LIST_TITLE = 'Problems to correct:';
// The location of a problem of the whole result, at the start of its line.
const WHOLE_RESULT = 'The whole result';
const PART_BREAK = '\n\n';
const LINE_BREAK = '\n';
const EVENT_TYPE_KEY = 'event_type';
const PUBLIC_DATE_KEY = 'public_date';
const DESCRIPTION_KEY = 'description';

function correction(key: string | undefined, text: string): Correction {
  return { key, correction: text };
}

/** The key and the expected correction of a refusal that names no source (glossary section 7.3). */
function refusalCorrection(refusal: OtherRefusal, { writeCount }: MessageContext): Correction {
  switch (refusal.reason) {
    case 'type_missing': {
      return correction(
        EVENT_TYPE_KEY,
        'Give in "event_type" the ID of one of the requested types.',
      );
    }
    case 'type_unknown': {
      return correction(
        EVENT_TYPE_KEY,
        'Use the ID of one of the requested types, exactly as given in point 3 of the prompt.',
      );
    }
    case 'public_date_missing': {
      return correction(
        PUBLIC_DATE_KEY,
        'Give the public date as YYYY-MM-DD, or YYYY-MM-DDTHH:MM±HH:MM if the time is known.',
      );
    }
    case 'public_date_malformed': {
      return correction(
        PUBLIC_DATE_KEY,
        'Write the public date as YYYY-MM-DD, or YYYY-MM-DDTHH:MM±HH:MM if the time is known.',
      );
    }
    case 'public_date_nonexistent': {
      return correction(PUBLIC_DATE_KEY, 'Give a date that exists, as YYYY-MM-DD.');
    }
    case 'description_missing': {
      return correction(
        DESCRIPTION_KEY,
        'Write one factual sentence in English, following rule 2.6.',
      );
    }
    case 'description_too_long': {
      return correction(
        DESCRIPTION_KEY,
        `Shorten the description to ${writeCount(refusal.maxLength)} characters at most, following rule 2.6.`,
      );
    }
    case 'description_quotation_mark': {
      return correction(
        DESCRIPTION_KEY,
        `Remove the quotation mark (${refusal.character}): summarize what was said instead of quoting it (rule 2.6).`,
      );
    }
    case 'no_valid_source': {
      return correction(
        'sources',
        'Give at least one source: the full address of a dated public press article, with its outlet, title and publication date (rule 2.3).',
      );
    }
  }
}

/** The key and the expected correction of a refusal (IMP-11 to IMP-14, glossary section 7.3). */
function expectedCorrection(refusal: ImportRefusal, context: MessageContext): Correction {
  return 'sourcePosition' in refusal
    ? correction(
        'publication_date',
        `Correct the public date, or remove the sources published more than ${dayCount(context.maxSourceLeadDays, context)} before it.`,
      )
    : refusalCorrection(refusal, context);
}

/** What a blocking error of the reader that names no position asks the AI (glossary section 7.3). */
function plainErrorCorrection(error: PlainError): ResultCorrection {
  switch (error.kind) {
    case 'no_result_found': {
      return {
        key: undefined,
        wrong: 'your answer holds no JSON object.',
        correction: 'Send the result as one JSON object, as point 4 of the prompt describes it.',
      };
    }
    case 'several_results': {
      return {
        key: undefined,
        wrong: 'your answer holds several different results.',
        correction: 'Send one result only.',
      };
    }
    case 'not_a_backtest_result': {
      return {
        key: 'format',
        wrong: 'this is not a backtest result.',
        correction: 'Write "egoscope-backtest", with the structure of point 4 of the prompt.',
      };
    }
    case 'unknown_version': {
      return {
        key: 'format_version',
        wrong: 'this version is unknown.',
        correction: `Write "${FORMAT_VERSION}".`,
      };
    }
    case 'covered_types_invalid': {
      return {
        key: 'covered_types',
        wrong: 'they are missing, empty or hold none of the requested types.',
        correction:
          'List the IDs of the requested types that you actually researched, exactly as given in point 3 of the prompt.',
      };
    }
    case 'covered_period_invalid': {
      return {
        key: 'covered_period',
        wrong: 'it is missing, has an invalid date or starts after its end.',
        correction: 'Give "start" and "end" as YYYY-MM-DD, the start on or before the end.',
      };
    }
    case 'events_missing': {
      return {
        key: 'events',
        wrong: 'it is missing or is not a list.',
        correction: 'Give the events as a list, [] when you found none.',
      };
    }
  }
}

/** What a syntax error asks the AI, around the event where the reading stopped (IMP-04). */
function syntaxCorrection(path: JsonPath, { writeCount }: MessageContext): ResultCorrection {
  const position = eventAt(path);
  const around = position === undefined ? '' : ` around event ${writeCount(position)}`;
  return {
    key: undefined,
    wrong: `the JSON is not valid${around}.`,
    correction:
      'Write straight quotation marks around keys and texts, and no comment, no trailing comma and no citation marker between values.',
  };
}

/**
 * The line of a blocking error of the reader (CL-IMP-04), none for a cut answer, which has
 * its own paragraph.
 */
function resultProblem(error: ReadResultError, context: MessageContext): readonly Problem[] {
  if (error.kind === 'cut_not_recoverable') {
    return [];
  }
  const listed =
    'path' in error ? syntaxCorrection(error.path, context) : plainErrorCorrection(error);
  return [
    { location: WHOLE_RESULT, key: listed.key, text: `${listed.wrong} ${listed.correction}` },
  ];
}

/** The problems of the whole result, in the order of the reader (IMP-09, CL-IMP-04). */
function resultProblems(reading: ReadResultOutcome, context: MessageContext): readonly Problem[] {
  const errors = reading.ok ? [] : reading.errors;
  return errors.flatMap((error) => resultProblem(error, context));
}

/**
 * The problems of the refused events, by position, and within an event in the order of
 * its refusals, that of the fields of the format (CL-IMP-04), each located and worded as
 * the import's messages say it (CL-IMP-02).
 */
function eventProblems(
  reading: ReadResultOutcome,
  checks: readonly EventCheck[],
  context: MessageContext,
): readonly Problem[] {
  const events = reading.ok ? reading.result.events : [];
  return checks.flatMap((check) => {
    if (check.outcome !== 'refused') {
      return [];
    }
    const event = events[check.position - 1];
    if (event === undefined) {
      throw new Error(`The result read holds no event at position ${String(check.position)}.`);
    }
    const at = { position: check.position, event };
    return check.refusals.map((refusal) => {
      const { location, problem } = eventMessage(refusal, at, context);
      const expected = expectedCorrection(refusal, context);
      return { location, key: expected.key, text: `${problem} ${expected.correction}` };
    });
  });
}

/**
 * Whether the answer was cut, and the position of the event being written at the cut,
 * if any (IMP-05, CL-IMP-04 item 4): a cut that the recovery allowed, at the event after
 * those it recovered unless it fell after the events list; or a cut that it did not
 * allow, at the event of its path.
 */
function cutOf(reading: ReadResultOutcome): Readonly<{ during: number | undefined }> | undefined {
  const { recovery } = reading;
  if (recovery !== undefined) {
    return { during: recovery.eventsListComplete ? undefined : recovery.recoveredEventCount + 1 };
  }
  if (reading.ok) {
    return undefined;
  }
  const [path] = reading.errors.flatMap((error) =>
    error.kind === 'cut_not_recoverable' ? [error.path] : [],
  );
  return path === undefined ? undefined : { during: eventAt(path) };
}

function cutParagraph(during: number | undefined, { writeCount }: MessageContext): string {
  const event = during === undefined ? '' : `, during event ${writeCount(during)}`;
  return `Your answer stopped before the end of the JSON object${event}. Send the whole result again. If it does not fit in one answer, process the period in chronological order, stop at the end of a complete season and set "covered_period.end" to the last day you actually covered; the rest will be requested separately.`;
}

/** A numbered line of the list: "2. Event 4 (…) — public_date: what is wrong. Correction." */
function line(problem: Problem, index: number, { writeCount }: MessageContext): string {
  const key = problem.key === undefined ? '' : ` — ${problem.key}`;
  return `${writeCount(index + 1)}. ${problem.location}${key}: ${problem.text}`;
}

/**
 * Composes the correction message for the research AI (IMP-21, CL-IMP-04, CA-IMP-24,
 * CA-DSN-08), or nothing when the result is neither refused, nor cut, nor holds a refused
 * event. Its parts, in this order: the title; the reference of the request and format
 * version 1.0; the fixed instruction; for a cut answer, the paragraph asking for the
 * whole result or for a complete season, naming the event being written at the cut when
 * the cut fell inside the events list; then "Problems to correct:" and one numbered line
 * per problem, those of the whole result first, then the refused events by position and,
 * within an event, by field in the order of the format, each with the location of
 * CL-IMP-02, the key of format 1.0, what is wrong and the expected correction of its
 * refusal reason. A description holding a quotation mark is refused with the character
 * named, and its correction asks to summarize what was said instead. Warnings and ignored
 * events are never listed, and no description or other free text is quoted.
 */
export function composeCorrectionMessage(
  input: CorrectionMessageInput,
  context: MessageContext,
): string | undefined {
  const { reference, reading, checks } = input;
  const cut = cutOf(reading);
  const problems = [
    ...resultProblems(reading, context),
    ...eventProblems(reading, checks, context),
  ];
  if (cut === undefined && problems.length === 0) {
    return undefined;
  }
  const lines = problems.map((problem, index) => line(problem, index, context));
  return [
    TITLE,
    `Request reference: ${reference}. Format version: ${FORMAT_VERSION}.`,
    INSTRUCTION,
    ...(cut === undefined ? [] : [cutParagraph(cut.during, context)]),
    ...(lines.length === 0 ? [] : [[LIST_TITLE, ...lines].join(LINE_BREAK)]),
  ].join(PART_BREAK);
}
