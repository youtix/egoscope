// The public API of the exchanges with an AI: the shared files, then one slot per part
// of the module map (section 2.2), in its order, and in each part's slot one sub-slot
// per file that the plan gives the part and that exports something. A task adds its
// exports under its own file's sub-slot only; a file that the plan did not foresee gets
// its sub-slot at the end of its part's slot (module map, section 9).

// --- Shared files ----------------------------------------------------------------

// conventions.ts
export { canonicalValue, isAbsent, parseExchangeDate } from './conventions';
export type { DateParseError, ExchangeDate, ExchangeDateResult } from './conventions';

// extract-json.ts
export { extractJson } from './extract-json';
export type { ExtractJsonError, ExtractJsonResult, JsonPath } from './extract-json';

// text-rules.ts
export { checkText, textLength } from './text-rules';
export type { TextRuleBreach } from './text-rules';

// pasted-text-size.ts
export { checkPastedTextSize } from './pasted-text-size';
export type { PastedTextSizeResult } from './pasted-text-size';

// --- research-prompt/ ------------------------------------------------------------
// template.ts stays internal to the part.

// research-prompt/build-prompt.ts
export { buildPrompt } from './research-prompt/build-prompt';
export type {
  BuildPromptError,
  BuildPromptResult,
  PromptPeriod,
  PromptRequestedType,
  PromptTypeSheet,
  ResearchPromptInput,
} from './research-prompt/build-prompt';

// --- research-result/ ------------------------------------------------------------
// recover-cut.ts and text-signals.ts stay internal to the part.

// research-result/format.ts
export type {
  ContextIndications,
  GameStakes,
  InjuryReturn,
  ResearchConfidence,
  ResearchEvent,
  ResearchResult,
  ResearchSource,
  UnverifiedLead,
} from './research-result/format';

// research-result/dates.ts
export type { DateReading, DateReadingError, DateWarning } from './research-result/dates';

// research-result/read-result.ts
export { readResult } from './research-result/read-result';
export type {
  ReadResultError,
  ReadResultOutcome,
  ReadResultWarning,
  TruncationRecovery,
} from './research-result/read-result';

// research-result/check-events.ts

// research-result/check-sources.ts

// research-result/messages.ts

// research-result/correction-message.ts

// --- exploration/ ----------------------------------------------------------------

// exploration/prompt.ts
export { buildExplorationPrompt } from './exploration/prompt';
export type {
  ExplorationArticleReference,
  ExplorationPromptInput,
  ExplorationRejectedType,
  ExplorationTarget,
  ExplorationTypeEntry,
  TypeRejectionReason,
} from './exploration/prompt';

// exploration/response.ts
export { parseExplorationResponse } from './exploration/response';
export type {
  ExplorationResponse,
  ExplorationResponseError,
  ExplorationResponseResult,
  ExplorationWarning,
  ProposedIllustrationSource,
  ProposedType,
  ProposedTypeElement,
} from './exploration/response';

// --- classification/ -------------------------------------------------------------

// classification/instructions.ts

// classification/request.ts

// classification/schema.ts

// classification/answer.ts
