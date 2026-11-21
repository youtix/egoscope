// The research prompt of a backtest request (BKT-20 to BKT-22): the template of
// template.ts with every placeholder filled from the request's data, and its type block
// written once per requested type. The request operations only gather that data.
import { FORMAT_VERSION } from '../research-result/format';
import {
  coverageThresholdSentence,
  NOT_PROVIDED,
  periodText,
  playerMarker,
  RESEARCH_PROMPT_TEMPLATE,
  withKnownInAdvanceMark,
} from './template';

/**
 * The period of a request or of one of its types, both days included (BKT-08, BKT-09):
 * its days written `YYYY-MM-DD`, as the request holds them, `startOn` being null when
 * the period starts at the player's first NBA game while its date is unknown (STA-47).
 */
export type PromptPeriod = Readonly<{ startOn: string | null; endOn: string }>;

/**
 * The current content of a requested type's sheet, which the prompt sends whole (TAX-33,
 * CL-TAX-06): an element left empty reads "not provided" (BKT-22). `coverageThreshold`
 * is the sheet's own, when it has one (CL-TAX-14); `isCalendarDerived` marks the types
 * that the calendar derives, which no prompt holds (CL-BKT-03).
 */
export type PromptTypeSheet = Readonly<{
  id: string;
  name: string;
  definition: string | null;
  inclusionCriteria: string | null;
  exclusionCriteria: string | null;
  datingRule: string | null;
  knownInAdvance: boolean;
  isCalendarDerived: boolean;
  coverageThreshold: Readonly<{ outlets: number; days: number }> | null;
  genericExample: string | null;
}>;

/** A requested type: its sheet and the period requested for it (BKT-09). */
export type PromptRequestedType = Readonly<{ sheet: PromptTypeSheet; period: PromptPeriod }>;

/**
 * What the prompt of a backtest request is built from (BKT-12, BKT-20, BKT-22): `today`
 * is the day the prompt is produced, `YYYY-MM-DD` (CL-BKT-10); `overallPeriod` is the
 * request's, from the earliest start to the latest end of its types; `maxTextLength` is the
 * maximum description length (DSN-20) and `maxSources` the maximum number of sources
 * per event (H-BKT-09), both from the parameters.
 */
export type ResearchPromptInput = Readonly<{
  reference: string;
  today: string;
  player: Readonly<{ id: string; displayName: string; firstNbaGameOn: string | null }>;
  overallPeriod: PromptPeriod;
  requestedTypes: readonly PromptRequestedType[];
  maxTextLength: number;
  maxSources: number;
}>;

/**
 * Why no prompt was built: requested types derived from the calendar, which no prompt
 * holds, named in the alphabetical order of their identifiers (CL-BKT-03).
 */
export type BuildPromptError = Readonly<{
  kind: 'calendar_derived_type';
  eventTypeIds: readonly string[];
}>;

/** The research prompt with every placeholder filled, or why none was built. */
export type BuildPromptResult =
  Readonly<{ ok: true; prompt: string }> | Readonly<{ ok: false; error: BuildPromptError }>;

// The placeholders of the template (glossary section 6.1): those of the request, and
// those of the type block.
type RequestPlaceholder =
  | 'REFERENCE'
  | 'TODAY'
  | 'PLAYER_NAME'
  | 'PLAYER_ID'
  | 'PLAYER_MARKER'
  | 'PERIOD'
  | 'MAX_TEXT_LENGTH'
  | 'MAX_SOURCES'
  | 'TYPE_LIST'
  | 'FORMAT_VERSION';
type TypePlaceholder =
  | 'TYPE_ID'
  | 'TYPE_NAME'
  | 'TYPE_PERIOD'
  | 'TYPE_DEFINITION'
  | 'TYPE_INCLUSION'
  | 'TYPE_EXCLUSION'
  | 'TYPE_DATING_RULE'
  | 'TYPE_EXAMPLE';

// A placeholder of the template, {{NAME}}.
const PLACEHOLDER = /\{\{(?<name>[A-Z_]+)\}\}/gu;

// The bounds of the type block, which the prompt does not keep (BKT-22).
const BLOCK_START = '{{TYPE_BLOCK_START}}\n';
const BLOCK_END = '\n{{TYPE_BLOCK_END}}';
// Two blocks are parted by a blank line.
const BLOCK_SEPARATOR = '\n\n';

type TemplateParts = Readonly<{ head: string; block: string; tail: string }>;

