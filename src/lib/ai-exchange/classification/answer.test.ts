import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import codeFences from '@data/fixtures/ai-exchange/classification/code-fences.json';
import exampleAnswer from '@data/fixtures/ai-exchange/classification/example-answer.json';
import proseAround from '@data/fixtures/ai-exchange/classification/prose-around.json';
import truncated from '@data/fixtures/ai-exchange/classification/truncated.json';
import wrongTypes from '@data/fixtures/ai-exchange/classification/wrong-types.json';

import { checkAnswer } from './answer';

import type { CheckedPart } from './answer';
import type { CheckedValidatedTypeFact } from './answer-facts';
import type { UnusablePartReason } from './answer-fields';
import type {
  ClassificationRequest,
  ClassificationRequestArticle,
  ClassificationRequestPlayer,
} from './request';

type Json = Readonly<Record<string, unknown>>;
type Path = readonly (number | string)[];

const PLAYER_A = '3f1c9a2e-7b4d-4e8a-9c61-2d5f8e0b7a14';
const PLAYER_B = '8d2e4c6a-1b3f-4a5d-9e7c-0f2a4b6c8d1e';
const DESCRIPTION =
  "At a press conference, team X's coach questioned player A's ability to decide a game.";
const JUSTIFICATION = 'An identified coach publicly belittled the player at a press conference.';

const typeSheet = (id: string): ClassificationRequest['validatedTypes'][number] => ({
  id,
  name: id,
  definition: `The definition of ${id}.`,
  inclusionCriteria: 'Its inclusion criteria.',
  exclusionCriteria: 'Its exclusion criteria.',
  datingRule: 'Its dating rule.',
  knownInAdvance: false,
  genericExample: 'Its example.',
});
const player = (playerId: string, eventId: string): ClassificationRequestPlayer => ({
  playerId,
  names: ['Darian Wexley'],
  events: [
    {
      playerEventId: eventId,
      eventType: 'public-humiliation',
      referenceDate: '2026-11-23T20:00:00-05:00',
      description: 'An opponent mocks the player on social media.',
    },
  ],
});
const article = (
  articleId: string,
  players: readonly ClassificationRequestPlayer[],
): ClassificationRequestArticle => ({
  articleId,
  title: 'A coach doubts the guard of the Harbor City Gulls',
  excerpt: null,
  outlet: 'The Lakeside Ledger',
  publishedAt: '2026-11-24T14:30:00-05:00',
  publishedPrecision: 'exact',
  players,
});
const REQUEST: ClassificationRequest = {
  instructionsVersion: '1.0',
  validatedTypes: [typeSheet('media-storm'), typeSheet('public-humiliation')],
  doNotRepropose: [{ id: 'trade-rumor', name: 'Trade rumor', definition: 'A rumored trade.' }],
  calendarTypes: [{ id: 'birthday', name: 'Birthday game', definition: 'A game on his birthday.' }],
  articles: [article('1024', [player(PLAYER_A, '501')])],
};
// Two articles, the second with two players, the second of whom alone has event 502.
const BATCH: ClassificationRequest = {
  ...REQUEST,
  articles: [
    article('1024', [player(PLAYER_A, '501')]),
    article('1025', [player(PLAYER_A, '501'), player(PLAYER_B, '502')]),
  ],
};

// The answers are written in camel case here and sent in snake case: `entryId` is `entry_id`.
const CAPITAL = /[A-Z]/gu;
const snakeKey = (key: string): string =>
  key.replaceAll(CAPITAL, (capital) => `_${capital.toLowerCase()}`);
const isJson = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const snakeMembers = (member: Json): Json =>
  Object.fromEntries(Object.entries(member).map(([key, inner]) => [snakeKey(key), inner]));
const answerText = (value: Json): string =>
  JSON.stringify(value, (_key, member: unknown) =>
    isJson(member) ? snakeMembers(member) : member,
  );

