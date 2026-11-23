import { beforeEach, describe, expect, it, vi } from 'vitest';

import { toEpochMs } from '@/lib/time';

import type { CallContext } from './types';

const CONTEXT: CallContext = {
  deadline: toEpochMs(Date.UTC(2026, 10, 16, 4, 5)),
  signal: new AbortController().signal,
};
const NAME = 'egoscope-backup-20261116T040000Z-weekly.bin';
// Where the process keeps its one fake.
const SHARED_FAKE = Symbol.for('egoscope.backup-storage.fake');
const NOT_CONFIGURED = {
  ok: false,
  error: { kind: 'unauthorized', cause: 'not_configured' },
  call: { httpRequests: 0, bytesSent: 0, bytesReceived: 0, rateLimitResetsAt: null },
};

/** The accessor of a server whose configuration holds `variables`: its modules load afresh. */
async function accessorWith(variables: Readonly<Record<string, string>>) {
  vi.resetModules();
  for (const [name, value] of Object.entries(variables)) {
    vi.stubEnv(name, value);
  }
  const { backupStorage } = await import('./port');
  return backupStorage;
}

describe('backupStorage', () => {
  beforeEach(() => {
    // Each test is a fresh process, which holds no fake yet.
    vi.stubGlobal(SHARED_FAKE, undefined);
  });

  it('[TRV-47] answers "not configured" to every call, sending nothing, while no real adapter serves', async () => {
    const storage = (await accessorWith({}))();
    const answers = [
      await storage.checkHealth(CONTEXT),
      await storage.ensureContainer(CONTEXT),
      await storage.upload(NAME, new Uint8Array(1), CONTEXT),
      await storage.list(CONTEXT),
      await storage.delete('1', CONTEXT),
      await storage.download('1', CONTEXT),
    ];

    expect(answers).toStrictEqual([
      NOT_CONFIGURED,
      NOT_CONFIGURED,
      NOT_CONFIGURED,
      NOT_CONFIGURED,
      NOT_CONFIGURED,
      NOT_CONFIGURED,
    ]);
  });

  it('serves the one fake of the process when EGOSCOPE_FAKES names the port', async () => {
    const backupStorage = await accessorWith({ EGOSCOPE_FAKES: 'backup-storage' });
    await backupStorage().ensureContainer(CONTEXT);
    await backupStorage().upload(NAME, new Uint8Array(4), CONTEXT);

    expect(await backupStorage().list(CONTEXT)).toMatchObject({
      ok: true,
      value: [{ id: '1', name: NAME, sizeBytes: 4, complete: true }],
    });
  });

  it('gives one fake to every copy of the module, the one that the accessor serves', async () => {
    vi.stubEnv('EGOSCOPE_FAKES', 'all');
    vi.resetModules();
    const first = await import('./port');
    vi.resetModules();
    const second = await import('./port');
    second.fakeBackupStorage().failNext('checkHealth', { kind: 'unavailable' });

    expect(second).not.toBe(first);
    expect(second.fakeBackupStorage()).toBe(first.fakeBackupStorage());
    expect(first.backupStorage()).toBe(first.fakeBackupStorage());
    expect(await first.backupStorage().checkHealth(CONTEXT)).toMatchObject({
      ok: false,
      error: { kind: 'unavailable' },
    });
  });
});
