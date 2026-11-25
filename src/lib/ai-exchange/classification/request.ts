// The request of a classification call (DET-12, DET-14, detection.md section 5.1). Its
// static part comes first: the instructions version, the validated sheets, the
// do-not-repropose list and the calendar-handled types, each sorted by identifier, so
// that it is byte for byte identical from one call to the next and the provider's prompt
// cache applies (detection-model service sheet, rule 4). The articles follow. Nothing
// else is sent: no team, no source of an event, nothing about the owner (DSN-05).
import { coverageThresholdSentence } from '../research-prompt/template';
import { INSTRUCTIONS_VERSION } from './instructions';

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const MS_PER_HOUR = 3_600_000;
// A day written without a time lasts until its end at the westernmost offset, −12:00,
// twelve hours after its end in UTC (COL-21, CL-COL-02, CL-DET-26).
const WESTERNMOST_OFFSET_MS = 43_200_000;
// The lengths of `YYYY-MM-DDTHH:MM:SS` and of `YYYY-MM-DD` at the start of an ISO string.
const DATE_TIME_LENGTH = 19;
const DATE_LENGTH = 10;
// The providers' tokenizers average about four characters a token on English and French
// text and the JSON around it: dividing by less gives an upper estimate.
const CHARACTERS_PER_TOKEN = 3.5;
// A capital letter of a key, written `_` and the lowercase letter in the request.
const CAPITAL = /[A-Z]/gu;

/**
 * The current version of a validated type's sheet, which the request sends whole (TAX-33):
 * `coverageThreshold` is the sheet's own, when it has one (CL-TAX-14), and
 * `isCalendarDerived` marks the types that the calendar derives, which the request leaves
 * out of the validated types (ADR 0015).
 */
export type ClassificationTypeSheet = Readonly<{
  id: string;
  name: string;
  definition: string;
  inclusionCriteria: string;
  exclusionCriteria: string;
  datingRule: string;
  knownInAdvance: boolean;
  isCalendarDerived: boolean;
  coverageThreshold: Readonly<{ outlets: number; days: number }> | null;
  genericExample: string;
}>;

/**
 * An entry of the do-not-repropose list (TAX-18, CL-TAX-10) or of the calendar-handled
 * types (CL-DET-22), which the request reduces to its name and its definition.
 */
export type ClassificationListEntry = Readonly<{ id: string; name: string; definition: string }>;

/**
 * The reference date of an event (DET-30): an instant with the offset east of UTC that
 * the caller computed for it, null when it has none, or the calendar date `YYYY-MM-DD`
 * of a historical event dated without a time.
 */
export type ClassificationEventReference =
  | Readonly<{ kind: 'instant'; at: number; offsetMinutes: number | null }>
  | Readonly<{ kind: 'day'; on: string }>;

/** An event of a recognized player, which the request sends when CL-DET-11 says so. */
export type ClassificationEventInput = Readonly<{
  id: string;
  eventType: string;
  origin: 'detected' | 'historical' | 'calendar';
  detectedStatus: 'detected' | 'dismissed' | null;
  referenceDate: ClassificationEventReference;
  description: string;
}>;

/** A recognized player of an article, with his names and his events (DET-02, DET-14). */
export type ClassificationPlayerInput = Readonly<{
  id: string;
  displayName: string;
  variants: readonly string[];
  events: readonly ClassificationEventInput[];
}>;

/**
 * An article to classify (DET-14): its retained publication instant, the offset east of
 * UTC of its outlet's time zone at that instant as the caller computed it, null when the
 * zone is unknown, and the instant's precision (CL-DET-06).
 */
export type ClassificationArticleInput = Readonly<{
  id: string;
  title: string;
  excerpt: string | null;
  outletName: string;
  retainedPublishedAt: number;
  outletOffsetMinutes: number | null;
  retainedPublishedAtPrecision: 'exact' | 'approximate' | 'none';
  players: readonly ClassificationPlayerInput[];
}>;

/**
 * What a classification request is built from: the validated sheets, the do-not-repropose
 * list, the calendar-handled types (`taxonomy.handledByCalendarList`), the articles of the
 * call, one or several (DET-12), and `detection.groupingWindowHours` (DET-29).
 */
export type ClassificationRequestInput = Readonly<{
  validatedTypes: readonly ClassificationTypeSheet[];
  doNotRepropose: readonly ClassificationListEntry[];
  calendarHandledTypes: readonly ClassificationListEntry[];
  articles: readonly ClassificationArticleInput[];
  groupingWindowHours: number;
}>;

