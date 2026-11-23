import { describe, expect, it } from 'vitest';

import { BACKUP_STORAGE_CONTRACT } from './contract';

import type { BackupStorage, BackupStorageFailure } from './types';

const UNAVAILABLE: BackupStorageFailure = {
  ok: false,
  error: { kind: 'unavailable' },
  call: { httpRequests: 1, bytesSent: 0, bytesReceived: 0, rateLimitResetsAt: null },
};

async function unavailable(): Promise<BackupStorageFailure> {
  await Promise.resolve();
  return UNAVAILABLE;
}

// A storage that answers every call as an unreachable service does.
const UNREACHABLE: BackupStorage = {
  checkHealth: unavailable,
  ensureContainer: unavailable,
  upload: unavailable,
  list: unavailable,
  delete: unavailable,
  download: unavailable,
};

describe('BACKUP_STORAGE_CONTRACT', () => {
  it.each(Object.entries(BACKUP_STORAGE_CONTRACT))(
    'fails a storage that answers every call unavailable: %s',
    async (_title, run) => {
      const { observed, promised } = await run(() => UNREACHABLE);

      expect(observed).not.toStrictEqual(promised);
    },
  );
});
