// The JSON schema of the classification answer (detection.md section 5.2), sent with every
// classification call in the providers' strict structured-output mode, which needs every
// property in `required` and `additionalProperties: false` at every level (detection-model
// service sheet, rule 3): so every key is present, and an absent value is `null`. One array
// per fact kind spares strict mode an `anyOf`, and a fact cannot mix kinds (detection.md,
// modeling choice 2). The confidence's bounds are left to the checks of `answer.ts`, since
// strict modes differ on the keywords they honor beyond these.
import { valuesOf } from '../conventions';
import { GAME_STAKES, INJURY_RETURNS } from '../research-result/format';

/** A JSON schema, as a provider's structured-output mode reads it. */
export type JsonSchema = Readonly<Record<string, unknown>>;

/**
 * The novelty of a validated-type fact (DET-16, DET-20, DET-28; glossary `FactNovelty`): a
 * new fact, an old fact public before the grouping window, or one of the player's events
 * sent with the request (detection.md, modeling choice 1).
 */
export const FACT_NOVELTIES = valuesOf(['new_fact', 'old_fact', 'known_event']);

/** A novelty of `FACT_NOVELTIES`. */
export type FactNovelty = (typeof FACT_NOVELTIES)[number];

// A property of an object of the answer: its key, in snake case, and its schema.
type Property = readonly [string, JsonSchema];

// The schema of an object of the answer, and its keys, which the checks read.
type ObjectSchema<Key extends string> = Readonly<{ schema: JsonSchema; keys: readonly Key[] }>;

const STRING: JsonSchema = { type: 'string' };
const STRING_OR_NULL: JsonSchema = { type: ['string', 'null'] };

/** A text among `values`. */
function closedList(values: readonly string[]): JsonSchema {
  return { type: 'string', enum: values };
}

/** A list of `items`, possibly empty. */
function listOf(items: JsonSchema): JsonSchema {
  return { type: 'array', items };
}

/** An object with exactly the properties `properties`, in their order, each required. */
function strictObject<const Properties extends readonly Property[]>(
  properties: Properties,
): ObjectSchema<Properties[number][0]> {
  const keys = properties.map((property: Properties[number]): Properties[number][0] => property[0]);
  return {
    schema: {
      type: 'object',
      properties: Object.fromEntries(properties),
      required: keys,
      additionalProperties: false,
    },
    keys,
  };
}

const CONTEXT = strictObject([
  ['injury_return', closedList(INJURY_RETURNS)],
  ['game_stakes', closedList(GAME_STAKES)],
]);

const VALIDATED_TYPE_FACT = strictObject([
  ['event_type', STRING],
  ['detection_confidence', { type: 'number' }],
  ['description', STRING],
  ['novelty', closedList(FACT_NOVELTIES)],
  ['player_event_id', STRING_OR_NULL],
  ['timing_hint', STRING_OR_NULL],
  ['context', CONTEXT.schema],
  ['justification', STRING],
]);

const KNOWN_ENTRY_FACT = strictObject([
  ['entry_id', STRING],
  ['justification', STRING],
]);

const NEW_TYPE_FACT = strictObject([
  ['suggested_name', STRING],
  ['suggested_definition', STRING],
  ['justification', STRING],
]);

const CALENDAR_FACT = strictObject([['calendar_type', STRING]]);

const PART = strictObject([
  ['player_id', STRING],
  ['validated_type_facts', listOf(VALIDATED_TYPE_FACT.schema)],
  ['known_entry_facts', listOf(KNOWN_ENTRY_FACT.schema)],
  ['new_type_facts', listOf(NEW_TYPE_FACT.schema)],
  ['calendar_facts', listOf(CALENDAR_FACT.schema)],
]);

const RESULT = strictObject([
  ['article_id', STRING],
  ['players', listOf(PART.schema)],
]);

const ANSWER = strictObject([['results', listOf(RESULT.schema)]]);

// The keys of each object of the answer, in the order of detection.md section 5.2.
export const ANSWER_KEYS = ANSWER.keys;
export const RESULT_KEYS = RESULT.keys;
export const PART_KEYS = PART.keys;
export const VALIDATED_TYPE_FACT_KEYS = VALIDATED_TYPE_FACT.keys;
export const CONTEXT_KEYS = CONTEXT.keys;
export const KNOWN_ENTRY_FACT_KEYS = KNOWN_ENTRY_FACT.keys;
export const NEW_TYPE_FACT_KEYS = NEW_TYPE_FACT.keys;
export const CALENDAR_FACT_KEYS = CALENDAR_FACT.keys;

/**
 * The name and JSON schema of the classification answer (DET-16, detection.md section 5.2),
 * written for strict structured output (detection-model service sheet, rule 3): one result
 * per article, one part per recognized player, and in each part one list per fact kind,
 * validated-type facts, known-entry facts, new-type facts and calendar facts (DET-34,
 * CL-DET-02, CL-DET-22); the closed values of the novelty and of the context indications are
 * listed (SEN-13, SEN-14).
 */
export const CLASSIFICATION_ANSWER_SCHEMA: Readonly<{ name: string; schema: JsonSchema }> = {
  name: 'classification_answer',
  schema: ANSWER.schema,
};