const FACT: Json = {
  eventType: 'public-humiliation',
  detectionConfidence: 86,
  description: DESCRIPTION,
  novelty: 'new_fact',
  playerEventId: null,
  timingHint: null,
  context: { injuryReturn: 'unknown', gameStakes: 'unknown' },
  justification: JUSTIFICATION,
};
const CHECKED: CheckedValidatedTypeFact = {
  kind: 'validated_type',
  eventTypeId: 'public-humiliation',
  detectionConfidence: 86,
  description: { kept: true, text: DESCRIPTION },
  novelty: 'new_fact',
  playerEventId: null,
  timingHintOn: null,
  context: { injuryReturn: 'unknown', gameStakes: 'unknown' },
  justification: { kept: true, text: JUSTIFICATION },
};
const KNOWN_ENTRY: Json = { entryId: 'trade-rumor', justification: 'It matches the entry.' };
const NEW_TYPE: Json = {
  suggestedName: 'Public snub',
  suggestedDefinition: 'A coach publicly ignores the player.',
  justification: 'No validated type covers a snub.',
};

const part = (lists: Json = {}, playerId: unknown = PLAYER_A): Json => ({
  playerId,
  validatedTypeFacts: [],
  knownEntryFacts: [],
  newTypeFacts: [],
  calendarFacts: [],
  ...lists,
});
const without = (record: Json, key: string): Json =>
  Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
const result = (articleId: string, players: unknown): Json => ({ articleId, players });
const EMPTY_PART = part();
const EMPTY_RESULT = result('1024', [EMPTY_PART]);
const PART_WITHOUT_CALENDAR = without(EMPTY_PART, 'calendarFacts');
const answer = (...results: readonly unknown[]): string => answerText({ results });
const withParts = (...parts: readonly unknown[]): string => answer(result('1024', parts));
const withLists = (lists: Json): string => withParts(part(lists));
const withFact = (changes: Json): string =>
  withLists({ validatedTypeFacts: [{ ...FACT, ...changes }] });
const withNewType = (changes: Json): string =>
  withLists({ newTypeFacts: [{ ...NEW_TYPE, ...changes }] });
const knownEvent = (eventId: unknown): string =>
  withFact({ novelty: 'known_event', playerEventId: eventId });
const textOf = (fixture: Readonly<{ text: readonly string[] }>): string => fixture.text.join('\n');

const check = (text: string, request: ClassificationRequest = REQUEST): readonly CheckedPart[] =>
  checkAnswer(text, request, { maxDescriptionLength: 200 });
const usable = (...facts: readonly unknown[]): readonly unknown[] => [
  { articleId: '1024', playerId: PLAYER_A, kind: 'facts', facts },
];
const unusable = (reason: UnusablePartReason): readonly unknown[] => [
  { articleId: '1024', playerId: PLAYER_A, kind: 'unusable', reason },
];
const PART_PATH = ['results', 0, 'players', 0];
const at = (...keys: Path): Path => [...PART_PATH, 'validated_type_facts', 0, ...keys];
const listAt = (list: string, key: string): Path => [...PART_PATH, list, 0, key];
const fault = (
  kind: 'missing_key' | 'unexpected_key' | 'wrong_type' | 'empty_text',
  path: Path,
): UnusablePartReason => ({ kind, path });

// The outcomes of the parts of article 1025 of the batch.
const ofSecond = (playerId: string, outcome: Json): Json => ({
  articleId: '1025',
  playerId,
  ...outcome,
});
const NO_FACT = { kind: 'no_fact' };
const unusableOf = (reason: UnusablePartReason): Json => ({ kind: 'unusable', reason });
const secondUnusable = (reason: UnusablePartReason): readonly Json[] => [
  ofSecond(PLAYER_A, unusableOf(reason)),
  ofSecond(PLAYER_B, unusableOf(reason)),
];

