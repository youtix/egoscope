import { adapterFor, readServerEnv } from '@/lib/env';

import { createFakeBackupStorage } from './fake';
import { createGithubReleasesStorage } from './github-releases';

import type { FakeBackupStorage } from './fake';
import type { BackupStorage } from './types';

const BYTES_PER_GIB = 1_073_741_824;
// Each release asset must be under 2 GiB (backup storage sheet, "Limits").
const MAX_FILE_BYTES = 2 * BYTES_PER_GIB - 1;

// The process's one fake, empty at start: what one call stores, the next lists. It
// lives on globalThis under a registered symbol, so that every copy of this module
// (a bundle layer of the server, a reload of `next dev`) serves the same files and
// the same scripts.
const SHARED_FAKE = Symbol.for('egoscope.backup-storage.fake');

const isFake = (value: unknown): value is FakeBackupStorage =>
  typeof value === 'object' && value !== null && 'failNext' in value;

/**
 * The fake that the whole process shares, created at its first use, which the
 * accessor serves under EGOSCOPE_FAKES and the hermetic end-to-end controls script
 * (TRV-47, TRV-50).
 */
export function fakeBackupStorage(): FakeBackupStorage {
  const existing: unknown = Reflect.get(globalThis, SHARED_FAKE);
  if (isFake(existing)) {
    return existing;
  }
  const fake = createFakeBackupStorage({ maxFileBytes: MAX_FILE_BYTES });
  Reflect.set(globalThis, SHARED_FAKE, fake);
  return fake;
}

/**
 * The backup storage of this server, which `env.adapterFor` chooses (TRV-50, ADR
 * 0018): the process's one fake; otherwise the GitHub release-asset adapter, which
 * answers every call "not configured", sending nothing, while the configuration lacks
 * the repository or the token, or is invalid (TRV-47).
 */
export function backupStorage(): BackupStorage {
  if (adapterFor('backup-storage') === 'fake') {
    return fakeBackupStorage();
  }
  const env = readServerEnv();
  return createGithubReleasesStorage({
    repository: env.ok ? env.env.BACKUP_GITHUB_REPOSITORY : undefined,
    token: env.ok ? env.env.BACKUP_GITHUB_TOKEN : undefined,
    maxFileBytes: MAX_FILE_BYTES,
    fetch,
  });
}
