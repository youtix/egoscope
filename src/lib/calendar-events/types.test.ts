import { describe, expect, expectTypeOf, it } from 'vitest';

import * as types from './types';

import type { Transaction } from '@/lib/db';
import type { Result } from '@/lib/result';

describe('the derivation reactions', () => {
  it('[CL-TEL-21] [CL-TAX-19] receive the transaction, the event and case dropped, the reason and the request flag, and return a Result', () => {
    // The type check verifies the contract; at run time, types.ts holds types only.
    expectTypeOf<Parameters<types.DerivationReactions>>().toEqualTypeOf<
      [Transaction, types.DerivationDrop]
    >();
    expectTypeOf<types.DerivationDrop>().toEqualTypeOf<
      Readonly<{
        eventId: number;
        caseId: number;
        reason:
          | 'date_changed'
          | 'opponent_changed'
          | 'game_canceled'
          | 'player_left_team'
          | 'birthday_corrected'
          | 'team_history_corrected';
        followsOwnerChange: boolean;
      }>
    >();
    expectTypeOf<types.DerivationDrop['followsOwnerChange']>().toEqualTypeOf<
      types.CalendarDerivationRequestRow['followsOwnerChange']
    >();
    // The empty list of a Lot 1 build never fails; a filled list states its error.
    expectTypeOf<ReturnType<types.DerivationReactions>>().toEqualTypeOf<
      Promise<Result<undefined, never>>
    >();
    expectTypeOf<ReturnType<types.DerivationReactions<'refused'>>>().toEqualTypeOf<
      Promise<Result<undefined, 'refused'>>
    >();

    expect(Object.keys(types)).toStrictEqual([]);
  });
});
