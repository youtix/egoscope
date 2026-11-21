// Proves that the layer zone of the idle tick bites: deliberate imports of the database
// from the wake plan and the runtime cache, linted with the full configuration in the
// probe project of lint-probes.ts.
import { afterAll, describe, expect, it } from 'vitest';

import { createProbes } from './lint-probes';

const { ruleIds, remove } = createProbes();

const RULE = 'import-x/no-restricted-paths';

describe('the layer zone of the idle tick', { timeout: 120_000 }, () => {
  afterAll(remove);

  it.each([
    ['src/lib/wake-plan/probe.ts', "export { getDb } from '@/lib/db';\n"],
    [
      'src/lib/wake-plan/probe.ts',
      "import type { SequenceName } from '@/lib/db';\n\nexport type Name = SequenceName;\n",
    ],
    ['src/lib/wake-plan/probe.test.ts', "export { createTestDatabase } from '@/lib/db';\n"],
    ['src/lib/runtime-cache/probe.ts', "export { getDb } from '@/lib/db';\n"],
  ])('[TRV-04] refuses, in %s, %s', async (file, code) => {
    const messages = await ruleIds(file, code);

    expect(messages).toContain(RULE);
  });

  it('[TRV-04] lets the other modules of src/lib import the database', async () => {
    const messages = await ruleIds('src/lib/probe/probe.ts', "export { getDb } from '@/lib/db';\n");

    expect(messages).not.toContain(RULE);
  });
});
