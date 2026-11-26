import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { sentence } from './sentence';
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

const SENTENCES_FOLDER = path.join(import.meta.dirname, 'sentences');
// The names of the module map, section 2.1: one file per spec file, 00 to 14.
const SPEC_FILES = [
  'alerts.ts',
  'backtests.ts',
  'collection.ts',
  'cross-cutting.ts',
  'detection.ts',
  'imports.ts',
  'interface.ts',
  'notifications.ts',
  'overview.ts',
  'players.ts',
  'sensitive-data.ts',
  'sensitivity.ts',
  'statistics.ts',
  'taxonomy.ts',
  'tracking.ts',
];
// The slot that ends every file, above which an area adds its own groups.
const AREA_SLOT =
  '\n  // An area adds its groups above this line, one commented group per screen or task.\n} as const;\n';
// Every fixed sentence, in the order of the spec files.
const SENTENCE_FILES: readonly Readonly<Record<string, string>>[] = [
  overviewSentences,
  playersSentences,
  taxonomySentences,
  collectionSentences,
  detectionSentences,
  backtestsSentences,
  importsSentences,
  statisticsSentences,
  sensitivitySentences,
  alertsSentences,
  trackingSentences,
  notificationsSentences,
  interfaceSentences,
  sensitiveDataSentences,
  crossCuttingSentences,
];
// The name that opens a placeholder, well formed or not: `k` of `{k|case}` too.
const PLACEHOLDER_NAME = /\{(?<name>[A-Za-z]+)/gu;
// A written count that takes the plural, given to every placeholder.
const WRITTEN_VALUE = '2';
const BRACE = /[{}]/u;

/** `template` filled with a value for each placeholder that it names. */
function filled(template: string): string {
  const names = Array.from(
    template.matchAll(PLACEHOLDER_NAME),
    (match) => match.groups?.['name'] ?? '',
  );
  return fill(template, [Object.fromEntries(names.map((name) => [name, WRITTEN_VALUE]))]);
}

describe('fixed sentences', () => {
  it('keeps one sentences file per spec file, each ending with the slot of the areas', () => {
    const files = readdirSync(SENTENCES_FOLDER).toSorted((left, right) =>
      left.localeCompare(right, 'en'),
    );
    const withoutSlot = files.filter(
      (file) => !readFileSync(path.join(SENTENCES_FOLDER, file), 'utf8').endsWith(AREA_SLOT),
    );

    expect(files).toStrictEqual(SPEC_FILES);
    expect(withoutSlot).toStrictEqual([]);
  });

  it('[VUE-08] fills every placeholder of every fixed sentence, and leaves no brace to reach a screen', () => {
    const withBraces = SENTENCE_FILES.flatMap((sentences) =>
      Object.values(sentences).map((text) => filled(text)),
    );

    expect(withBraces.filter((text) => BRACE.test(text))).toStrictEqual([]);
  });

  it('[SEN-30] gives the reminder that accompanies every general trend', () => {
    expect(sentence('sensitivity.generalTrendReminder')).toBe(
      'The general trend describes all observed players, not any one of them.',
    );
  });

  it('[SEN-31] labels a profile under the case threshold and titles the general trend beside it', () => {
    expect(sentence('sensitivity.inconclusiveForPlayer', { k: '4', n: '5' })).toBe(
      'inconclusive for this player (4 valid cases of the 5 needed)',
    );
    expect(sentence('sensitivity.generalTrendTitle')).toBe(
      'general trend of the type, does not describe this player',
    );
  });

  it('[SEN-31] [CL-SEN-15] [CL-TEL-16] writes one valid case in the singular, and none or several in the plural', () => {
    expect(
      ['0', '1', '4'].map((k) => sentence('sensitivity.inconclusiveForPlayer', { k, n: '5' })),
    ).toStrictEqual([
      'inconclusive for this player (0 valid cases of the 5 needed)',
      'inconclusive for this player (1 valid case of the 5 needed)',
      'inconclusive for this player (4 valid cases of the 5 needed)',
    ]);
  });

  it('[IHM-50] gives the profile and validation screens their short notice', () => {
    expect(sentence('interface.shortNotice')).toBe(
      'A measure of the past, an unproven hypothesis, no betting recommendation',
    );
  });

  it('[ALE-17] gives the standing notice that ends every alert sheet', () => {
    expect(sentence('alerts.standingNotice')).toBe(
      'This sheet describes past games. It does not predict the next game and is not a betting recommendation.',
    );
  });

  it('[TEL-05] gives the mention that closes every alert message', () => {
    expect(sentence('notifications.closingLine')).toBe('A measure of the past, not a forecast.');
  });

  it('[IHM-54] [IHM-55] [IHM-56] writes each empty state with the action that fills it', () => {
    expect([
      sentence('interface.addPlayer'),
      sentence('interface.noValidatedType'),
      sentence('interface.noBacktestYet'),
      sentence('interface.requestBacktest'),
      sentence('interface.noEventOfType', { date: 'Tue 17 Nov 2026' }),
      sentence('interface.nothingToDo'),
      sentence('interface.noAlertYet'),
      sentence('interface.noPressSource'),
    ]).toStrictEqual([
      'Add a player',
      'no validated type',
      'no backtest yet',
      'Request a backtest',
      'no event of this type found by the backtest of Tue 17 Nov 2026',
      'Nothing to do right now',
      'an alert is produced when a profiled player has a new event',
      'detection cannot work',
    ]);
  });

  it('presents Home at first launch, the third disclaimer that says what the app does not do', () => {
    expect(sentence('interface.firstLaunchPresentation')).toBe(
      'Egoscope measures how followed players played after public events. It does not predict games or give betting advice.',
    );
  });

  it('[CL-DSN-20] describes a calendar-derived event, naming only the player and his former team', () => {
    expect(sentence('sensitiveData.birthdayDescription', { player: 'Player A' })).toBe(
      'Player A plays on his birthday.',
    );
    expect(
      sentence('sensitiveData.formerTeamDescription', { player: 'Player A', team: 'Team X' }),
    ).toBe('Player A faces his former team Team X for the first time since leaving it.');
  });

  it('refuses a sentence that no spec file holds', () => {
    // @ts-expect-error: no spec file holds a sentence of this name
    expect(() => sentence('sensitivity.prediction')).toThrow(
      'No fixed sentence is named sensitivity.prediction',
    );
  });
});
