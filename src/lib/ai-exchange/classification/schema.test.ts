import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import answerSchema from '@data/fixtures/ai-exchange/classification/answer-schema.json';
import exampleAnswer from '@data/fixtures/ai-exchange/classification/example-answer.json';

import { CLASSIFICATION_ANSWER_SCHEMA } from './schema';

type Json = Readonly<Record<string, unknown>>;

const isJson = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const keysOf = (value: unknown): readonly string[] => (isJson(value) ? Object.keys(value) : []);

const CAPITAL = /[A-Z]/gu;
const snakeKey = (key: string): string =>
  key.replaceAll(CAPITAL, (capital) => `_${capital.toLowerCase()}`);
const snakeMembers = (member: Json): Json =>
  Object.fromEntries(Object.entries(member).map(([key, inner]) => [snakeKey(key), inner]));
// A value written as a model writes the answer, with snake-case keys: `entryId` is `entry_id`.
const asAnswer = (value: Json): unknown =>
  JSON.parse(
    JSON.stringify(value, (_key, member: unknown) =>
      isJson(member) ? snakeMembers(member) : member,
    ),
  );

// The schema read by a JSON Schema validator, as a provider's strict mode reads it.
const validator = z.fromJSONSchema(CLASSIFICATION_ANSWER_SCHEMA.schema);
const isAccepted = (answer: unknown): boolean => validator.safeParse(answer).success;

const FACT: Json = {
  eventType: 'public-humiliation',
  detectionConfidence: 86,
  description:
    "At a press conference, team X's coach questioned player A's ability to decide a game.",
  novelty: 'new_fact',
  playerEventId: null,
  timingHint: null,
  context: { injuryReturn: 'unknown', gameStakes: 'unknown' },
  justification: 'An identified coach publicly belittled the player at a press conference.',
};
const partWith = (fact: Json, changes: Json = {}): Json => ({
  playerId: '3f1c9a2e-7b4d-4e8a-9c61-2d5f8e0b7a14',
  validatedTypeFacts: [fact],
  knownEntryFacts: [],
  newTypeFacts: [],
  calendarFacts: [],
  ...changes,
});
const answerOf = (part: Json): unknown =>
  asAnswer({ results: [{ articleId: '1024', players: [part] }] });
const answerWith = (fact: Json, changes: Json = {}): unknown => answerOf(partWith(fact, changes));
const without = (record: Json, key: string): Json =>
  Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
const PART_WITHOUT_CALENDAR = without(partWith(FACT), 'calendarFacts');

// Every object schema of `schema`, its own included, found through its properties and items.
function objectSchemas(schema: Json): readonly Json[] {
  const properties = isJson(schema['properties']) ? Object.values(schema['properties']) : [];
  const children = [...properties, schema['items']].filter((child) => isJson(child));
  const own = schema['type'] === 'object' ? [schema] : [];
  return [...own, ...children.flatMap((child) => objectSchemas(child))];
}

describe('CLASSIFICATION_ANSWER_SCHEMA', () => {
  it('[DET-16] is the answer of detection.md section 5.2, with one list per fact kind', () => {
    expect(CLASSIFICATION_ANSWER_SCHEMA).toStrictEqual(answerSchema);
  });

  it('[DET-16] requires every property and forbids any other, at every level', () => {
    const objects = objectSchemas(CLASSIFICATION_ANSWER_SCHEMA.schema);

    expect(objects).toHaveLength(8);
    for (const object of objects) {
      expect(object['required']).toStrictEqual(keysOf(object['properties']));
      expect(object['additionalProperties']).toBe(false);
    }
  });

  it('[DET-16] accepts the example answer of detection.md section 5.2', () => {
    expect(isAccepted(exampleAnswer)).toBe(true);
    expect(isAccepted(answerWith(FACT))).toBe(true);
    expect(isAccepted(answerWith({ ...FACT, novelty: 'known_event', playerEventId: '501' }))).toBe(
      true,
    );
  });

  it('[DET-16] accepts the facts of the other kinds', () => {
    const part = {
      knownEntryFacts: [{ entryId: 'trade-rumor', justification: 'It matches the entry.' }],
      newTypeFacts: [
        { suggestedName: 'Snub', suggestedDefinition: 'A snub.', justification: 'No type fits.' },
      ],
      calendarFacts: [{ calendarType: 'birthday' }],
    };

    expect(isAccepted(answerWith(FACT, part))).toBe(true);
  });

  it.each([
    ['a fact without its timing hint', answerWith(without(FACT, 'timingHint'))],
    ['a part without its calendar facts', answerOf(PART_WITHOUT_CALENDAR)],
    ['an answer without results', {}],
  ])('[DET-16] rejects a missing key: %s', (_case, answer) => {
    expect(isAccepted(answer)).toBe(false);
  });

  it.each([
    ['a validated-type fact with an entry', answerWith({ ...FACT, entryId: 'trade-rumor' })],
    [
      'a context with a third indication',
      answerWith({ ...FACT, context: { injuryReturn: 'no', gameStakes: 'normal', mood: 'low' } }),
    ],
    ['a part with a list of its own', answerWith(FACT, { teamFacts: [] })],
    ['an answer with a comment', { ...exampleAnswer, comment: 'Done.' }],
  ])('[DET-16] rejects an extra key: %s', (_case, answer) => {
    expect(isAccepted(answer)).toBe(false);
  });

  it.each([
    ['a novelty', { ...FACT, novelty: 'rumor' }],
    ['a return from injury', { ...FACT, context: { injuryReturn: 'maybe', gameStakes: 'normal' } }],
    ['game stakes', { ...FACT, context: { injuryReturn: 'no', gameStakes: 'decisive' } }],
  ])('[DET-16] rejects a value outside its list: %s', (_case, fact) => {
    expect(isAccepted(answerWith(fact))).toBe(false);
  });
});
