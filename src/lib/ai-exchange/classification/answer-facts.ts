// The checks of one part of a classification answer, the facts that a result reports for
// one recognized player (detection.md section 5.2, CL-DET-02): each list of the part, one
// per fact kind, and each fact against what the request sent for that article and player.
// The first fault makes the part unusable; a text that fails DSN-24 does not (DET-21).
import { parseExchangeDate } from '../conventions';
import { GAME_STAKES, INJURY_RETURNS } from '../research-result/format';
import {
  accept,
  merged,
  readClosed,
  readDescription,
  readList,
  readNullableString,
  readObject,
  readSentId,
  readString,
  readText,
  refuse,
} from './answer-fields';
import {
  CALENDAR_FACT_KEYS,
  CONTEXT_KEYS,
  FACT_NOVELTIES,
  KNOWN_ENTRY_FACT_KEYS,
  NEW_TYPE_FACT_KEYS,
  PART_KEYS,
  VALIDATED_TYPE_FACT_KEYS,
} from './schema';

import type { GameStakes, InjuryReturn } from '../research-result/format';
import type { Checked, CheckedDescription, CheckedText, Field, Fields } from './answer-fields';
import type {
  ClassificationRequest,
  ClassificationRequestArticle,
  ClassificationRequestPlayer,
} from './request';
import type { FactNovelty } from './schema';

const MIN_CONFIDENCE = 0;
const MAX_CONFIDENCE = 100;

/** The context indications of a fact for the player's next game (DET-16, SEN-13, SEN-14). */
export type CheckedContext = Readonly<{ injuryReturn: InjuryReturn; gameStakes: GameStakes }>;

/**
 * A fact of a validated type (DET-16): its confidence rounded half up, its timing hint the
 * day `YYYY-MM-DD` or null, null too for a day after the article's own (CL-DET-06).
 */
export type CheckedValidatedTypeFact = Readonly<{
  kind: 'validated_type';
  eventTypeId: string;
  detectionConfidence: number;
  description: CheckedDescription;
  novelty: FactNovelty;
  playerEventId: string | null;
  timingHintOn: string | null;
  context: CheckedContext;
  justification: CheckedText;
}>;

/** A fact matching a do-not-repropose entry, the entry's identifier in `eventTypeId` (DET-34). */
export type CheckedKnownEntryFact = Readonly<{
  kind: 'known_entry';
  eventTypeId: string;
  justification: CheckedText;
}>;

/** A fact of no validated type, with the type it suggests (DET-34, CL-DET-19). */
export type CheckedNewTypeFact = Readonly<{
  kind: 'new_type';
  suggestedTypeName: CheckedText;
  suggestedTypeDefinition: CheckedText;
  justification: CheckedText;
}>;

/** A fact that the caller stores, of one of the three kinds (glossary `FactKind`). */
export type CheckedFact = CheckedValidatedTypeFact | CheckedKnownEntryFact | CheckedNewTypeFact;

/**
 * What the checks of one part read: the request, the article and player of the part, and
 * the description maximum, `events.maxDescriptionLength` (DSN-20).
 */
export type PartScope = Readonly<{
  request: ClassificationRequest;
  article: ClassificationRequestArticle;
  player: ClassificationRequestPlayer;
  maxLength: number;
}>;

type FactFields = Fields<(typeof VALIDATED_TYPE_FACT_KEYS)[number]>;
type FactPart<Key extends keyof CheckedValidatedTypeFact> = Checked<
  Pick<CheckedValidatedTypeFact, Key>
>;

function idsOf(entries: readonly Readonly<{ id: string }>[]): readonly string[] {
  return entries.map((entry) => entry.id);
}

/** A validated type sent, any other type of the request being not validated (DET-15). */
function readEventType(field: Field, request: ClassificationRequest): Checked<string> {
  const read = readString(field);
  if (!read.ok || idsOf(request.validatedTypes).includes(read.value)) {
    return read;
  }
  const others = idsOf([...request.doNotRepropose, ...request.calendarTypes]);
  const kind = others.includes(read.value) ? 'type_not_validated' : 'unknown_identifier';
  return refuse({ kind, path: field.path, value: read.value });
}

