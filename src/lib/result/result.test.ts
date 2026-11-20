import { describe, expect, it } from 'vitest';

import { err, isOk, mapResult, ok } from './result';

import type { Result } from './result';

type Refusal = Readonly<{ kind: 'out_of_bounds'; bounds: string }>;

const REFUSAL: Refusal = { kind: 'out_of_bounds', bounds: '7 to 365 days' };

const double = (days: number): number => days * 2;

describe('Result', () => {
  it('carries the value of a success and the error of a failure', () => {
    expect(ok(90)).toStrictEqual({ ok: true, value: 90 });
    expect(err(REFUSAL)).toStrictEqual({ ok: false, error: REFUSAL });
  });

  it('tells a success from a failure', () => {
    const results: readonly Result<number, Refusal>[] = [ok(90), err(REFUSAL)];

    expect(results.map((result) => isOk(result))).toStrictEqual([true, false]);
  });

  it('maps the value of a success and leaves a failure untouched', () => {
    const failure = err(REFUSAL);

    expect(mapResult(ok(90), double)).toStrictEqual({ ok: true, value: 180 });
    expect(mapResult<number, number, Refusal>(failure, double)).toBe(failure);
  });
});
