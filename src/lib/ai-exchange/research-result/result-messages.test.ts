import { describe, expect, expectTypeOf, it } from 'vitest';

import refusedEvents from '@data/fixtures/ai-exchange/research-result/messages/refused-events.json';

import { checkPastedTextSize } from '../pasted-text-size';
import { readResult } from './read-result';
import { blockingErrorMessage, resultWarningMessage } from './result-messages';

import type { ImportMessage, MessageContext } from './messages';
import type { BlockingError, ResultWarning } from './result-messages';

const CONTEXT: MessageContext = { writeCount: String, maxSourceLeadDays: 1 };
const REQUESTED = ['public-humiliation', 'player-conflict'];
const FORMAT_VERSION_KEY = 'format_version';
const WHOLE_RESULT = 'the whole result';
const NOTHING = 'Nothing to correct.';
const SEND_CORRECTION = 'Copy the correction message and send it to the AI.';
const COPY_AGAIN = 'Copy the whole answer again, or ask the AI for a shorter one.';

/** The message of a problem of the whole result: its parts, and its text without the location. */
const whole = (problem: string, fix: string): ImportMessage => ({
  location: WHOLE_RESULT,
  problem,
  fix,
  text: `${problem} ${fix}`,
});

/** The texts of the messages of the blocking errors that the reader gives for this text. */
const refusalOf = (pasted: string): readonly string[] => {
  const reading = readResult(pasted, REQUESTED);
  return reading.ok ? [] : reading.errors.map((error) => blockingErrorMessage(error, CONTEXT).text);
};

// Every blocking error, each variant of its message included, with what is wrong and how
// to fix it.
const BLOCKING_ERRORS = [
  [
    { kind: 'no_result_found' },
    'No recognizable result:',
    "check that you copied the AI's whole answer.",
  ],
  [
    { kind: 'several_results' },
    'The text holds several different results.',
    'Paste only one of them.',
  ],
  [
    { kind: 'syntax_error', path: ['events', 11, 'sources', 0] },
    'The result has a JSON syntax error around event 12.',
    SEND_CORRECTION,
  ],
  [
    { kind: 'syntax_error', path: ['covered_period', 'end'] },
    'The result has a JSON syntax error.',
    SEND_CORRECTION,
  ],
  [
    { kind: 'cut_not_recoverable', path: ['events', 37, 'description'] },
    'The text stops before the end of the result: event 38 is cut off.',
    COPY_AGAIN,
  ],
  [
    { kind: 'cut_not_recoverable', path: ['events'] },
    'The text stops before the end of the result.',
    COPY_AGAIN,
  ],
  [
    { kind: 'cut_not_recoverable', path: ['unverified_leads', 2, 'reason'] },
    'The text stops before the end of the result.',
    COPY_AGAIN,
  ],
  [
    { kind: 'not_a_backtest_result' },
    'This text is not a backtest result.',
    "Paste the AI's answer to the prompt of this request.",
  ],
  [
    { kind: 'unknown_version' },
    'This result is in a format version that the app does not know.',
    'Copy the prompt of this request again and run the research with it.',
  ],
  [
    { kind: 'covered_types_invalid' },
    'The covered types are missing or hold none of the requested types.',
    SEND_CORRECTION,
  ],
  [
    { kind: 'covered_period_invalid' },
    'The covered period is missing, has an invalid date or starts after its end.',
    SEND_CORRECTION,
  ],
  [{ kind: 'events_missing' }, 'The events list is missing or is not a list.', SEND_CORRECTION],
  [
    { kind: 'text_too_large', message: 'The pasted text is 2.5 MB, over the 2 MB limit.' },
    'The pasted text is 2.5 MB, over the 2 MB limit.',
    "Paste the AI's answer alone.",
  ],
  [
    { kind: 'other_request', resultPlayer: 'Player B', requestPlayer: 'Player A' },
    'This result is about Player B, but this request is about Player A.',
    'Open the request of Player B to import it.',
  ],
  [
    { kind: 'other_request', reference: 'REQ-2026-0009' },
    'This result is for request REQ-2026-0009, not for this one.',
    'Open request REQ-2026-0009 to import it.',
  ],
  [
    { kind: 'player_not_found' },
    'No followed player matches the player of this result.',
    'Check that you pasted the result of one of your requests.',
  ],
] satisfies readonly (readonly [BlockingError, string, string])[];

