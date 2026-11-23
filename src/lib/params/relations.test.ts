import { describe, expect, it } from 'vitest';

import { ENTRIES } from './catalog';
import { brokenRelation, refusalOf, writeValue } from './relations';

import type { ParamReader } from './catalog';
import type { OverridableKey } from './entry';

/** The values in force: the defaults, but for those of `changed`. */
function valuesWith(changed: Readonly<Partial<Record<OverridableKey, unknown>>>): ParamReader {
  return {
    get: (key) => ENTRIES[key].kind.parse(changed[key]) ?? ENTRIES[key].defaultValue,
  };
}

const DEFAULTS = valuesWith({});

describe('the bounds between two parameters', () => {
  it('[CL-TRV-16] [CL-JOU-10] keeps the indicative minimum at most the maximum, whichever of the two changes', () => {
    expect([
      brokenRelation('players.indicativeMin', 30, DEFAULTS),
      brokenRelation('players.indicativeMin', 31, DEFAULTS),
      brokenRelation('players.maxActive', 20, DEFAULTS),
      brokenRelation('players.maxActive', 19, DEFAULTS),
    ]).toStrictEqual([
      undefined,
      { key: 'players.maxActive', written: '30 active players' },
      undefined,
      { key: 'players.indicativeMin', written: '20 active players' },
    ]);
  });

  it('[CL-TRV-16] keeps high confidence one case above medium at least', () => {
    expect([
      brokenRelation('sensitivity.confidenceHighFromCases', 9, DEFAULTS),
      brokenRelation('sensitivity.confidenceHighFromCases', 8, DEFAULTS),
      brokenRelation('sensitivity.confidenceMediumFromCases', 14, DEFAULTS),
      brokenRelation('sensitivity.confidenceMediumFromCases', 15, DEFAULTS),
    ]).toStrictEqual([
      undefined,
      { key: 'sensitivity.confidenceMediumFromCases', written: '8 valid cases' },
      undefined,
      { key: 'sensitivity.confidenceHighFromCases', written: '15 valid cases' },
    ]);
  });

  it('[CL-TRV-16] [CL-TRV-23] keeps the cut-off of the statistics update an hour after its start at least', () => {
    expect([
      brokenRelation('scheduler.statsUpdateCutoff', '16:00', DEFAULTS),
      brokenRelation('scheduler.statsUpdateCutoff', '15:59', DEFAULTS),
      brokenRelation('scheduler.statsUpdateTime', '19:00', DEFAULTS),
      brokenRelation('scheduler.statsUpdateTime', '19:01', DEFAULTS),
    ]).toStrictEqual([
      undefined,
      { key: 'scheduler.statsUpdateTime', written: '15:00' },
      undefined,
      { key: 'scheduler.statsUpdateCutoff', written: '20:00' },
    ]);
  });

  it('[CL-TRV-16] keeps each "possible" threshold at most its "probable" one, and reads the values in force', () => {
    const raised = valuesWith({ 'sensitivity.probableMeanGap': 0.3 });

    expect([
      brokenRelation('sensitivity.possibleMeanGap', 0.3, raised),
      brokenRelation('sensitivity.possibleMeanGap', 0.31, raised),
      brokenRelation('sensitivity.probableSignalToNoise', 1.9, DEFAULTS),
      brokenRelation('collection.dedupTraceRetentionDays', 7, DEFAULTS),
      brokenRelation('games.correctionWindowDays', 30, DEFAULTS),
      brokenRelation('journal.retentionDays', 7, DEFAULTS),
    ]).toStrictEqual([
      undefined,
      { key: 'sensitivity.probableMeanGap', written: '0.3' },
      { key: 'sensitivity.possibleSignalToNoise', written: '2 times the expected noise' },
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('[TRV-35] [CA-TRV-11] explains a refusal by the allowed values, and by the value of the other parameter of a broken bound', () => {
    expect(refusalOf('journal.retentionDays')).toBe('Journal retention accepts 7 to 365 days.');
    expect(
      refusalOf('players.indicativeMin', {
        key: 'players.maxActive',
        written: '30 active players',
      }),
    ).toBe(
      'Indicative minimum of players accepts 0 to 100 active players, at most the maximum; 0 means no reminder. Maximum active players is 30 active players.',
    );
  });

  it('[TRV-42] writes a value with its unit, as the journal and the screens show it', () => {
    expect([
      writeValue('journal.retentionDays', 120),
      writeValue('collection.times', ['16:30', '23:00']),
      writeValue('display.timeZone', 'America/New_York'),
      writeValue('quotas.statsSource.requestsPerDay', null),
      writeValue('games.postseasonBaseline', 'regular_season'),
    ]).toStrictEqual(['120 days', '16:30 and 23:00', 'New York time', 'not set', 'regular season']);
  });
});
