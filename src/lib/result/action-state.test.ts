import { describe, expect, it } from 'vitest';

import { toActionState } from './action-state';
import { changedElsewhere } from './changed-elsewhere';
import { err, ok } from './result';

import type { ActionMessages } from './action-state';
import type { ChangedElsewhere } from './changed-elsewhere';
import type { Result } from './result';

type Override = Readonly<{ value: number; rowVersion: number }>;
type OutOfBounds = Readonly<{ kind: 'out_of_bounds'; bounds: string }>;

const CURRENT: Override = { value: 120, rowVersion: 4 };
const MESSAGES: ActionMessages<OutOfBounds> = {
  succeeded: 'Saved.',
  changedElsewhere: 'This setting was changed elsewhere. Its current value is shown.',
  failed: (error) => ({
    message: `Choose a value from ${error.bounds}.`,
    fieldErrors: { value: [error.bounds] },
  }),
};

describe('toActionState', () => {
  type SaveResult = Result<Override, OutOfBounds | ChangedElsewhere<Override>>;

  it('answers a success with its plain-language message', () => {
    const result: SaveResult = ok({ value: 90, rowVersion: 2 });

    expect(toActionState(result, MESSAGES)).toStrictEqual({
      status: 'succeeded',
      message: 'Saved.',
    });
  });

  it('[CL-IHM-18] answers a stale save with the notice and the current version the form shows', () => {
    const result: SaveResult = err(changedElsewhere(CURRENT));

    expect(toActionState(result, MESSAGES)).toStrictEqual({
      status: 'changed_elsewhere',
      message: 'This setting was changed elsewhere. Its current value is shown.',
      current: { value: 120, rowVersion: 4 },
    });
  });

  it('answers another failure with its message and the errors of its fields', () => {
    const result: SaveResult = err({ kind: 'out_of_bounds', bounds: '7 to 365 days' });

    expect(toActionState(result, MESSAGES)).toStrictEqual({
      status: 'failed',
      message: 'Choose a value from 7 to 365 days.',
      fieldErrors: { value: ['7 to 365 days'] },
    });
  });

  it('answers a failure that concerns no field with no field error', () => {
    const result: Result<undefined, 'database-not-configured'> = err('database-not-configured');

    expect(
      toActionState(result, {
        succeeded: 'Saved.',
        changedElsewhere: 'Changed elsewhere.',
        failed: () => ({ message: 'The database is not configured yet.' }),
      }),
    ).toStrictEqual({
      status: 'failed',
      message: 'The database is not configured yet.',
      fieldErrors: {},
    });
  });
});
