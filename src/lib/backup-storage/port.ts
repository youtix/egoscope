import { adapterFor } from '@/lib/env';

import { NOT_CONFIGURED } from './errors';
import { createFakeBackupStorage } from './fake';
import { NO_CALLS } from './types';

import type { BackupStorage, BackupStorageFailure } from './types';

const BYTES_PER_GIB = 1_073_741_824;
// Each release asset must be under 2 GiB (backup storage sheet, "Limits").
const MAX_FILE_BYTES = 2 * BYTES_PER_GIB - 1;

// Answers once the current turn of the event loop ends, as every storage call does.
async function refuseUnconfigured(): Promise<BackupStorageFailure> {
  await Promise.resolve();
  return { ok: false, error: NOT_CONFIGURED, meta: NO_CALLS };
}

// The real adapter's place while this build holds none: a storage without its
// configuration, which answers every call "not configured" and sends nothing.
const UNCONFIGURED_STORAGE: BackupStorage = {
  checkHealth: refuseUnconfigured,
  ensureContainer: refuseUnconfigured,
  upload: refuseUnconfigured,
  list: refuseUnconfigured,
  delete: refuseUnconfigured,
  download: refuseUnconfigured,
};

// The process's one fake, empty at start: what one call stores, the next lists.
const SHARED_FAKE = createFakeBackupStorage({ maxFileBytes: MAX_FILE_BYTES });

/**
 * The backup storage of this server, which `env.adapterFor` chooses (TRV-50, ADR
 * 0018): the process's one fake; otherwise the real adapter, which this build does
 * not hold yet, and in its place a storage that answers every call "not
 * configured", sending nothing (TRV-47).
 */
export function backupStorage(): BackupStorage {
  return adapterFor('backup-storage') === 'fake' ? SHARED_FAKE : UNCONFIGURED_STORAGE;
}
