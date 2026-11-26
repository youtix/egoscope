// The checks of a classification answer against the request it answers (detection.md
// section 5.2, CL-DET-02): for each submitted article and recognized player, a usable part
// with its facts, a usable part without any, which reads "no fact", or an unusable part with
// its reason, which the caller submits again within the cycle while it keeps the usable
// parts of each attempt (DET-22, CL-DET-03). The answer is read through `extractJson`, so
// prose or code fences around its JSON are no fault, and no text makes the checks throw.
import { extractJson } from '../extract-json';
import { checkPart } from './answer-facts';
import { accept, idOf, readList, readObject, refuse } from './answer-fields';
import { ANSWER_KEYS, RESULT_KEYS } from './schema';

import type { CheckedFact, PartScope } from './answer-facts';
import type { Checked, Field, UnusablePartReason } from './answer-fields';
import type { InstructionsParameters } from './instructions';
import type { ClassificationRequest, ClassificationRequestArticle } from './request';

/** What the checks take from the parameters: `events.maxDescriptionLength` (DSN-20). */
export type AnswerCheckParameters = Pick<InstructionsParameters, 'maxDescriptionLength'>;

/**
 * The part of one submitted article and player (CL-DET-01): usable with its facts, the
 * calendar facts dropped (CL-DET-22); usable with none, `no_fact` (DET-16); or unusable.
 */
export type CheckedPart = Readonly<{ articleId: string; playerId: string }> &
  (
    | Readonly<{ kind: 'facts'; facts: readonly CheckedFact[] }>
    | Readonly<{ kind: 'no_fact' }>
    | Readonly<{ kind: 'unusable'; reason: UnusablePartReason }>
  );

/** The one element of `items` that names `id` under `key`, or whether none or several do. */
function theOne(items: readonly Field[], key: string, id: string): Field | 'none' | 'several' {
  const [found, ...others] = items.filter((item) => idOf(item, key) === id);
  if (found === undefined) {
    return 'none';
  }
  return others.length === 0 ? found : 'several';
}

/** The parts of the article's one result (CL-DET-02). */
function partsOf(
  results: Checked<readonly Field[]>,
  article: ClassificationRequestArticle,
): Checked<readonly Field[]> {
  if (!results.ok) {
    return results;
  }
  const result = theOne(results.value, 'article_id', article.articleId);
  if (result === 'none') {
    return refuse({ kind: 'no_result' });
  }
  if (result === 'several') {
    return refuse({ kind: 'several_results' });
  }
  const fields = readObject(result, RESULT_KEYS);
  return fields.ok ? readList(fields.value('players')) : fields;
}

/** The player's one part, or why there is none: none named him, or several did (CL-DET-02). */
function partOf(parts: Checked<readonly Field[]>, scope: PartScope): Checked<Field> {
  if (!parts.ok) {
    return parts;
  }
  const part = theOne(parts.value, 'player_id', scope.player.playerId);
  if (part === 'several') {
    return refuse({ kind: 'several_parts' });
  }
  if (part !== 'none') {
    return accept(part);
  }
  const sent = new Set(scope.article.players.map((player) => player.playerId));
  const unknown = parts.value
    .map((item) => idOf(item, 'player_id'))
    .find((id): id is string => typeof id === 'string' && !sent.has(id));
  return refuse(
    unknown === undefined
      ? { kind: 'missing_part' }
      : { kind: 'unknown_player', playerId: unknown },
  );
}

function checkedPart(scope: PartScope, facts: Checked<readonly CheckedFact[]>): CheckedPart {
  const ids = { articleId: scope.article.articleId, playerId: scope.player.playerId };
  if (!facts.ok) {
    return { ...ids, kind: 'unusable', reason: facts.reason };
  }
  return facts.value.length === 0
    ? { ...ids, kind: 'no_fact' }
    : { ...ids, kind: 'facts', facts: facts.value };
}

function readResults(answerText: string): Checked<readonly Field[]> {
  const extracted = extractJson(answerText);
  if (!extracted.ok) {
    return refuse({ kind: 'unreadable_answer', cause: extracted.error.kind });
  }
  const answer = readObject({ value: extracted.value, path: [] }, ANSWER_KEYS);
  return answer.ok ? readList(answer.value('results')) : answer;
}

/**
 * Checks a classification answer against the request it answers (DET-15, DET-16, DET-21,
 * DET-22, DSN-25, CL-DET-02, CL-DET-18, CL-DET-22): one part per submitted article and
 * recognized player, in the order of the request. A part is unusable, with its reason, when
 * its article has no result or several, when the result names no part for the player or
 * several, or when its part breaks the answer's schema or names what the request did not
 * send for it: a type outside the validated types, which a type of the do-not-repropose or
 * calendar lists is (DET-15), an event, an entry or a calendar type; a confidence outside 0
 * to 100, and a novelty that disagrees with the event it designates, are unusable too.
 * Otherwise the part holds its facts, each confidence rounded half up and each timing hint
 * later than the article's date taken as none, its calendar facts dropped; a part left
 * without facts is `no_fact`. A description, justification, suggested name or definition
 * longer than `maxDescriptionLength` or holding a quotation mark of CL-DSN-03 is not kept,
 * a description marked `description_to_review` (DET-21), and the part stays usable.
 */
export function checkAnswer(
  answerText: string,
  request: ClassificationRequest,
  parameters: AnswerCheckParameters,
): readonly CheckedPart[] {
  const results = readResults(answerText);
  const maxLength = parameters.maxDescriptionLength;
  return request.articles.flatMap((article) => {
    const parts = partsOf(results, article);
    return article.players.map((player) => {
      const scope = { request, article, player, maxLength };
      const part = partOf(parts, scope);
      return checkedPart(scope, part.ok ? checkPart(part.value, scope) : part);
    });
  });
}