/** A validated type as the request sends it (TAX-33, CL-TAX-14). */
export type ClassificationRequestTypeSheet = Readonly<{
  id: string;
  name: string;
  definition: string;
  inclusionCriteria: string;
  exclusionCriteria: string;
  datingRule: string;
  knownInAdvance: boolean;
  genericExample: string;
}>;

/** An event as the request sends it, its reference date written (DET-14, DET-28). */
export type ClassificationRequestEvent = Readonly<{
  playerEventId: string;
  eventType: string;
  referenceDate: string;
  description: string;
}>;

/** A recognized player as the request sends him, display name first (DET-14). */
export type ClassificationRequestPlayer = Readonly<{
  playerId: string;
  names: readonly string[];
  events: readonly ClassificationRequestEvent[];
}>;

/** An article as the request sends it, its instant written (DET-14, CL-DET-06). */
export type ClassificationRequestArticle = Readonly<{
  articleId: string;
  title: string;
  excerpt: string | null;
  outlet: string;
  publishedAt: string;
  publishedPrecision: 'exact' | 'approximate' | 'none';
  players: readonly ClassificationRequestPlayer[];
}>;

/**
 * A classification request, its members in the order of detection.md section 5.1, the
 * static part first; `classificationRequestText` writes it with that section's keys.
 */
export type ClassificationRequest = Readonly<{
  instructionsVersion: string;
  validatedTypes: readonly ClassificationRequestTypeSheet[];
  doNotRepropose: readonly ClassificationListEntry[];
  calendarTypes: readonly ClassificationListEntry[];
  articles: readonly ClassificationRequestArticle[];
}>;

/** `items` in the order of their identifiers. */
function byId<Item extends Readonly<{ id: string }>>(items: readonly Item[]): readonly Item[] {
  return items.toSorted((left, right) => left.id.localeCompare(right.id, 'en'));
}

/** A whole number from 0 to 99 in two digits. */
function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/** An offset east of UTC, in minutes, written `±HH:MM`. */
function offsetText(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const minutes = Math.abs(offsetMinutes);
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  return `${sign}${twoDigits(hours)}:${twoDigits(minutes % MINUTES_PER_HOUR)}`;
}

/** An instant in ISO 8601 at its offset, `+00:00` when it has none (CL-DET-06). */
function instantText(at: number, offsetMinutes: number | null): string {
  const offset = offsetMinutes ?? 0;
  const wallClock = new Date(at + offset * MS_PER_MINUTE).toISOString();
  return `${wallClock.slice(0, DATE_TIME_LENGTH)}${offsetText(offset)}`;
}

/** The dating rule, then the coverage-threshold sentence of a sheet that has one (CL-TAX-14). */
function datingRuleOf(sheet: ClassificationTypeSheet): string {
  const threshold = sheet.coverageThreshold;
  return threshold === null
    ? sheet.datingRule
    : `${sheet.datingRule} ${coverageThresholdSentence(threshold.outlets, threshold.days)}`;
}

/** A validated sheet, whole (TAX-33). */
function sheetOf(sheet: ClassificationTypeSheet): ClassificationRequestTypeSheet {
  return {
    id: sheet.id,
    name: sheet.name,
    definition: sheet.definition,
    inclusionCriteria: sheet.inclusionCriteria,
    exclusionCriteria: sheet.exclusionCriteria,
    datingRule: datingRuleOf(sheet),
    knownInAdvance: sheet.knownInAdvance,
    genericExample: sheet.genericExample,
  };
}

/** A list entry, reduced to its name and its definition (CL-TAX-10, CL-DET-22). */
function entryOf(entry: ClassificationListEntry): ClassificationListEntry {
  return { id: entry.id, name: entry.name, definition: entry.definition };
}

/**
 * The earliest day whose end at −12:00, the latest instant that a day written without a
 * time can stand for, lies at or after `cutoff`.
 */
function earliestDayFrom(cutoff: number): string {
  return new Date(cutoff - WESTERNMOST_OFFSET_MS).toISOString().slice(0, DATE_LENGTH);
}

/** Whether a reference date lies at or after `cutoff`, a day when it may (COL-21). */
function isAtOrAfter(reference: ClassificationEventReference, cutoff: number): boolean {
  return reference.kind === 'instant'
    ? reference.at >= cutoff
    : reference.on >= earliestDayFrom(cutoff);
}

