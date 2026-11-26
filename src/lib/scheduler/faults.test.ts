import { describe, expect, it } from 'vitest';

import { thrownFacts } from './faults';

describe('what the log says of a call that threw', () => {
  it("[CL-TRV-07] names the error and the driver's SQL state, never the message", () => {
    const failedQuery = new Error('Failed query: insert … params: OWNER TEXT', {
      cause: { code: '22P02', detail: 'OWNER TEXT' },
    });
    expect([
      thrownFacts(failedQuery),
      thrownFacts(new TypeError('OWNER TEXT')),
      thrownFacts(new Error('OWNER TEXT', { cause: { code: 22 } })),
      thrownFacts(new Error('OWNER TEXT', { cause: 'OWNER TEXT' })),
      thrownFacts('OWNER TEXT'),
      thrownFacts(undefined),
    ]).toStrictEqual([
      { error: 'Error', code: '22P02' },
      { error: 'TypeError' },
      { error: 'Error' },
      { error: 'Error' },
      { error: 'string' },
      { error: 'undefined' },
    ]);
  });
});