// The parts of article 1025 of the batch, once article 1024 has its result.
const outcome = (...parts: readonly unknown[]): readonly CheckedPart[] =>
  check(answer(EMPTY_RESULT, result('1025', parts)), BATCH).slice(1);
// Every part of the batch, made unusable by an answer that holds no readable JSON.
const all = (cause: 'cut' | 'no_result_found' | 'syntax_error'): readonly unknown[] => [
  { articleId: '1024', playerId: PLAYER_A, ...unusableOf({ kind: 'unreadable_answer', cause }) },
  ...secondUnusable({ kind: 'unreadable_answer', cause }),
];

describe('checkAnswer', () => {
  it('[DET-16] reads the example answer of detection.md section 5.2 as a usable part', () => {
    expect(check(JSON.stringify(exampleAnswer))).toStrictEqual(usable(CHECKED));
  });

  it('[DET-16] reads a known event, a timing hint and the context of the next game', () => {
    const fact = {
      novelty: 'known_event',
      playerEventId: '501',
      timingHint: '2026-11-22',
      context: { injuryReturn: 'yes', gameStakes: 'high' },
    };
    const expected = {
      ...CHECKED,
      novelty: 'known_event',
      playerEventId: '501',
      timingHintOn: '2026-11-22',
      context: { injuryReturn: 'yes', gameStakes: 'high' },
    };

    expect(check(withFact(fact))).toStrictEqual(usable(expected));
  });

  it('[DET-16] reads a closed value whatever its case and spaces', () => {
    const fact = { novelty: 'Old_Fact', context: { injuryReturn: ' No', gameStakes: 'NORMAL' } };
    const expected = {
      ...CHECKED,
      novelty: 'old_fact',
      context: { injuryReturn: 'no', gameStakes: 'normal' },
    };

    expect(check(withFact(fact))).toStrictEqual(usable(expected));
  });

  it('[DET-16] [CL-DET-22] reads the facts of every kind in order and drops the calendar ones', () => {
    const lists = {
      validatedTypeFacts: [FACT],
      knownEntryFacts: [KNOWN_ENTRY],
      newTypeFacts: [NEW_TYPE],
      calendarFacts: [{ calendarType: 'birthday' }],
    };
    const knownEntry = {
      kind: 'known_entry',
      eventTypeId: 'trade-rumor',
      justification: { kept: true, text: 'It matches the entry.' },
    };
    const newType = {
      kind: 'new_type',
      suggestedTypeName: { kept: true, text: 'Public snub' },
      suggestedTypeDefinition: { kept: true, text: 'A coach publicly ignores the player.' },
      justification: { kept: true, text: 'No validated type covers a snub.' },
    };

    expect(check(withLists(lists))).toStrictEqual(usable(CHECKED, knownEntry, newType));
  });

  it('[DET-16] [CL-DET-22] reads no fact for a part left without facts', () => {
    const noFact = [{ articleId: '1024', playerId: PLAYER_A, kind: 'no_fact' }];
    const calendarOnly = withLists({ calendarFacts: [{ calendarType: 'birthday' }] });

    expect(check(withLists({}))).toStrictEqual(noFact);
    expect(check(calendarOnly)).toStrictEqual(noFact);
  });

  it.each([
    [85.5, 86],
    [85.49, 85],
    [99.5, 100],
    [0, 0],
    [100, 100],
  ])('[CL-DET-02] rounds a confidence of %s half up to %s', (confidence, rounded) => {
    expect(check(withFact({ detectionConfidence: confidence }))).toStrictEqual(
      usable({ ...CHECKED, detectionConfidence: rounded }),
    );
  });

  it.each([-1, -0.01, 100.01, 101])('[CL-DET-02] makes a confidence of %s unusable', (value) => {
    expect(check(withFact({ detectionConfidence: value }))).toStrictEqual(
      unusable({ kind: 'confidence_out_of_range', path: at('detection_confidence'), value }),
    );
  });

  it.each(['trade-rumor', 'birthday'])(
    '[DET-15] makes %s, a type proposed, rejected, withdrawn or calendar-derived, unusable as a validated type',
    (value) => {
      expect(check(withFact({ eventType: value }))).toStrictEqual(
        unusable({ kind: 'type_not_validated', path: at('event_type'), value }),
      );
    },
  );

  it.each([
    {
      sent: 'a type',
      text: withFact({ eventType: 'trade-request' }),
      path: at('event_type'),
      value: 'trade-request',
    },
    { sent: 'an event', text: knownEvent('999'), path: at('player_event_id'), value: '999' },
    {
      sent: "another player's event",
      text: knownEvent('502'),
      path: at('player_event_id'),
      value: '502',
    },
    {
      sent: 'an entry',
      text: withLists({ knownEntryFacts: [{ ...KNOWN_ENTRY, entryId: 'birthday' }] }),
      path: listAt('known_entry_facts', 'entry_id'),
      value: 'birthday',
    },
    {
      sent: 'a calendar type',
      text: withLists({ calendarFacts: [{ calendarType: 'trade-rumor' }] }),
      path: listAt('calendar_facts', 'calendar_type'),
      value: 'trade-rumor',
    },
  ])('[DET-16] makes $sent that was not sent unusable', ({ text, path, value }) => {
    expect(check(text, BATCH).slice(0, 1)).toStrictEqual(
      unusable({ kind: 'unknown_identifier', path, value }),
    );
  });

  it.each([
    ['known_event', null],
    ['new_fact', '501'],
    ['old_fact', '501'],
  ])('[DET-16] makes the novelty %s with the event %s unusable', (novelty, eventId) => {
    expect(check(withFact({ novelty, playerEventId: eventId }))).toStrictEqual(
      unusable({ kind: 'novelty_mismatch', path: at('player_event_id') }),
    );
  });

  it.each([
    [
      at('context', 'injury_return'),
      { context: { injuryReturn: 'maybe', gameStakes: 'normal' } },
      'maybe',
    ],
    [
      at('context', 'game_stakes'),
      { context: { injuryReturn: 'no', gameStakes: 'decisive' } },
      'decisive',
    ],
    [at('novelty'), { novelty: 'rumor' }, 'rumor'],
  ])('[DET-16] makes the value at %j outside its closed list unusable', (path, changes, value) => {
    expect(check(withFact(changes))).toStrictEqual(
      unusable({ kind: 'value_outside_list', path, value }),
    );
  });

  it.each(['2026-11-22T10:00+01:00', '2026-02-30', 'Sunday'])(
    '[CL-DET-02] makes the timing hint %s, not a day, unusable',
    (value) => {
      expect(check(withFact({ timingHint: value }))).toStrictEqual(
        unusable({ kind: 'invalid_date', path: at('timing_hint'), value }),
      );
    },
  );

  it.each([
    ['2026-11-25', null],
    ['2026-11-24', '2026-11-24'],
    ['2026-11-23', '2026-11-23'],
  ])(
    '[CL-DET-02] [CL-DET-06] reads the timing hint %s of an article of 2026-11-24 as %s',
    (hint, read) => {
      expect(check(withFact({ timingHint: hint }))).toStrictEqual(
        usable({ ...CHECKED, timingHintOn: read }),
      );
    },
  );

  it.each([
    [
      fault('missing_key', at('justification')),
      withLists({ validatedTypeFacts: [without(FACT, 'justification')] }),
    ],
    [
      fault('missing_key', at('context', 'game_stakes')),
      withFact({ context: { injuryReturn: 'no' } }),
    ],
    [fault('missing_key', [...PART_PATH, 'calendar_facts']), withParts(PART_WITHOUT_CALENDAR)],
    [
      fault('missing_key', listAt('new_type_facts', 'suggested_definition')),
      withLists({ newTypeFacts: [without(NEW_TYPE, 'suggestedDefinition')] }),
    ],
    [fault('missing_key', ['results']), answerText({ answers: [] })],
    [fault('unexpected_key', at('entry_id')), withFact({ entryId: 'trade-rumor' })],
    [fault('unexpected_key', [...PART_PATH, 'team_facts']), withLists({ teamFacts: [] })],
    [fault('unexpected_key', ['results', 0, 'notes']), answer({ ...EMPTY_RESULT, notes: '' })],
    [fault('unexpected_key', ['comment']), answerText({ results: [], comment: 'Done.' })],
    [fault('wrong_type', at('event_type')), withFact({ eventType: 7 })],
    [fault('wrong_type', at('detection_confidence')), withFact({ detectionConfidence: '86' })],
    [fault('wrong_type', at('description')), withFact({ description: null })],
    [fault('wrong_type', at('novelty')), withFact({ novelty: 3 })],
    [fault('wrong_type', at('player_event_id')), knownEvent(501)],
    [fault('wrong_type', at('timing_hint')), withFact({ timingHint: 20_261_122 })],
    [fault('wrong_type', at('context')), withFact({ context: 'unknown' })],
    [fault('wrong_type', at()), withLists({ validatedTypeFacts: ['A coach doubts him.'] })],
    [
      fault('wrong_type', [...PART_PATH, 'validated_type_facts']),
      withLists({ validatedTypeFacts: {} }),
    ],
    [
      fault('wrong_type', listAt('known_entry_facts', 'entry_id')),
      withLists({ knownEntryFacts: [{ ...KNOWN_ENTRY, entryId: 17 }] }),
    ],
    [
      fault('wrong_type', listAt('new_type_facts', 'suggested_name')),
      withNewType({ suggestedName: ['Snub'] }),
    ],
    [fault('wrong_type', ['results', 0, 'players']), answer(result('1024', {}))],
    [fault('wrong_type', ['results']), answerText({ results: {} })],
    [fault('empty_text', at('description')), withFact({ description: '  ' })],
    [
      fault('empty_text', listAt('new_type_facts', 'suggested_definition')),
      withNewType({ suggestedDefinition: '' }),
    ],
  ])('[CL-DET-02] makes a part unusable for a fault of the schema: %j', (reason, text) => {
    expect(check(text)).toStrictEqual(unusable(reason));
  });

  it('[CL-DET-02] makes every part of a submitted article without its one result unusable', () => {
    const first = result('1024', [part({ validatedTypeFacts: [FACT] })]);
    const second = result('1025', [EMPTY_PART]);
    const unsent = answer(result('9999', [EMPTY_PART]), null, 'Classified.');

    expect(check(answer(first), BATCH)).toStrictEqual([
      ...usable(CHECKED),
      ...secondUnusable({ kind: 'no_result' }),
    ]);
    expect(check(unsent, BATCH).slice(1)).toStrictEqual(secondUnusable({ kind: 'no_result' }));
    expect(check(answer(first, second, second), BATCH).slice(1)).toStrictEqual(
      secondUnusable({ kind: 'several_results' }),
    );
  });

  it('[DET-16] makes a player without his one part unusable, naming a player not sent instead', () => {
    const missing = ofSecond(PLAYER_B, unusableOf({ kind: 'missing_part' }));
    const partB = part({}, PLAYER_B);

    expect(outcome(EMPTY_PART)).toStrictEqual([ofSecond(PLAYER_A, NO_FACT), missing]);
    expect(outcome(EMPTY_PART, part({}, 'c0ffee'))).toStrictEqual([
      ofSecond(PLAYER_A, NO_FACT),
      ofSecond(PLAYER_B, unusableOf({ kind: 'unknown_player', playerId: 'c0ffee' })),
    ]);
    expect(outcome(EMPTY_PART, part({}, 7), null)).toStrictEqual([
      ofSecond(PLAYER_A, NO_FACT),
      missing,
    ]);
    expect(outcome(EMPTY_PART, EMPTY_PART, partB)).toStrictEqual([
      ofSecond(PLAYER_A, unusableOf({ kind: 'several_parts' })),
      ofSecond(PLAYER_B, NO_FACT),
    ]);
  });

  it('[CL-DET-02] reads an answer with prose or code fences around its JSON', () => {
    expect(check(textOf(proseAround))).toStrictEqual(usable(CHECKED));
    expect(check(textOf(codeFences))).toStrictEqual(usable(CHECKED));
  });

  it('[CL-DET-02] makes every part unusable for a truncated answer or no JSON, without throwing', () => {
    expect(check(textOf(truncated), BATCH)).toStrictEqual(all('cut'));
    expect(check('I cannot classify this article.', BATCH)).toStrictEqual(all('no_result_found'));
    expect(check('{"results": [}', BATCH)).toStrictEqual(all('syntax_error'));
  });

  it('[CL-DET-02] makes a part unusable for a value of the wrong type, without throwing', () => {
    expect(check(textOf(wrongTypes))).toStrictEqual(
      unusable({ kind: 'wrong_type', path: at('detection_confidence') }),
    );
  });
});

