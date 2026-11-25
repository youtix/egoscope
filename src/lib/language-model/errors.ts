/**
 * Why a provider gave no answer that can be read (module map §5, language-model):
 * - `quota_refused`: a refusal for quota, which counts as the limit reached even before the declared limit (TRV-06);
 * - `rate_limited`: a minute or day limit hit, with the delay the provider asks to wait when it gives one;
 * - `schema_not_met`: the provider says it could not hold the answer to the schema (Workers AI's "JSON Mode couldn't be met");
 * - `unavailable`: a network error, a server error or refused credentials;
 * - `timeout`: no answer before the call's deadline;
 * - `malformed`: an answer the adapter cannot read.
 */
export type LanguageModelError =
  | Readonly<{ kind: 'quota_refused' }>
  | Readonly<{ kind: 'rate_limited'; retryAfterMs: number | null }>
  | Readonly<{ kind: 'schema_not_met' }>
  | Readonly<{ kind: 'unavailable' }>
  | Readonly<{ kind: 'timeout' }>
  | Readonly<{ kind: 'malformed' }>;

// The failures that are an answer, however unusable: they use an attempt, and the next one
// goes to the next provider. A refusal or no answer uses none (CL-DET-03, DET-08).
const ANSWERED: ReadonlySet<LanguageModelError['kind']> = new Set(['schema_not_met', 'malformed']);

/** Whether `error` came with an answer, so that it uses an attempt (DET-22, CL-DET-03). */
export const hasAnswer = (error: LanguageModelError): boolean => ANSWERED.has(error.kind);
