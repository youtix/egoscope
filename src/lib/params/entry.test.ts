import { describe, expect, it } from 'vitest';

import { entriesOf, fileOf, originOf } from './entry';
import { integer } from './kinds';
import { DAYS } from './units';

describe('the entries of the registry', () => {
  it('[TRV-34] gives a decision record the origin of a decision, a journal hypothesis its own, any other source a local one', () => {
    expect(
      ['ADR 0021', 'H-13', 'H-JOU-01', 'CL-TRV-23', 'TEL-24', 'hosting sheet', 'ADR 21'].map(
        (source) => originOf(source),
      ),
    ).toStrictEqual([
      'journal_decision',
      'journal_hypothesis',
      'local_hypothesis',
      'local_hypothesis',
      'local_hypothesis',
      'local_hypothesis',
      'local_hypothesis',
    ]);
  });

  it('[TRV-34] [TRV-38] gives a requirement the spec file of its prefix, and refuses one of no file as a bug', () => {
    expect(
      (['JOU-04', 'STA-14', 'SUI-22', 'TRV-61'] as const).map((requirement) => fileOf(requirement)),
    ).toStrictEqual(['01', '07', '10', '14']);
    // @ts-expect-error -- GLO is the prefix of no spec file.
    expect(() => fileOf('GLO-01')).toThrow('GLO-01 is no requirement of a spec file.');
  });

  it('[TRV-34] [CL-IHM-23] writes an entry with the lot of its family and the usual values of what it leaves out', () => {
    const entry = entriesOf(2)({
      label: 'Exposure indicator period',
      sentence: 'The period over which exposure is counted.',
      unit: 'days',
      kind: integer(1, 90, DAYS),
      defaultValue: 30,
      requirement: 'JOU-03',
      source: 'H-JOU-08',
    });

    expect({ ...entry, kind: undefined }).toStrictEqual({
      label: 'Exposure indicator period',
      sentence: 'The period over which exposure is counted.',
      unit: 'days',
      allowed: '1 to 90 days',
      file: '01',
      requirement: 'JOU-03',
      source: 'H-JOU-08',
      origin: 'local_hypothesis',
      affectsCalculations: false,
      movesSchedule: false,
      lot: 2,
      engineeringBounds: false,
      editedOn: null,
      kind: undefined,
      defaultValue: 30,
    });
  });

  it('[CL-TRV-16] adds the bounds that a definition states beside those of its kind, and keeps the facts it states', () => {
    const entry = entriesOf(1)({
      label: 'Maximum active players',
      sentence: 'The most players followed at once.',
      unit: 'players',
      kind: integer(1, 100),
      defaultValue: 30,
      requirement: 'JOU-04',
      source: 'H-JOU-01',
      boundsNote: ', at least the indicative minimum',
      affectsCalculations: true,
      movesSchedule: true,
      lot: 2,
      engineeringBounds: true,
      editedOn: '/settings/display',
    });

    expect([
      entry.allowed,
      entry.affectsCalculations,
      entry.movesSchedule,
      entry.lot,
      entry.engineeringBounds,
      entry.editedOn,
    ]).toStrictEqual([
      '1 to 100, at least the indicative minimum',
      true,
      true,
      2,
      true,
      '/settings/display',
    ]);
  });
});