// Every warning on the whole result, a lead or a limitation, with its location, what is
// wrong and what to do.
const RESULT_WARNINGS = [
  [
    { kind: 'format_or_version_missing' },
    WHOLE_RESULT,
    'The format or the format version is missing: version 1.0 is assumed.',
    NOTHING,
  ],
  [
    { kind: 'version_normalized' },
    WHOLE_RESULT,
    'The format version is written in another form and read as 1.0.',
    NOTHING,
  ],
  [
    { kind: 'covered_type_repeated' },
    WHOLE_RESULT,
    'A covered type is listed more than once.',
    'Nothing to correct: it counts once.',
  ],
  [
    { kind: 'covered_period_time_ignored' },
    WHOLE_RESULT,
    'The covered period gives a time, which is ignored.',
    'Nothing to correct: its dates alone are kept.',
  ],
  [
    { kind: 'lists_missing' },
    WHOLE_RESULT,
    'The leads or the limitations are missing.',
    'Nothing to correct: they are taken as empty.',
  ],
  [
    { kind: 'unknown_fields', detail: 1 },
    WHOLE_RESULT,
    'The result holds 1 field that the format does not define.',
    'Nothing to correct: such fields are ignored and never saved.',
  ],
  [
    { kind: 'unknown_fields', detail: 3 },
    WHOLE_RESULT,
    'The result holds 3 fields that the format does not define.',
    'Nothing to correct: such fields are ignored and never saved.',
  ],
  [
    { kind: 'events_not_sorted', detail: 7 },
    WHOLE_RESULT,
    'The events are not sorted by public date from event 7.',
    'Nothing to correct: the order matters only to recover a cut result.',
  ],
  [
    { kind: 'lead_ignored', detail: 2 },
    'Lead 2',
    'this lead is incomplete or too long, and is ignored.',
    NOTHING,
  ],
  [
    { kind: 'limitation_ignored', detail: 3 },
    'Limitation 3',
    'this limitation is no text, is too long or contains a quotation mark, and is ignored.',
    NOTHING,
  ],
  [
    { kind: 'limitation_citation_marker', detail: 1 },
    'Limitation 1',
    'this limitation may contain a citation marker.',
    'Check it: it is kept as written.',
  ],
  [
    { kind: 'player_name_differs' },
    WHOLE_RESULT,
    "The player's name differs from the request's.",
    'Check that the result is about the right player.',
  ],
  [
    { kind: 'other_request_to_do', reference: 'REQ-2026-0011' },
    WHOLE_RESULT,
    'This player has another request to do, REQ-2026-0011, which this import does not change.',
    NOTHING,
  ],
  [
    { kind: 'declared_type_not_requested' },
    WHOLE_RESULT,
    'The result declares as covered a type that the request does not hold.',
    'Nothing to correct: that type is ignored.',
  ],
  [
    { kind: 'covered_period_clamped' },
    WHOLE_RESULT,
    'The covered period goes beyond the requested period.',
    'Nothing to correct: it is brought back to the requested period.',
  ],
] satisfies readonly (readonly [ResultWarning, string, string, string])[];

