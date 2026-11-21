// The plain-English messages of the problems of a whole research result (IMP-20,
// CL-IMP-02), in the wording of glossary section 7.3 ("Import messages per code"): the
// blocking errors of the reader and of the import, and the warnings on the whole result,
// a lead or a limitation. messages.ts words those of an event, and says what a message is
// made of.
import { locatedMessage, NOTHING_TO_CORRECT, parts } from './messages';

import type { JsonPath } from '../extract-json';
import type { PastedTextSizeResult } from '../pasted-text-size';
import type { ResultTextWarning } from './check-leads-and-limitations';
import type { ImportMessage, MessageContext, MessageParts } from './messages';
import type { ReadResultError, ReadResultWarning } from './read-result';

/**
 * Why the whole result is refused, the glossary's `BlockingErrorKind`: an error of the
 * reader (IMP-04 to IMP-06, IMP-09), or one of the import, with what its message names:
 * the text too large, with the sentence of `checkPastedTextSize` that gives its size and
 * the limit (IMP-02, CL-IMP-27); a result for another request, with the players of the
 * result and of the request when they differ, otherwise with the reference of that
 * request (IMP-07); no player found (CL-IMP-32).
 */
export type BlockingError =
  | ReadResultError
  | Extract<PastedTextSizeResult, Readonly<{ ok: false }>>['error']
  | Readonly<{ kind: 'other_request'; resultPlayer: string; requestPlayer: string }>
  | Readonly<{ kind: 'other_request'; reference: string }>
  | Readonly<{ kind: 'player_not_found' }>;

/**
 * A warning on the whole result, a result-scope code of the glossary's
 * `ImportWarningKind`: one of the reader (IMP-06, IMP-09, IMP-16, CL-IMP-19) or of the
 * checks of the leads and the limitations (IMP-15), or one of the import (IMP-07, IMP-10,
 * CL-BKT-20).
 */
export type ResultWarning =
  | ReadResultWarning
  | ResultTextWarning
  | Readonly<{
      kind: 'player_name_differs' | 'declared_type_not_requested' | 'covered_period_clamped';
    }>
  | Readonly<{ kind: 'other_request_to_do'; reference: string }>;

type PlainError = Exclude<
  BlockingError,
  Readonly<{ path: unknown }> | Readonly<{ message: string }> | Readonly<{ kind: 'other_request' }>
>;
type DetailedWarning = Extract<ResultWarning, Readonly<{ detail: number }>>;
type PlainWarning = Exclude<ResultWarning, DetailedWarning | Readonly<{ reference: string }>>;

// The location of a problem of the whole result (glossary section 7.3).
const WHOLE_RESULT = 'the whole result';
const SEND_CORRECTION = 'Copy the correction message and send it to the AI.';
const EVENTS_KEY = 'events';

/** The 1-based position of the event that a JSON path lies in, if it lies in one (IMP-04, IMP-05). */
export function eventAt(path: JsonPath): number | undefined {
  const [list, index] = path;
  return list === EVENTS_KEY && typeof index === 'number' ? index + 1 : undefined;
}

/** A message of the whole result, whose text leaves the location out (CL-IMP-02). */
function wholeMessage({ problem, fix }: MessageParts): ImportMessage {
  return { location: WHOLE_RESULT, problem, fix, text: `${problem} ${fix}` };
}

/** The blocking errors that name nothing but their kind (IMP-04, IMP-06, IMP-09, CL-IMP-32). */
function plainErrorParts(error: PlainError): MessageParts {
  switch (error.kind) {
    case 'no_result_found': {
      return parts('No recognizable result:', "check that you copied the AI's whole answer.");
    }
    case 'several_results': {
      return parts('The text holds several different results.', 'Paste only one of them.');
    }
    case 'not_a_backtest_result': {
      return parts(
        'This text is not a backtest result.',
        "Paste the AI's answer to the prompt of this request.",
      );
    }
    case 'unknown_version': {
      return parts(
        'This result is in a format version that the app does not know.',
        'Copy the prompt of this request again and run the research with it.',
      );
    }
    case 'covered_types_invalid': {
      return parts(
        'The covered types are missing or hold none of the requested types.',
        SEND_CORRECTION,
      );
    }
    case 'covered_period_invalid': {
      return parts(
        'The covered period is missing, has an invalid date or starts after its end.',
        SEND_CORRECTION,
      );
    }
    case 'events_missing': {
      return parts('The events list is missing or is not a list.', SEND_CORRECTION);
    }
    case 'player_not_found': {
      return parts(
        'No followed player matches the player of this result.',
        'Check that you pasted the result of one of your requests.',
      );
    }
  }
}

/** A syntax error around the event where the reading stopped, and a cut at the event it cuts off (IMP-04, IMP-05). */
function pathErrorParts(
  { kind, path }: Extract<ReadResultError, Readonly<{ path: unknown }>>,
  { writeCount }: MessageContext,
): MessageParts {
  const position = eventAt(path);
  if (kind === 'syntax_error') {
    const around = position === undefined ? '' : ` around event ${writeCount(position)}`;
    return parts(`The result has a JSON syntax error${around}.`, SEND_CORRECTION);
  }
  const cutOff = position === undefined ? '' : `: event ${writeCount(position)} is cut off`;
  return parts(
    `The text stops before the end of the result${cutOff}.`,
    'Copy the whole answer again, or ask the AI for a shorter one.',
  );
}

