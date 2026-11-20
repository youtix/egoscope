import { describe, expect, it } from 'vitest';

import { changedElsewhere, isChangedElsewhere } from './changed-elsewhere';

describe('changedElsewhere', () => {
  it('[CL-IHM-18] carries the current version of the object that a stale save found', () => {
    expect(changedElsewhere({ value: 120, rowVersion: 4 })).toStrictEqual({
      kind: 'changed_elsewhere',
      current: { value: 120, rowVersion: 4 },
    });
  });

  it('[CL-IHM-18] recognizes the refusal of a stale save, and nothing else', () => {
    const errors: readonly unknown[] = [
      changedElsewhere(null),
      { kind: 'changed_elsewhere' },
      { kind: 'out_of_bounds', current: 3 },
      'changed_elsewhere',
      null,
    ];

    expect(errors.map((error) => isChangedElsewhere(error))).toStrictEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
  });
});
