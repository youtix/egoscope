// The research-result format 1.0, the one contract between the research prompt and the
// import (BKT-24, CL-BKT-02): its name and its version, its keys at every level, the
// English keys of glossary section 6.1, and the shape of a result once read. A pasted
// result is untrusted text, so a field reads as a text, a value of the format's own list
// or a date, or as nothing; a key that the format does not define is an unknown field,
// dropped and counted (IMP-16).
import { isRecord, valuesOf } from '../conventions';

import type { DateReading } from './dates';

/** The name of the research-result format, the value of its `format` member (BKT-24, IMP-04). */
export const BACKTEST_FORMAT = 'egoscope-backtest';

/** The version of the format that the research prompt asks for and the import reads, its only one (BKT-24, IMP-06). */
export const FORMAT_VERSION = '1.0';

/** The values of `context.injury_return` (H-BKT-08, SEN-13), glossary section 6.1. */
export const INJURY_RETURNS = valuesOf(['yes', 'no', 'unknown']);

/** The values of `context.game_stakes` (H-BKT-08, SEN-14), glossary section 6.1. */
export const GAME_STAKES = valuesOf(['high', 'normal', 'unknown']);

/** The values of `confidence`, the research confidence (H-BKT-07, prompt rule 2.8), glossary section 6.1. */
export const RESEARCH_CONFIDENCES = valuesOf(['high', 'medium', 'low']);

/** Whether the player was returning from injury in the first NBA game after the event (SEN-13). */
export type InjuryReturn = (typeof INJURY_RETURNS)[number];

/** Whether the outcome of that game directly decided a qualification, an elimination, a title or a final ranking (SEN-14). */
export type GameStakes = (typeof GAME_STAKES)[number];

/** How sure the research AI is of an event (prompt rule 2.8). */
export type ResearchConfidence = (typeof RESEARCH_CONFIDENCES)[number];

/**
 * A source of a research event as read (IMP-14): its link, outlet and title as written,
 * each undefined when it is missing, and its publication date as dates.ts reads it.
 */
export type ResearchSource = Readonly<{
  url: string | undefined;
  outlet: string | undefined;
  title: string | undefined;
  publicationDate: DateReading;
}>;

/**
 * The context of the first NBA game that the player played after the event (H-09,
 * H-BKT-08), each value the format's own, or undefined when it is missing or another one
 * (IMP-15); `detail`, the optional sentence that helps to check them, as written.
 */
export type ContextIndications = Readonly<{
  injuryReturn: InjuryReturn | undefined;
  gameStakes: GameStakes | undefined;
  detail: string | undefined;
}>;

/**
 * An element of `events` as read, before its own checks (IMP-11 to IMP-15): its type and
 * texts as written, each undefined when it is missing; its public date as dates.ts reads
 * it; its sources, none when they are missing or not a list; its context, every value
 * undefined when the context is missing; its research confidence, undefined when missing
 * or another value. An element that is not an object has every field missing.
 */
export type ResearchEvent = Readonly<{
  eventType: string | undefined;
  publicDate: DateReading;
  description: string | undefined;
  sources: readonly ResearchSource[];
  context: ContextIndications;
  researchConfidence: ResearchConfidence | undefined;
  unverifiedNote: string | undefined;
}>;

/** An element of `unverified_leads` as read (IMP-15, CL-IMP-23): each field as written, or undefined when it is missing. */
export type UnverifiedLead = Readonly<{
  eventType: string | undefined;
  approximatePeriod: string | undefined;
  description: string | undefined;
  reason: string | undefined;
}>;

/**
 * A research result read in format 1.0 (BKT-24), its whole-result checks passed (IMP-06,
 * IMP-09). `reference` and `player` are as written, for the import to tie to a request
 * (IMP-07), each undefined when it is missing. `coveredTypes` lists each declared type
 * once (CL-IMP-23), in the request's spelling when it names a requested type (CL-IMP-22)
 * and as written otherwise. `coveredPeriod` holds the calendar dates of its bounds as
 * written (CL-IMP-08). `events` keeps every element in its place, so that an event's
 * position is its index plus one (CL-IMP-02), and so does `declaredLimitations`, each
 * limitation as written or undefined when it is no text. A missing list of leads or of
 * limitations is empty.
 */
