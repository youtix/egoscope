import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { sentence } from './sentence';

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
// The slot that ends every file, under which an area adds its own groups.
const AREA_SLOT =
  '\n  // An area adds its groups below, one commented group per screen or task.\n} as const;\n';

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

  it('[SEN-30] recalls, beside every general trend, what it describes', () => {
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

  it('[ALE-17] ends every alert sheet with its standing notice', () => {
    expect(sentence('alerts.standingNotice')).toBe(
      'This sheet describes past games. It does not predict the next game and is not a betting recommendation.',
    );
  });

  it('[TEL-05] closes every alert message with its mention', () => {
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