const MAX = 30;
const UNIT = fc.constantFrom('a', 'e', 'é', 'z', ' ', "'", '’');
const text = (minLength: number, maxLength: number): fc.Arbitrary<string> =>
  fc.string({ unit: UNIT, minLength, maxLength, size: 'max' });
// Texts that start and end with a letter: of 2 to MAX code points, or longer than MAX.
const PASSING = text(0, MAX - 2).map((inner) => `A${inner}z`);
const TOO_LONG = text(MAX - 1, 2 * MAX).map((inner) => `A${inner}z`);
// A text of at most MAX code points that holds a quotation mark of CL-DSN-03.
const QUOTE = fc.constantFrom('"', '«', '»', '“', '”', '„', '‟');
const HALF = text(0, MAX / 2 - 2);
const QUOTED = fc
  .tuple(HALF, QUOTE, HALF)
  .map(([before, quote, after]) => `A${before}${quote}${after}z`);

// An answer whose every text is `value`, and the part it gives.
const allTexts = (value: string): string =>
  withLists({
    validatedTypeFacts: [{ ...FACT, description: value, justification: value }],
    knownEntryFacts: [{ ...KNOWN_ENTRY, justification: value }],
    newTypeFacts: [{ suggestedName: value, suggestedDefinition: value, justification: value }],
  });
