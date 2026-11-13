// Proves that coverage leaves out exactly the route shells that lint keeps thin:
// both configurations read scripts/route-shells.ts.
import { describe, expect, it } from 'vitest';

import { ROUTE_SHELLS } from './scripts/route-shells';
import config from './vitest.config';

describe('vitest.config.ts', () => {
  it('leaves every kind of route shell out of coverage, and nothing else from src/app', () => {
    const exclude = config.test?.coverage?.exclude ?? [];

    expect(exclude).toStrictEqual(['src/**/*.test.{ts,tsx}', 'src/**/*.d.ts', ...ROUTE_SHELLS]);
  });
});
