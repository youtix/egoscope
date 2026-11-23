// Proves that the zone of eslint-test-support.ts bites: a production file of src/ that
// imports the test support is refused, in a module, a route handler and a page, while a
// test and a hermetic route under src/app/api/test/ may import it. Deliberate violations
// are linted with the full configuration in the probe project of lint-probes.ts.
import { afterAll, describe, expect, it } from 'vitest';

import { NO_TEST_SUPPORT_IN_PRODUCTION } from './eslint-test-support';
import { createProbes } from './lint-probes';

const { lint, remove } = createProbes();
const RULE = 'import-x/no-restricted-paths';
const IMPORTED = "export { scenarios } from '@/lib/testing';\n";

/** The messages of the zone's rule on `code`, linted as `file`. */
async function refusals(file: string, code: string): Promise<readonly string[]> {
  const messages = await lint(file, code);
  return messages.filter((message) => message.ruleId === RULE).map(({ message }) => message);
}

describe('the test support stays out of production code', { timeout: 120_000 }, () => {
  afterAll(remove);

  it.each([
    ['a module', 'src/lib/probe/probe.ts', IMPORTED],
    [
      'a module, through a type-only import',
      'src/lib/probe/probe.ts',
      "import type { World } from '@/lib/testing';\n\nexport type Worlds = readonly World[];\n",
    ],
    [
      'a module, through a dynamic import',
      'src/lib/probe/probe.ts',
      "export const later = import('@/lib/testing');\n",
    ],
    ['a route handler outside /api/test/', 'src/app/probe/route.ts', IMPORTED],
    ['a page', 'src/app/players/page.tsx', IMPORTED],
  ])('refuses an import of @/lib/testing in %s', async (_case, file, code) => {
    await expect(refusals(file, code)).resolves.toStrictEqual([
      `Unexpected path "@/lib/testing" imported in restricted zone. ${NO_TEST_SUPPORT_IN_PRODUCTION}`,
    ]);
  });

  it.each([
    ['a test', 'src/lib/probe/probe.test.ts'],
    ['a hermetic route under /api/test/', 'src/app/api/test/probe/route.ts'],
  ])('lets %s import it', async (_case, file) => {
    await expect(refusals(file, IMPORTED)).resolves.toStrictEqual([]);
  });
});
