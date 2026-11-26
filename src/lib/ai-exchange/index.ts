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
export { checkEvents } from './research-result/check-events';
export type {
  AcceptedEvent,
  EventCheck,
  EventCheckContext,
  ImportRefusal,
  ImportWarning,
} from './research-result/check-events';

// research-result/check-sources.ts
export { checkSources } from './research-result/check-sources';
export type {
  CheckedSource,
  SourceCheckRules,
  SourceChecks,
  SourceDropCause,
  SourceWarning,
} from './research-result/check-sources';

// research-result/messages.ts
export { eventMessage } from './research-result/messages';
export type {
  EventAsRead,
  EventProblem,
  ImportMessage,
  MessageContext,
} from './research-result/messages';

// research-result/correction-message.ts
export { composeCorrectionMessage } from './research-result/correction-message';
export type { CorrectionMessageInput } from './research-result/correction-message';

// research-result/check-scope.ts
export type {
  CheckedEventType,
  ImportIgnoreReason,
  RequestedType,
  SplitChoice,
  TaxonomyType,
} from './research-result/check-scope';

// research-result/check-leads-and-limitations.ts
export { checkLeadsAndLimitations } from './research-result/check-leads-and-limitations';
export type {
  ResultTextChecks,
  ResultTextWarning,
} from './research-result/check-leads-and-limitations';

// research-result/result-messages.ts
export { blockingErrorMessage, resultWarningMessage } from './research-result/result-messages';
export type { BlockingError, ResultWarning } from './research-result/result-messages';

// --- exploration/ ----------------------------------------------------------------
// format.ts stays internal to the part: its constants are the two readers' own, the
// exploration response's and the research result's, which compare a pasted text with
// them, and no other module reads a format's keys.

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
export { classificationInstructions, INSTRUCTIONS_VERSION } from './classification/instructions';
export type { InstructionsParameters } from './classification/instructions';

// classification/request.ts
export {
  buildClassificationRequest,
  classificationRequestText,
  estimateRequestTokens,
} from './classification/request';
export type {
  ClassificationArticleInput,
  ClassificationEventInput,
  ClassificationEventReference,
  ClassificationListEntry,
  ClassificationPlayerInput,
  ClassificationRequest,
  ClassificationRequestArticle,
  ClassificationRequestEvent,
  ClassificationRequestInput,
  ClassificationRequestPlayer,
  ClassificationRequestTypeSheet,
  ClassificationTypeSheet,
} from './classification/request';

// classification/schema.ts
export { CLASSIFICATION_ANSWER_SCHEMA } from './classification/schema';
export type { FactNovelty, JsonSchema } from './classification/schema';

// classification/answer.ts
export { checkAnswer } from './classification/answer';
export type { AnswerCheckParameters, CheckedPart } from './classification/answer';

// classification/answer-facts.ts
export type {
  CheckedContext,
  CheckedFact,
  CheckedKnownEntryFact,
  CheckedNewTypeFact,
  CheckedValidatedTypeFact,
} from './classification/answer-facts';

// classification/answer-fields.ts
export type {
  CheckedDescription,
  CheckedText,
  UnusablePartReason,
} from './classification/answer-fields';
