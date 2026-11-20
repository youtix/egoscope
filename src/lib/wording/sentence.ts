// The fixed sentences of the specs, one file per spec file under sentences/ (module
// map, wording), read by a key that names the file and the sentence:
// `sensitivity.generalTrendReminder`.
import { alertsSentences } from './sentences/alerts';
import { backtestsSentences } from './sentences/backtests';
import { collectionSentences } from './sentences/collection';
import { crossCuttingSentences } from './sentences/cross-cutting';
import { detectionSentences } from './sentences/detection';
import { importsSentences } from './sentences/imports';
import { interfaceSentences } from './sentences/interface';
import { notificationsSentences } from './sentences/notifications';
import { overviewSentences } from './sentences/overview';
import { playersSentences } from './sentences/players';
import { sensitiveDataSentences } from './sentences/sensitive-data';
import { sensitivitySentences } from './sentences/sensitivity';
import { statisticsSentences } from './sentences/statistics';
import { taxonomySentences } from './sentences/taxonomy';
import { trackingSentences } from './sentences/tracking';
import { fill } from './template';

import type { FillArgs } from './template';

// In the order of the spec files, 00 to 14.
const SENTENCES = {
  overview: overviewSentences,
  players: playersSentences,
  taxonomy: taxonomySentences,
  collection: collectionSentences,
  detection: detectionSentences,
  backtests: backtestsSentences,
  imports: importsSentences,
  statistics: statisticsSentences,
  sensitivity: sensitivitySentences,
  alerts: alertsSentences,
  tracking: trackingSentences,
  notifications: notificationsSentences,
  interface: interfaceSentences,
  sensitiveData: sensitiveDataSentences,
  crossCutting: crossCuttingSentences,
} as const;

type Sentences = typeof SENTENCES;
type SpecFile = keyof Sentences;

/** A fixed sentence, by its spec file and its name: `'notifications.closingLine'`. */
export type SentenceKey = {
  [S in SpecFile]: `${S}.${Extract<keyof Sentences[S], string>}`;
}[SpecFile];

type Template<K extends SentenceKey> = K extends `${infer S extends SpecFile}.${infer N}`
  ? Extract<Sentences[S][N & keyof Sentences[S]], string>
  : never;

// The same sentences, read by their keys.
const FILES: Readonly<Record<string, Readonly<Record<string, string>>>> = SENTENCES;
const TEMPLATES: ReadonlyMap<string, string> = new Map(
  Object.entries(FILES).flatMap(([file, sentences]) =>
    Object.entries(sentences).map(([name, text]) => [`${file}.${name}`, text] as const),
  ),
);

/**
 * A fixed sentence of the specs in English (VUE-08, glossary section 7), its
 * placeholders filled with values already written, numbers through the formatters of
 * this module and dates through those of `@/lib/time` (IHM-13):
 * `sentence('sensitivity.inconclusiveForPlayer', { k: '4', n: '5' })` gives
 * "inconclusive for this player (4 valid cases of the 5 needed)", and with `k: '1'`,
 * "(1 valid case of the 5 needed)" (SEN-31, CL-TEL-16).
 */
export function sentence<K extends SentenceKey>(key: K, ...values: FillArgs<Template<K>>): string {
  const template = TEMPLATES.get(key);
  if (template === undefined) {
    throw new Error(`No fixed sentence is named ${key}.`);
  }
  return fill(template, values);
}