export type ResearchResult = Readonly<{
  formatVersion: typeof FORMAT_VERSION;
  reference: string | undefined;
  player: Readonly<{ id: string | undefined; name: string | undefined }>;
  coveredTypes: readonly string[];
  coveredPeriod: Readonly<{ startOn: string; endOn: string }>;
  events: readonly ResearchEvent[];
  unverifiedLeads: readonly UnverifiedLead[];
  declaredLimitations: readonly (string | undefined)[];
}>;

// What the value of a key holds that the stripping goes into: an object of the format, or
// a list of them, with the keys of that object.
type Holds = Readonly<{ object: KeySchema }> | Readonly<{ listOf: KeySchema }>;

// A key of an object of an exchange format: alone, for a value of any kind, or with what
// its value holds.
type SchemaField = string | (Readonly<{ key: string }> & Holds);

// The keys that an object of an exchange format may hold.
type KeySchema = readonly SchemaField[];

/** A value with the keys that its schema does not define taken out, and how many there were (IMP-16). */
type StrippedValue = Readonly<{ value: unknown; unknownFieldCount: number }>;

const SOURCE_SCHEMA: KeySchema = ['url', 'outlet', 'title', 'publication_date'];
const CONTEXT_SCHEMA: KeySchema = ['injury_return', 'game_stakes', 'detail'];
const EVENT_SCHEMA: KeySchema = [
  'event_type',
  'public_date',
  'description',
  { key: 'sources', listOf: SOURCE_SCHEMA },
  { key: 'context', object: CONTEXT_SCHEMA },
  'confidence',
  'unverified_note',
];
const LEAD_SCHEMA: KeySchema = ['event_type', 'approximate_period', 'description', 'reason'];

/** The keys of a research result at every level, glossary section 6.1 (BKT-24). */
export const RESULT_SCHEMA: KeySchema = [
  'format',
  'format_version',
  'request_reference',
  { key: 'player', object: ['id', 'name'] },
  'covered_types',
  { key: 'covered_period', object: ['start', 'end'] },
  { key: 'events', listOf: EVENT_SCHEMA },
  { key: 'unverified_leads', listOf: LEAD_SCHEMA },
  'limitations',
];

function unknownFieldsOf(values: readonly StrippedValue[]): number {
  return values.reduce((count, value) => count + value.unknownFieldCount, 0);
}

/**
 * A value stripped as `holds` says (IMP-16): an object with the keys of its schema alone,
 * at every level that the schema describes, or each object of a list so. A value of
 * another kind, or that holds nothing to strip, stays as written. The recursion follows
 * the schema, never the value, so that no depth of nesting can overflow the stack.
 */
function stripValue(value: unknown, holds: Holds | undefined): StrippedValue {
  if (holds !== undefined && 'listOf' in holds && Array.isArray(value)) {
    const object = { object: holds.listOf };
    const elements = value.map((element: unknown) => stripValue(element, object));
    const values = elements.map((element) => element.value);
    return { value: values, unknownFieldCount: unknownFieldsOf(elements) };
  }
  if (holds === undefined || !('object' in holds) || !isRecord(value)) {
    return { value, unknownFieldCount: 0 };
  }
  const fields = new Map(
    holds.object.map((field): [string, Holds | undefined] =>
      typeof field === 'string' ? [field, undefined] : [field.key, field],
    ),
  );
  const members = Object.entries(value);
  const known = members
    .filter(([key]) => fields.has(key))
    .map(([key, member]): [string, StrippedValue] => [key, stripValue(member, fields.get(key))]);
  return {
    value: Object.fromEntries(known.map(([key, member]) => [key, member.value])),
    unknownFieldCount:
      members.length - known.length + unknownFieldsOf(known.map(([, member]) => member)),
  };
}

/**
 * Strips the keys that a schema of an exchange format does not define from an object of
 * that format, at every level that the schema describes, and counts them (IMP-16): an
 * unknown key, camel-cased, French or of any other spelling, is dropped with its value,
 * whatever that holds, and counts once. A value that is not an object stays as written.
 */
export function stripUnknownFields(value: unknown, schema: KeySchema): StrippedValue {
  return stripValue(value, { object: schema });
}
