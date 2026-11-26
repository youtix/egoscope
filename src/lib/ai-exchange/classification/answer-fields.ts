// The reading of the values of a classification answer, which `answer.ts` checks against
// the request (detection.md section 5.2, CL-DET-02): each value with its place in the
// answer, read as the schema types it, or the first fault that makes its part unusable.
// Nothing read is trusted for its shape, so no value makes a reader throw.
import { canonicalValue, isAbsent, isRecord } from '../conventions';
import { checkText } from '../text-rules';

import type { ExtractJsonError, JsonPath } from '../extract-json';

/**
 * Why a part is unusable (DET-22, CL-DET-02), `path` naming the place of the answer at
 * fault: the answer holds no readable JSON object (`unreadable_answer`, with the cause that
 * `extractJson` gave); the article has no result or several; the player has no part or
 * several, or the result names a player who was not sent instead (`unknown_player`); a key
 * is missing or not in the schema, a value is of the wrong type or a required text empty;
 * an identifier was not sent (`unknown_identifier`), or names a type that is not validated
 * (`type_not_validated`: proposed, rejected, withdrawn or calendar-derived, DET-15); a
 * closed value or a date is invalid; a confidence lies outside 0 to 100; the novelty and
 * the event identifier disagree.
 */
export type UnusablePartReason =
  | Readonly<{ kind: 'unreadable_answer'; cause: ExtractJsonError['kind'] }>
  | Readonly<{ kind: 'no_result' | 'several_results' | 'missing_part' | 'several_parts' }>
  | Readonly<{ kind: 'unknown_player'; playerId: string }>
  | Readonly<{
      kind: 'missing_key' | 'unexpected_key' | 'wrong_type' | 'empty_text' | 'novelty_mismatch';
      path: JsonPath;
    }>
  | Readonly<{
      kind: 'unknown_identifier' | 'type_not_validated' | 'value_outside_list' | 'invalid_date';
      path: JsonPath;
      value: string;
    }>
  | Readonly<{ kind: 'confidence_out_of_range'; path: JsonPath; value: number }>;

/** A text of the model as kept, or not kept because it failed DSN-24: « texte non conservé ». */
export type CheckedText = Readonly<{ kept: true; text: string }> | Readonly<{ kept: false }>;

/**
 * A description as kept, or not kept because it failed DSN-24: the caller writes the
 * template description in its place, with the mark `description_to_review` (DET-21).
 */
export type CheckedDescription =
  Readonly<{ kept: true; text: string }> | Readonly<{ kept: false; mark: 'description_to_review' }>;

/** A value of the answer as read, or the fault that makes its part unusable. */
export type Checked<T> =
  Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; reason: UnusablePartReason }>;

/** A value of the answer with its place in it. */
export type Field = Readonly<{ value: unknown; path: JsonPath }>;

/** The members of an object of the answer, by their keys. */
export type Fields<Key extends string> = (key: Key) => Field;

/** A value read without fault (CL-DET-02). */
export function accept<T>(value: T): Checked<T> {
  return { ok: true, value };
}

/** The fault that makes a part unusable (DET-22, CL-DET-02). */
export function refuse(
  reason: UnusablePartReason,
): Readonly<{ ok: false; reason: UnusablePartReason }> {
  return { ok: false, reason };
}

/** Two values read, as one object, or the first one's fault, else the second one's (CL-DET-02). */
export function merged<First extends object, Second extends object>(
  first: Checked<First>,
  second: Checked<Second>,
): Checked<First & Second> {
  if (!first.ok) {
    return first;
  }
  return second.ok ? accept({ ...first.value, ...second.value }) : second;
}

/**
 * The members of an object that has exactly the keys `keys`, as strict mode writes it: a
 * key missing or one that the schema does not list is a fault (CL-DET-02).
 */
export function readObject<Key extends string>(
  field: Field,
  keys: readonly Key[],
): Checked<Fields<Key>> {
  const { value, path } = field;
  if (!isRecord(value)) {
    return refuse({ kind: 'wrong_type', path });
  }
  const missing = keys.find((key) => !Object.hasOwn(value, key));
  if (missing !== undefined) {
    return refuse({ kind: 'missing_key', path: [...path, missing] });
  }
  const allowed: readonly string[] = keys;
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  return unexpected === undefined
    ? accept((key: Key) => ({ value: value[key], path: [...path, key] }))
    : refuse({ kind: 'unexpected_key', path: [...path, unexpected] });
}

/** The items of a list, each with its place (CL-DET-02). */
export function readList(field: Field): Checked<readonly Field[]> {
  const { value, path } = field;
  return Array.isArray(value)
    ? accept(value.map((item: unknown, index) => ({ value: item, path: [...path, index] })))
    : refuse({ kind: 'wrong_type', path });
}

/** A text (CL-DET-02). */
export function readString(field: Field): Checked<string> {
  return typeof field.value === 'string'
    ? accept(field.value)
    : refuse({ kind: 'wrong_type', path: field.path });
}

/** A text or `null`, strict mode's absent value (CL-DET-02). */
export function readNullableString(field: Field): Checked<string | null> {
  return field.value === null ? accept(null) : readString(field);
}

/**
 * A text of the model, which may not be empty, kept when it passes the checks of DSN-24 on
 * its length and its quotation marks (DET-21, DSN-25, CL-DET-18, CL-DSN-03).
 */
export function readText(field: Field, maxLength: number): Checked<CheckedText> {
  const read = readString(field);
  if (!read.ok) {
    return read;
  }
  if (isAbsent(read.value)) {
    return refuse({ kind: 'empty_text', path: field.path });
  }
  const isCompliant = checkText(read.value, maxLength).length === 0;
  const text: CheckedText = isCompliant ? { kept: true, text: read.value } : { kept: false };
  return accept(text);
}

/** A description, kept when it passes DSN-24, otherwise marked for the template (DET-21). */
export function readDescription(field: Field, maxLength: number): Checked<CheckedDescription> {
  const read = readText(field, maxLength);
  if (!read.ok) {
    return read;
  }
  const { value } = read;
  const description: CheckedDescription = value.kept
    ? value
    : { kept: false, mark: 'description_to_review' };
  return accept(description);
}

/** A value among `values`, compared as the module compares closed values (CL-IMP-22). */
export function readClosed<Value extends string>(
  field: Field,
  values: readonly Value[],
): Checked<Value> {
  const read = readString(field);
  if (!read.ok) {
    return read;
  }
  const value = canonicalValue(read.value, values);
  return value === undefined
    ? refuse({ kind: 'value_outside_list', path: field.path, value: read.value })
    : accept(value);
}

/** An identifier among those the request sent, `ids` (DET-22, CL-DET-02). */
export function readSentId(field: Field, ids: readonly string[]): Checked<string> {
  const read = readString(field);
  return !read.ok || ids.includes(read.value)
    ? read
    : refuse({ kind: 'unknown_identifier', path: field.path, value: read.value });
}

/** The identifier that an element of the answer names under `key`, when it is an object. */
export function idOf(field: Field, key: string): unknown {
  return isRecord(field.value) ? field.value[key] : undefined;
}
