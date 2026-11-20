import { describe, expect, it } from 'vitest';

import example from '@data/fixtures/ai-exchange/research-result/reading/full-example.json';

import { checkText } from '../text-rules';
import {
  BACKTEST_FORMAT,
  FORMAT_VERSION,
  GAME_STAKES,
  INJURY_RETURNS,
  RESEARCH_CONFIDENCES,
  RESULT_SCHEMA,
  stripUnknownFields,
} from './format';

// The types of the request that the example answers.
const REQUESTED = ['player-conflict', 'public-humiliation', 'racist-abuse', 'record-approach'];
// The maximum length of a description by default, in code points (DSN-20, CL-IMP-26).
const MAX_DESCRIPTION_LENGTH = 200;

/** A value of the example, and the closed list that must hold it as written. */
type Listed = readonly [value: string, values: readonly string[]];

/**
 * The values of the example that a closed list holds, in the order of the format: the
 * format and its version; the covered types, among the request's; the type of each event
 * and lead, among the covered types; the context and the research confidence of each
 * event, among the format's own values, those of glossary section 6.1.
 */
const CLOSED_VALUES: readonly Listed[] = [
  [example.format, [BACKTEST_FORMAT]],
  [example.format_version, [FORMAT_VERSION]],
  ...example.covered_types.map((type): Listed => [type, REQUESTED]),
  ...example.events.flatMap(({ context, ...event }): Listed[] => [
    [event.event_type, example.covered_types],
    [context.injury_return, INJURY_RETURNS],
    [context.game_stakes, GAME_STAKES],
    [event.confidence, RESEARCH_CONFIDENCES],
  ]),
  ...example.unverified_leads.map((lead): Listed => [lead.event_type, example.covered_types]),
];

/**
 * The free texts that the example writes, in the order of the format: the description,
 * context detail and unverified note of each event, the texts of each lead, and the
 * limitations (05, the general rules of format 1.0). A value that is no text is left to
 * the test of the leaves, which names it.
 */
const FREE_TEXTS = [
  ...example.events.flatMap((event) => [
    event.description,
    event.context.detail,
    event.unverified_note,
  ]),
  ...example.unverified_leads.flatMap((lead) => [
    lead.approximate_period,
    lead.description,
    lead.reason,
  ]),
  ...example.limitations,
].filter((text) => typeof text === 'string');

/** The values at the leaves of a JSON value, in their order. */
const leavesOf = (value: unknown): readonly unknown[] =>
  typeof value === 'object' && value !== null
    ? Object.values(value).flatMap((member: unknown) => leavesOf(member))
    : [value];

/** Whether a value is a text that holds more than spaces. */
const isWrittenText = (value: unknown): boolean => typeof value === 'string' && value.trim() !== '';

describe('format 1.0', () => {
  // The reader's own test of the example pins the value of every field, so that a field
  // that the example leaves out or writes otherwise fails it (read-result.test.ts).
  it('[CA-BKT-13] [CL-BKT-02] finds the full example of 05 valid and conforming field by field: only the keys of the format, every value a text with content and none null, each identifier and closed value as the request and glossary 6.1 spell it, each free text within the maximum length of a description and without quotation marks', () => {
    const unlisted = CLOSED_VALUES.filter(([value, values]) => !values.includes(value));
    const breaking = FREE_TEXTS.filter(
      (text) => checkText(text, MAX_DESCRIPTION_LENGTH).length > 0,
    );

    expect(stripUnknownFields(example, RESULT_SCHEMA)).toStrictEqual({
      value: example,
      unknownFieldCount: 0,
    });
    expect(leavesOf(example).filter((leaf) => !isWrittenText(leaf))).toStrictEqual([]);
    expect(unlisted).toStrictEqual([]);
    expect(breaking).toStrictEqual([]);
  });
});