/** What is wrong with the whole result refused, and how to fix it. */
function errorParts(error: BlockingError, context: MessageContext): MessageParts {
  if ('path' in error) {
    return pathErrorParts(error, context);
  }
  if ('message' in error) {
    return parts(error.message, "Paste the AI's answer alone.");
  }
  if ('reference' in error) {
    return parts(
      `This result is for request ${error.reference}, not for this one.`,
      `Open request ${error.reference} to import it.`,
    );
  }
  if ('resultPlayer' in error) {
    return parts(
      `This result is about ${error.resultPlayer}, but this request is about ${error.requestPlayer}.`,
      `Open the request of ${error.resultPlayer} to import it.`,
    );
  }
  return plainErrorParts(error);
}

/** The warnings that name nothing but their kind (IMP-06, IMP-07, IMP-09, IMP-10, CL-IMP-08, CL-IMP-23). */
function plainWarningParts(warning: PlainWarning): MessageParts {
  switch (warning.kind) {
    case 'format_or_version_missing': {
      return parts(
        'The format or the format version is missing: version 1.0 is assumed.',
        NOTHING_TO_CORRECT,
      );
    }
    case 'version_normalized': {
      return parts(
        'The format version is written in another form and read as 1.0.',
        NOTHING_TO_CORRECT,
      );
    }
    case 'covered_type_repeated': {
      return parts(
        'A covered type is listed more than once.',
        'Nothing to correct: it counts once.',
      );
    }
    case 'covered_period_time_ignored': {
      return parts(
        'The covered period gives a time, which is ignored.',
        'Nothing to correct: its dates alone are kept.',
      );
    }
    case 'lists_missing': {
      return parts(
        'The leads or the limitations are missing.',
        'Nothing to correct: they are taken as empty.',
      );
    }
    case 'player_name_differs': {
      return parts(
        "The player's name differs from the request's.",
        'Check that the result is about the right player.',
      );
    }
    case 'declared_type_not_requested': {
      return parts(
        'The result declares as covered a type that the request does not hold.',
        'Nothing to correct: that type is ignored.',
      );
    }
    case 'covered_period_clamped': {
      return parts(
        'The covered period goes beyond the requested period.',
        'Nothing to correct: it is brought back to the requested period.',
      );
    }
  }
}

/**
 * The warnings that name a count or a position (IMP-15, IMP-16, CL-IMP-19), those of a lead
 * or a limitation located there by its position in its list (CL-IMP-02).
 */
function detailedWarningMessage(
  warning: DetailedWarning,
  { writeCount }: MessageContext,
): ImportMessage {
  const detail = writeCount(warning.detail);
  switch (warning.kind) {
    case 'unknown_fields': {
      return wholeMessage(
        parts(
          `The result holds ${detail} ${warning.detail === 1 ? 'field' : 'fields'} that the format does not define.`,
          'Nothing to correct: such fields are ignored and never saved.',
        ),
      );
    }
    case 'events_not_sorted': {
      return wholeMessage(
        parts(
          `The events are not sorted by public date from event ${detail}.`,
          'Nothing to correct: the order matters only to recover a cut result.',
        ),
      );
    }
    case 'lead_ignored': {
      return locatedMessage(
        `Lead ${detail}`,
        parts('this lead is incomplete or too long, and is ignored.', NOTHING_TO_CORRECT),
      );
    }
    case 'limitation_ignored': {
      return locatedMessage(
        `Limitation ${detail}`,
        parts(
          'this limitation is no text, is too long or contains a quotation mark, and is ignored.',
          NOTHING_TO_CORRECT,
        ),
      );
    }
    case 'limitation_citation_marker': {
      return locatedMessage(
        `Limitation ${detail}`,
        parts('this limitation may contain a citation marker.', 'Check it: it is kept as written.'),
      );
    }
  }
}

/**
 * The message of a blocking error, which refuses the whole result (IMP-02, IMP-04 to
 * IMP-07, IMP-09, IMP-20, CL-IMP-02): located in the whole result, whose text leaves the
 * location out; a syntax error around the event where the reading stopped and a cut
 * answer at the event that it cuts off (IMP-04, IMP-05); a result of an unknown version
 * with the invitation to copy the prompt again (IMP-06, CA-IMP-02); a result for another
 * player naming both players (IMP-07).
 */
export function blockingErrorMessage(error: BlockingError, context: MessageContext): ImportMessage {
  return wholeMessage(errorParts(error, context));
}

/**
 * The message of a warning on the whole result (IMP-06, IMP-07, IMP-09, IMP-10, IMP-15,
 * IMP-16, IMP-20, CL-IMP-02): located in the whole result, whose text leaves the location
 * out, or in a lead or a limitation by its position in its list; what is wrong, and that
 * nothing needs correcting or what the owner can check.
 */
export function resultWarningMessage(
  warning: ResultWarning,
  context: MessageContext,
): ImportMessage {
  if ('detail' in warning) {
    return detailedWarningMessage(warning, context);
  }
  return wholeMessage(
    'reference' in warning
      ? parts(
          `This player has another request to do, ${warning.reference}, which this import does not change.`,
          NOTHING_TO_CORRECT,
        )
      : plainWarningParts(warning),
  );
}