/** The template before its type block, the block without its bounds, and the rest. */
function partsOf(template: string): TemplateParts {
  const start = template.indexOf(BLOCK_START);
  const end = template.indexOf(BLOCK_END);
  return {
    head: template.slice(0, start),
    block: template.slice(start + BLOCK_START.length, end),
    tail: template.slice(end + BLOCK_END.length),
  };
}

const PARTS = partsOf(RESEARCH_PROMPT_TEMPLATE);

/**
 * `part` with each of its placeholders replaced by its value, every one of which
 * `values` holds, in one pass, so that a text put in is never read again.
 */
function fill<Name extends string>(part: string, values: Readonly<Record<Name, string>>): string {
  return part.replaceAll(PLACEHOLDER, (_placeholder: string, name: Name) => values[name]);
}

/** A sheet element as the prompt writes it: trimmed, or "not provided" when empty (BKT-22). */
function element(text: string | null): string {
  const content = text?.trim() ?? '';
  return content === '' ? NOT_PROVIDED : content;
}

/** The dating rule with its "known in advance" mark, then its threshold (TAX-33, CL-TAX-14). */
function datingRuleOf(sheet: PromptTypeSheet): string {
  const rule = element(sheet.datingRule);
  const marked = sheet.knownInAdvance ? withKnownInAdvanceMark(rule) : rule;
  const threshold = sheet.coverageThreshold;
  return threshold === null
    ? marked
    : `${marked} ${coverageThresholdSentence(threshold.outlets, threshold.days)}`;
}

/** The values of the type block for one requested type, its whole sheet (BKT-22, TAX-33). */
function typeValues(type: PromptRequestedType): Readonly<Record<TypePlaceholder, string>> {
  const { sheet, period } = type;
  return {
    TYPE_ID: sheet.id,
    TYPE_NAME: element(sheet.name),
    TYPE_PERIOD: periodText(period.startOn, period.endOn),
    TYPE_DEFINITION: element(sheet.definition),
    TYPE_INCLUSION: element(sheet.inclusionCriteria),
    TYPE_EXCLUSION: element(sheet.exclusionCriteria),
    TYPE_DATING_RULE: datingRuleOf(sheet),
    TYPE_EXAMPLE: element(sheet.genericExample),
  };
}

/**
 * The values of the placeholders outside the type block, `typeIds` in the order of
 * the blocks (BKT-22).
 */
function requestValues(
  input: ResearchPromptInput,
  typeIds: readonly string[],
): Readonly<Record<RequestPlaceholder, string>> {
  const { player, overallPeriod } = input;
  return {
    REFERENCE: input.reference,
    TODAY: input.today,
    PLAYER_NAME: player.displayName,
    PLAYER_ID: player.id,
    PLAYER_MARKER: playerMarker(player.firstNbaGameOn),
    PERIOD: periodText(overallPeriod.startOn, overallPeriod.endOn),
    MAX_TEXT_LENGTH: String(input.maxTextLength),
    MAX_SOURCES: String(input.maxSources),
    TYPE_LIST: `[${typeIds.map((id) => JSON.stringify(id)).join(', ')}]`,
    FORMAT_VERSION,
  };
}

/**
 * Builds the research prompt of a backtest request (BKT-11, BKT-19 to BKT-22, BKT-26,
 * BKT-27, BKT-29): the English template of glossary section 6.3 (CL-BKT-02) with every
 * placeholder filled and every date as given, `YYYY-MM-DD`, and one block per
 * requested type with its whole sheet, in the alphabetical order of their identifiers,
 * which `{{TYPE_LIST}}` lists in the same order. A requested type derived from the
 * calendar refuses the prompt (CL-BKT-03).
 */
export function buildPrompt(input: ResearchPromptInput): BuildPromptResult {
  const types = input.requestedTypes.toSorted((left, right) =>
    left.sheet.id.localeCompare(right.sheet.id, 'en'),
  );
  const calendarDerived = types.filter((type) => type.sheet.isCalendarDerived);
  if (calendarDerived.length > 0) {
    const eventTypeIds = calendarDerived.map((type) => type.sheet.id);
    return { ok: false, error: { kind: 'calendar_derived_type', eventTypeIds } };
  }
  const typeIds = types.map((type) => type.sheet.id);
  const values = requestValues(input, typeIds);
  const blocks = types.map((type) => fill(PARTS.block, typeValues(type)));
  const head = fill(PARTS.head, values);
  const tail = fill(PARTS.tail, values);
  return { ok: true, prompt: `${head}${blocks.join(BLOCK_SEPARATOR)}${tail}` };
}