describe('blockingErrorMessage', () => {
  it('[IMP-20] [CL-IMP-02] gives every blocking error the whole result as its location, what is wrong and how to fix it', () => {
    expectTypeOf<
      Exclude<BlockingError['kind'], (typeof BLOCKING_ERRORS)[number][0]['kind']>
    >().toBeNever();
    for (const [error, problem, fix] of BLOCKING_ERRORS) {
      expect(blockingErrorMessage(error, CONTEXT)).toStrictEqual(whole(problem, fix));
    }
  });

  it('[IMP-06] [CA-IMP-02] refuses a result of format version 2.0 whole, inviting to copy the prompt again', () => {
    const pasted = JSON.stringify({ ...refusedEvents, [FORMAT_VERSION_KEY]: '2.0' });
    expect(refusalOf(pasted)).toStrictEqual([
      'This result is in a format version that the app does not know. Copy the prompt of this request again and run the research with it.',
    ]);
  });

  it('[IMP-06] says that a JSON of another format is not a backtest result', () => {
    const pasted = JSON.stringify({ format: 'egoscope-exploration', [FORMAT_VERSION_KEY]: '1.0' });
    expect(refusalOf(pasted)).toStrictEqual([
      "This text is not a backtest result. Paste the AI's answer to the prompt of this request.",
    ]);
  });

  it('[IMP-02] [IMP-20] [CL-IMP-27] gives a text too large the size and the limit that its size check writes, then how to fix it', () => {
    // 12,000 bytes, two per character.
    const check = checkPastedTextSize('é'.repeat(6000), 0.01);
    expect(check.ok ? undefined : blockingErrorMessage(check.error, CONTEXT).text).toBe(
      "The pasted text is 0.02 MB, over the 0.01 MB limit. Paste the AI's answer alone.",
    );
  });

  it('[IMP-07] [IMP-20] names both players when the result is about another player than the request', () => {
    const error: BlockingError = {
      kind: 'other_request',
      resultPlayer: 'Player B',
      requestPlayer: 'Player A',
    };
    expect(blockingErrorMessage(error, CONTEXT).text).toBe(
      'This result is about Player B, but this request is about Player A. Open the request of Player B to import it.',
    );
  });

  it('[IMP-05] [IMP-20] names the event that a cut answer allowing no recovery stops in', () => {
    const [first, second, third] = refusedEvents.events;
    const text = JSON.stringify({ ...refusedEvents, events: [third, first, second] });
    const pasted = text.slice(0, text.indexOf('Abuse in the stands'));
    expect(refusalOf(pasted)).toStrictEqual([
      `The text stops before the end of the result: event 3 is cut off. ${COPY_AGAIN}`,
    ]);
  });

  it('[IMP-04] [IMP-20] locates a syntax error around the event where the reading stopped', () => {
    const text = JSON.stringify(refusedEvents);
    const date = '"2021-02-10"';
    const at = text.indexOf(date) + date.length;
    const pasted = `${text.slice(0, at)} [3]${text.slice(at)}`;
    expect(refusalOf(pasted)).toStrictEqual([
      `The result has a JSON syntax error around event 3. ${SEND_CORRECTION}`,
    ]);
  });

  it("[IMP-20] [IHM-13] writes the position of the event with the caller's count writer", () => {
    const marked: MessageContext = {
      writeCount: (count) => `#${String(count)}`,
      maxSourceLeadDays: 1,
    };
    const errors: readonly BlockingError[] = [
      { kind: 'cut_not_recoverable', path: ['events', 1233] },
      { kind: 'syntax_error', path: ['events', 0] },
    ];
    expect(errors.map((error) => blockingErrorMessage(error, marked).text)).toStrictEqual([
      `The text stops before the end of the result: event #1234 is cut off. ${COPY_AGAIN}`,
      `The result has a JSON syntax error around event #1. ${SEND_CORRECTION}`,
    ]);
  });
});

describe('resultWarningMessage', () => {
  it('[IMP-20] [CL-IMP-02] gives every warning on the whole result its location, a lead or a limitation by its position, what is wrong and what to do', () => {
    expectTypeOf<
      Exclude<ResultWarning['kind'], (typeof RESULT_WARNINGS)[number][0]['kind']>
    >().toBeNever();
    for (const [warning, location, problem, fix] of RESULT_WARNINGS) {
      expect(resultWarningMessage(warning, CONTEXT)).toStrictEqual(
        location === WHOLE_RESULT
          ? whole(problem, fix)
          : { location, problem, fix, text: `${location}: ${problem} ${fix}` },
      );
    }
  });

  it("[IMP-20] [IHM-13] writes counts and positions with the caller's count writer", () => {
    const marked: MessageContext = {
      writeCount: (count) => `#${String(count)}`,
      maxSourceLeadDays: 1,
    };
    const warnings: readonly ResultWarning[] = [
      { kind: 'lead_ignored', detail: 2 },
      { kind: 'unknown_fields', detail: 1 },
      { kind: 'events_not_sorted', detail: 1234 },
    ];
    expect(warnings.map((warning) => resultWarningMessage(warning, marked).text)).toStrictEqual([
      'Lead #2: this lead is incomplete or too long, and is ignored. Nothing to correct.',
      'The result holds #1 field that the format does not define. Nothing to correct: such fields are ignored and never saved.',
      'The events are not sorted by public date from event #1234. Nothing to correct: the order matters only to recover a cut result.',
    ]);
  });
});
