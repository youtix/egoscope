// Proves the line that eslint-address-tables.ts draws: an IP literal passes in the two
// address tables of the link check and nowhere else, since sonarjs/no-hardcoded-ip still
// refuses one in the other files of the link check, in their tests and in another
// module. The probes are linted with the full configuration in the probe project of
// lint-probes.ts.
import { afterAll, describe, expect, it } from 'vitest';

import config from '../eslint.config';
import { ADDRESS_TABLES } from './eslint-address-tables';
import { createProbes } from './lint-probes';

const { ruleIds, remove } = createProbes();
const RULE = 'sonarjs/no-hardcoded-ip';
const ADDRESS = "export const ADDRESS = '10.0.0.1';\n";

describe('the address tables of the link check', { timeout: 120_000 }, () => {
  afterAll(remove);

  it.each(ADDRESS_TABLES)('lets %s hold an IP literal', async (file) => {
    expect(await ruleIds(file, ADDRESS)).not.toContain(RULE);
  });

  it.each([
    'src/lib/link-check/http.ts',
    'src/lib/link-check/http.test.ts',
    'src/lib/probe/probe.ts',
  ])('refuses an IP literal in %s', async (file) => {
    expect(await ruleIds(file, ADDRESS)).toContain(RULE);
  });

  it('turns that one rule off, for the two tables alone', () => {
    const blocks = config.filter((block) => block.rules?.[RULE] === 'off');

    expect(blocks).toStrictEqual([
      { name: 'egoscope/address-tables', files: [...ADDRESS_TABLES], rules: { [RULE]: 'off' } },
    ]);
  });
});