/** A confidence from 0 to 100, rounded half up (CL-DET-02). */
function readConfidence(field: Field): Checked<number> {
  const { value, path } = field;
  if (typeof value !== 'number') {
    return refuse({ kind: 'wrong_type', path });
  }
  return value < MIN_CONFIDENCE || value > MAX_CONFIDENCE
    ? refuse({ kind: 'confidence_out_of_range', path, value })
    : accept(Math.round(value));
}

function readType(
  field: FactFields,
  request: ClassificationRequest,
): FactPart<'eventTypeId' | 'detectionConfidence'> {
  const eventTypeId = readEventType(field('event_type'), request);
  if (!eventTypeId.ok) {
    return eventTypeId;
  }
  const detectionConfidence = readConfidence(field('detection_confidence'));
  return detectionConfidence.ok
    ? accept({ eventTypeId: eventTypeId.value, detectionConfidence: detectionConfidence.value })
    : detectionConfidence;
}

/** The novelty, and the event it designates exactly when it is `known_event` (DET-28). */
function readNovelty(
  field: FactFields,
  player: ClassificationRequestPlayer,
): FactPart<'novelty' | 'playerEventId'> {
  const novelty = readClosed(field('novelty'), FACT_NOVELTIES);
  if (!novelty.ok) {
    return novelty;
  }
  const eventField = field('player_event_id');
  const eventId = readNullableString(eventField);
  if (!eventId.ok) {
    return eventId;
  }
  if ((novelty.value === 'known_event') !== (eventId.value !== null)) {
    return refuse({ kind: 'novelty_mismatch', path: eventField.path });
  }
  const events = player.events.map((event) => event.playerEventId);
  const sent = eventId.value === null ? eventId : readSentId(eventField, events);
  return sent.ok ? accept({ novelty: novelty.value, playerEventId: eventId.value }) : sent;
}

/** The timing hint, none when it names a day after the article's own (CL-DET-02, CL-DET-06). */
function readTimingHint(
  field: Field,
  article: ClassificationRequestArticle,
): Checked<string | null> {
  const read = readNullableString(field);
  if (!read.ok || read.value === null) {
    return read;
  }
  const date = parseExchangeDate(read.value);
  if (!date.ok || date.date.kind !== 'date') {
    return refuse({ kind: 'invalid_date', path: field.path, value: read.value });
  }
  // A day `YYYY-MM-DD` sorts after the instant that the article's date starts exactly when
  // it is a later day: on the same day, it is the shorter of the two texts.
  return accept(read.value > article.publishedAt ? null : read.value);
}

/** The context indications, with the closed values of the research format (DET-16). */
function readContext(field: Field): Checked<CheckedContext> {
  const fields = readObject(field, CONTEXT_KEYS);
  if (!fields.ok) {
    return fields;
  }
  const injuryReturn = readClosed(fields.value('injury_return'), INJURY_RETURNS);
  if (!injuryReturn.ok) {
    return injuryReturn;
  }
  const gameStakes = readClosed(fields.value('game_stakes'), GAME_STAKES);
  return gameStakes.ok
    ? accept({ injuryReturn: injuryReturn.value, gameStakes: gameStakes.value })
    : gameStakes;
}

function readCircumstances(
  field: FactFields,
  article: ClassificationRequestArticle,
): FactPart<'timingHintOn' | 'context'> {
  const timingHintOn = readTimingHint(field('timing_hint'), article);
  if (!timingHintOn.ok) {
    return timingHintOn;
  }
  const context = readContext(field('context'));
  return context.ok
    ? accept({ timingHintOn: timingHintOn.value, context: context.value })
    : context;
}

function readFactTexts(
  field: FactFields,
  maxLength: number,
): FactPart<'description' | 'justification'> {
  const description = readDescription(field('description'), maxLength);
  if (!description.ok) {
    return description;
  }
  const justification = readText(field('justification'), maxLength);
  return justification.ok
    ? accept({ description: description.value, justification: justification.value })
    : justification;
}

