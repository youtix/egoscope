import { describe, expect, expectTypeOf, it } from 'vitest';

import * as types from './types';

import type { Transaction } from '@/lib/db';
import type { Result } from '@/lib/result';

describe('the regrouping reactions', () => {
  it('[CL-SUI-16] receive the transaction, the case a regrouping emptied and the case its events joined, and return a Result', () => {
    // The type check verifies the contract; at run time, types.ts holds types only.
    expectTypeOf<Parameters<types.RegroupingReactions>>().toEqualTypeOf<
      [Transaction, types.Regrouping]
    >();
    expectTypeOf<types.Regrouping>().toEqualTypeOf<
      Readonly<{ emptiedCaseId: number; survivingCaseId: number }>
    >();
    expectTypeOf<types.Regrouping['emptiedCaseId']>().toEqualTypeOf<types.CaseRow['id']>();
    // The empty list of a Lot 1 build never fails; a filled list states its error.
    expectTypeOf<ReturnType<types.RegroupingReactions>>().toEqualTypeOf<
      Promise<Result<undefined, never>>
    >();
    expectTypeOf<ReturnType<types.RegroupingReactions<'refused'>>>().toEqualTypeOf<
      Promise<Result<undefined, 'refused'>>
    >();

    expect(Object.keys(types)).toStrictEqual([]);
  });
});
