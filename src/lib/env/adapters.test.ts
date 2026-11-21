import { describe, expect, it, vi } from 'vitest';

import type { Port } from './server-env';

const PORTS: readonly Port[] = [
  'stats-source',
  'link-check',
  'backup-storage',
  'runtime-cache',
  'language-model',
  'press-feeds',
  'telegram',
];

/**
 * The adapters and the lot of a server whose configuration holds `variables`:
 * its modules load afresh and read that configuration.
 */
async function serverWith(variables: Readonly<Record<string, string>>) {
  vi.resetModules();
  for (const [name, value] of Object.entries(variables)) {
    vi.stubEnv(name, value);
  }
  return import('./adapters');
}

/** The adapter of each port, by port. */
const adaptersOf = (adapterFor: (port: Port) => string) =>
  Object.fromEntries(PORTS.map((port) => [port, adapterFor(port)]));

describe('adapterFor', () => {
  it('[TRV-64] serves every port with its real adapter by default', async () => {
    const { adapterFor } = await serverWith({});

    expect(new Set(PORTS.map((port) => adapterFor(port)))).toStrictEqual(new Set(['real']));
  });

  it('serves every port with its fake when EGOSCOPE_FAKES is all', async () => {
    const { adapterFor } = await serverWith({ EGOSCOPE_FAKES: 'all' });

    expect(new Set(PORTS.map((port) => adapterFor(port)))).toStrictEqual(new Set(['fake']));
  });

  it('serves with their fakes the ports that EGOSCOPE_FAKES lists, and the others with their real adapters', async () => {
    const { adapterFor } = await serverWith({ EGOSCOPE_FAKES: 'telegram, press-feeds' });

    expect(adaptersOf(adapterFor)).toStrictEqual({
      'stats-source': 'real',
      'link-check': 'real',
      'backup-storage': 'real',
      'runtime-cache': 'real',
      'language-model': 'real',
      'press-feeds': 'fake',
      telegram: 'fake',
    });
  });

  it.each([
    ['beside a real credential', { TELEGRAM_BOT_TOKEN: '123456:made-up-bot-token' }],
    ['on a production deployment', { VERCEL_ENV: 'production' }],
    ['in a configuration invalid for another reason', { LOG_LEVEL: 'INFO' }],
  ])(
    '[TRV-64] serves every port with its real adapter when the fakes switch is set %s',
    async (_case, variables) => {
      const { adapterFor } = await serverWith({ EGOSCOPE_FAKES: 'all', ...variables });

      expect(new Set(PORTS.map((port) => adapterFor(port)))).toStrictEqual(new Set(['real']));
    },
  );
});

describe('activeLot', () => {
  it.each([
    ['1 by default', {}, 1],
    ['1 when EGOSCOPE_LOT is 1', { EGOSCOPE_LOT: '1' }, 1],
    ['2 when EGOSCOPE_LOT is 2', { EGOSCOPE_LOT: '2' }, 2],
    [
      '1, the default, while the configuration is invalid',
      { EGOSCOPE_LOT: '2', LOG_LEVEL: 'INFO' },
      1,
    ],
  ])('[H-12] is %s', async (_case, variables, lot) => {
    const { activeLot } = await serverWith(variables);

    expect(activeLot()).toBe(lot);
  });
});