/** A validated-type fact, its members read in the order of the schema (DET-16). */
function checkValidatedTypeFact(item: Field, scope: PartScope): Checked<CheckedFact> {
  const fields = readObject(item, VALIDATED_TYPE_FACT_KEYS);
  if (!fields.ok) {
    return fields;
  }
  const field = fields.value;
  const fact = merged(
    merged(readType(field, scope.request), readNovelty(field, scope.player)),
    merged(readCircumstances(field, scope.article), readFactTexts(field, scope.maxLength)),
  );
  if (!fact.ok) {
    return fact;
  }
  const checked: CheckedFact = { kind: 'validated_type', ...fact.value };
  return accept(checked);
}

/** A known-entry fact, naming an entry of the do-not-repropose list sent (DET-34). */
function checkKnownEntryFact(item: Field, scope: PartScope): Checked<CheckedFact> {
  const fields = readObject(item, KNOWN_ENTRY_FACT_KEYS);
  if (!fields.ok) {
    return fields;
  }
  const entry = readSentId(fields.value('entry_id'), idsOf(scope.request.doNotRepropose));
  if (!entry.ok) {
    return entry;
  }
  const justification = readText(fields.value('justification'), scope.maxLength);
  if (!justification.ok) {
    return justification;
  }
  const checked: CheckedFact = {
    kind: 'known_entry',
    eventTypeId: entry.value,
    justification: justification.value,
  };
  return accept(checked);
}

/** A new-type fact, with its suggested name and definition (DET-34, CL-DET-19). */
function checkNewTypeFact(item: Field, scope: PartScope): Checked<CheckedFact> {
  const fields = readObject(item, NEW_TYPE_FACT_KEYS);
  if (!fields.ok) {
    return fields;
  }
  const name = readText(fields.value('suggested_name'), scope.maxLength);
  if (!name.ok) {
    return name;
  }
  const definition = readText(fields.value('suggested_definition'), scope.maxLength);
  if (!definition.ok) {
    return definition;
  }
  const justification = readText(fields.value('justification'), scope.maxLength);
  if (!justification.ok) {
    return justification;
  }
  const checked: CheckedFact = {
    kind: 'new_type',
    suggestedTypeName: name.value,
    suggestedTypeDefinition: definition.value,
    justification: justification.value,
  };
  return accept(checked);
}

/** A calendar fact, checked and then dropped (CL-DET-22): it gives no fact. */
function checkCalendarFact(item: Field, scope: PartScope): Checked<readonly CheckedFact[]> {
  const fields = readObject(item, CALENDAR_FACT_KEYS);
  if (!fields.ok) {
    return fields;
  }
  const entry = readSentId(fields.value('calendar_type'), idsOf(scope.request.calendarTypes));
  return entry.ok ? accept([]) : entry;
}

/** The facts of one list of a part, or the first fault among them. */
function checkFacts(
  field: Field,
  scope: PartScope,
  check: (item: Field, scope: PartScope) => Checked<CheckedFact | readonly CheckedFact[]>,
): Checked<readonly CheckedFact[]> {
  const items = readList(field);
  if (!items.ok) {
    return items;
  }
  const facts: CheckedFact[] = [];
  for (const item of items.value) {
    const fact = check(item, scope);
    if (!fact.ok) {
      return fact;
    }
    facts.push(...[fact.value].flat());
  }
  return accept(facts);
}

/**
 * The facts of a part, in the order of its lists, validated-type, known-entry and new-type
 * facts, its calendar facts checked and dropped (DET-15, DET-16, DET-34, CL-DET-02,
 * CL-DET-22), or the first fault that makes the part unusable.
 */
export function checkPart(item: Field, scope: PartScope): Checked<readonly CheckedFact[]> {
  const fields = readObject(item, PART_KEYS);
  if (!fields.ok) {
    return fields;
  }
  const lists = [
    checkFacts(fields.value('validated_type_facts'), scope, checkValidatedTypeFact),
    checkFacts(fields.value('known_entry_facts'), scope, checkKnownEntryFact),
    checkFacts(fields.value('new_type_facts'), scope, checkNewTypeFact),
    checkFacts(fields.value('calendar_facts'), scope, checkCalendarFact),
  ];
  const facts: CheckedFact[] = [];
  for (const list of lists) {
    if (!list.ok) {
      return list;
    }
    facts.push(...list.value);
  }
  return accept(facts);
}