const checkedTexts = (description: unknown, other: unknown): readonly unknown[] =>
  usable(
    { ...CHECKED, description, justification: other },
    { kind: 'known_entry', eventTypeId: 'trade-rumor', justification: other },
    {
      kind: 'new_type',
      suggestedTypeName: other,
      suggestedTypeDefinition: other,
      justification: other,
    },
  );
const checkTexts = (value: string): readonly CheckedPart[] =>
  checkAnswer(allTexts(value), REQUEST, { maxDescriptionLength: MAX });

describe('checkAnswer, text checks', () => {
  it('[DET-21] [DSN-25] keeps every text within the maximum without a quotation mark, apostrophes included', () => {
    fc.assert(
      fc.property(PASSING, (value) => {
        const kept = { kept: true, text: value };
        expect(checkTexts(value)).toStrictEqual(checkedTexts(kept, kept));
      }),
    );
    const apostrophes = "The coach's remark about l’équipe";
    const kept = { kept: true, text: apostrophes };
    expect(check(allTexts(apostrophes))).toStrictEqual(checkedTexts(kept, kept));
  });

  it('[DET-21] [DSN-25] marks a failing description for review and keeps no other failing text, the part staying usable', () => {
    const expected = checkedTexts({ kept: false, mark: 'description_to_review' }, { kept: false });
    fc.assert(
      fc.property(fc.oneof(TOO_LONG, QUOTED), (value) => {
        expect(checkTexts(value)).toStrictEqual(expected);
      }),
    );
  });
});
