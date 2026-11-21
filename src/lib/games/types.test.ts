import { describe, expect, expectTypeOf, it } from 'vitest';

import * as types from './types';

import type { Transaction } from '@/lib/db';
import type { Result } from '@/lib/result';

describe('the hooks of the fetch queue', () => {
  it('[CL-SEN-17] [CL-TAX-19] [CL-STA-25] pass the changes of cases in order, and the player of a changed team history or a stored history', () => {
    type Correction = types.CasesChange<'stats_correction'>;
    type NewCases = types.CasesChange<'new_cases'>;
    type Baseline = types.CasesChange<'baseline_updated'>;
    type Hook<A> = (tx: Transaction, argument: A) => Promise<Result<undefined, never>>;

    // The type check verifies the contract; at run time, types.ts holds types only. One
    // change or more, at most one per cause, in the order statistics correction, new
    // cases, baseline updated, each with the cases of a statistics update it concerns.
    expectTypeOf<types.CasesChanges>().toEqualTypeOf<
      | readonly [Correction]
      | readonly [Correction, NewCases]
      | readonly [Correction, NewCases, Baseline]
      | readonly [Correction, Baseline]
      | readonly [NewCases]
      | readonly [NewCases, Baseline]
      | readonly [Baseline]
    >();
    expectTypeOf<readonly [NewCases, Correction]>().not.toExtend<types.CasesChanges>();
    expectTypeOf<types.CasesChange>().toEqualTypeOf<
      Readonly<{
        cause: 'stats_correction' | 'new_cases' | 'baseline_updated';
        scope: Readonly<{
          kind: 'statistics_update';
          playerIds: readonly string[];
          gameIds: readonly number[];
        }>;
      }>
    >();
    expectTypeOf<types.FetchQueueHooks>().toEqualTypeOf<
      Readonly<{
        onCasesChanged: Hook<types.CasesChanges>;
        onTeamHistoryChanged: Hook<string>;
        onHistoryStored: Hook<string>;
      }>
    >();

    expect(Object.keys(types)).toStrictEqual([]);
  });
});