/**
 * Whether the request sends an event (CL-DET-11): never a calendar-derived one, a
 * dismissed one whatever its age, any other from `cutoff` on, with no upper bound.
 */
function isSent(event: ClassificationEventInput, cutoff: number): boolean {
  return (
    event.origin !== 'calendar' &&
    (event.detectedStatus === 'dismissed' || isAtOrAfter(event.referenceDate, cutoff))
  );
}

/** An event as sent, its reference date written as a day or an instant (DET-14). */
function eventOf(event: ClassificationEventInput): ClassificationRequestEvent {
  const reference = event.referenceDate;
  return {
    playerEventId: event.id,
    eventType: event.eventType,
    referenceDate:
      reference.kind === 'day' ? reference.on : instantText(reference.at, reference.offsetMinutes),
    description: event.description,
  };
}

/** A recognized player with his names and the events sent from `cutoff` (CL-DET-11). */
function playerOf(player: ClassificationPlayerInput, cutoff: number): ClassificationRequestPlayer {
  return {
    playerId: player.id,
    names: [player.displayName, ...player.variants],
    events: byId(player.events.filter((event) => isSent(event, cutoff))).map((event) =>
      eventOf(event),
    ),
  };
}

/** An article with its players, the grouping window counted back from its instant (DET-29). */
function articleOf(
  article: ClassificationArticleInput,
  groupingWindowHours: number,
): ClassificationRequestArticle {
  const cutoff = article.retainedPublishedAt - groupingWindowHours * MS_PER_HOUR;
  return {
    articleId: article.id,
    title: article.title,
    excerpt: article.excerpt,
    outlet: article.outletName,
    publishedAt: instantText(article.retainedPublishedAt, article.outletOffsetMinutes),
    publishedPrecision: article.retainedPublishedAtPrecision,
    players: byId(article.players).map((player) => playerOf(player, cutoff)),
  };
}

/**
 * Builds the request of a classification call (DET-12, DET-14, DSN-05): the instructions
 * version (DET-23); the validated sheets in full, the calendar-derived ones left out
 * (TAX-33, ADR 0015); the do-not-repropose list (TAX-18, CL-TAX-10) and the
 * calendar-handled types (CL-DET-22), by name and definition; then each article with its
 * title, excerpt, outlet and retained instant at its outlet's offset with its precision
 * (CL-DET-06), and each recognized player with his names, display name first, and his
 * events that CL-DET-11 sends. Every list is sorted by identifier, so that the static
 * part does not depend on the order of the inputs.
 */
export function buildClassificationRequest(
  input: ClassificationRequestInput,
): ClassificationRequest {
  const validatedTypes = input.validatedTypes.filter((sheet) => !sheet.isCalendarDerived);
  return {
    instructionsVersion: INSTRUCTIONS_VERSION,
    validatedTypes: byId(validatedTypes).map((sheet) => sheetOf(sheet)),
    doNotRepropose: byId(input.doNotRepropose).map((entry) => entryOf(entry)),
    calendarTypes: byId(input.calendarHandledTypes).map((entry) => entryOf(entry)),
    articles: byId(input.articles).map((article) => articleOf(article, input.groupingWindowHours)),
  };
}

/** A member of the request with its keys written in snake case, `inclusion_criteria`. */
function withSnakeCaseKeys(_key: string, value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value;
  }
  const members = Object.entries(value).map(
    ([key, member]: [string, unknown]): [string, unknown] => [
      key.replaceAll(CAPITAL, (capital) => `_${capital.toLowerCase()}`),
      member,
    ],
  );
  return Object.fromEntries(members);
}

/**
 * The request as the call sends it (detection.md section 5.1): JSON with snake-case
 * keys, its static part first, byte for byte the same for two requests that differ only
 * in their articles (detection-model service sheet, rule 4).
 */
export function classificationRequestText(request: ClassificationRequest): string {
  return JSON.stringify(request, withSnakeCaseKeys);
}

/**
 * An upper estimate of the tokens that the texts of one classification call take, its
 * instructions, its request text and its answer schema, so that the caller keeps a
 * request under a provider's ceiling once the maximum output is added (detection-model
 * service sheet, rule 5).
 */
export function estimateRequestTokens(texts: readonly string[]): number {
  const characters = texts.reduce((total, text) => total + text.length, 0);
  return Math.ceil(characters / CHARACTERS_PER_TOKEN);
}
