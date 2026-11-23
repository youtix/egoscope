import { now, toEpochMs } from '@/lib/time';

import { NOT_CONFIGURED } from './errors';
import { NO_CALLS } from './types';

import type { BackupStorageError } from './errors';
import type {
  BackupStorage,
  BackupStorageOutcome,
  CallContext,
  StoredFile,
  UploadAnswer,
} from './types';

/** The size limit, in bytes, of every storage that the contract runs against, so that a refused file stays small. */
export const CONTRACT_MAX_FILE_BYTES = 8;

/**
 * The condition a storage starts a case in, its container not yet created and
 * its space empty: ready (configured, private, its token valid); its space not
 * private; its token expired or revoked; without its configuration; or ready with
 * its next upload breaking midway.
 */
export type ContractCondition =
  'ready' | 'not_private' | 'token_expired' | 'not_configured' | 'upload_interrupted';

// Makes a storage in `condition`, with CONTRACT_MAX_FILE_BYTES as its size limit.
type ContractStorage = (condition: ContractCondition) => BackupStorage;

// What a case observed, and what the port promises: the test that runs the case asserts they are equal.
type ContractCheck = Readonly<{ observed: unknown; promised: unknown }>;

// Runs one behavior of every backup storage on the storages that `storageIn` makes.
type ContractCase = (storageIn: ContractStorage) => Promise<ContractCheck>;

const CALL_BUDGET_MS = 10_000;
const NAME = 'egoscope-backup-20261116T040000Z-weekly.bin';
const FILE_SIZE = 3;
const UNKNOWN_ID = 'unknown';
const NOT_FOUND = { error: { kind: 'not_found' } };
const TOKEN_REJECTED = { error: { kind: 'unauthorized', cause: 'token_rejected' } };
const TOO_LARGE: BackupStorageError = { kind: 'too_large' };
const UNCONFIGURED = { ok: false, error: NOT_CONFIGURED, call: NO_CALLS };

function context(): CallContext {
  return { deadline: toEpochMs(now() + CALL_BUDGET_MS), signal: new AbortController().signal };
}

// Distinct bytes, so that a file read back shows that every byte came back in order.
function bytesOf(size: number): Uint8Array {
  return Uint8Array.from({ length: size }, (_, index) => index + 1);
}

// What an outcome tells, its cost left out: the value of a success, the error of a failure.
function told<T>(outcome: BackupStorageOutcome<T>): Readonly<{ value: T } | { error: unknown }> {
  return outcome.ok ? { value: outcome.value } : { error: outcome.error };
}

function storedFile(outcome: BackupStorageOutcome<UploadAnswer>): StoredFile | undefined {
  return outcome.ok && outcome.value.kind === 'stored' ? outcome.value.file : undefined;
}

function listedFiles(outcome: BackupStorageOutcome<readonly StoredFile[]>): readonly StoredFile[] {
  return outcome.ok ? outcome.value : [];
}

// The file that a complete upload of `sizeBytes` bytes under NAME stored, as the
// port promises it: the storage's own id and creation instant, and what was sent.
function promisedFile(
  outcome: BackupStorageOutcome<UploadAnswer>,
  sizeBytes: number,
): Readonly<Partial<StoredFile>> {
  return { ...storedFile(outcome), name: NAME, sizeBytes, complete: true };
}

async function bytesRead(
  outcome: BackupStorageOutcome<ReadableStream<Uint8Array>>,
): Promise<readonly number[] | BackupStorageError> {
  return outcome.ok
    ? [...new Uint8Array(await new Response(outcome.value).arrayBuffer())]
    : outcome.error;
}

async function readyStorage(
  storageIn: ContractStorage,
  condition: ContractCondition,
): Promise<BackupStorage> {
  const storage = storageIn(condition);
  await storage.ensureContainer(context());
  return storage;
}

// A ready storage that holds one file of FILE_SIZE bytes under NAME, and the file's id.
async function storageWithFile(
  storageIn: ContractStorage,
): Promise<Readonly<{ storage: BackupStorage; id: string }>> {
  const storage = await readyStorage(storageIn, 'ready');
  const stored = await storage.upload(NAME, bytesOf(FILE_SIZE), context());
  return { storage, id: storedFile(stored)?.id ?? UNKNOWN_ID };
}

/** A first `ensureContainer` creates the container, and the next finds it. */
async function createsItsContainerOnce(storageIn: ContractStorage): Promise<ContractCheck> {
  const storage = storageIn('ready');
  const first = await storage.ensureContainer(context());
  const second = await storage.ensureContainer(context());
  return {
    observed: [told(first), told(second)],
    promised: [{ value: { created: true } }, { value: { created: false } }],
  };
}

/** Before `ensureContainer`, listing and uploading answer `not_found`. */
async function findsNoFileWithoutContainer(storageIn: ContractStorage): Promise<ContractCheck> {
  const storage = storageIn('ready');
  const listing = await storage.list(context());
  const upload = await storage.upload(NAME, bytesOf(FILE_SIZE), context());
  return { observed: [told(listing), told(upload)], promised: [NOT_FOUND, NOT_FOUND] };
}

/** An upload stores one complete file, which the listing reports as the upload did; a second one under its name is told the name is taken (TRV-50). */
async function storesOneNamedFile(storageIn: ContractStorage): Promise<ContractCheck> {
  const storage = await readyStorage(storageIn, 'ready');
  const stored = await storage.upload(NAME, bytesOf(FILE_SIZE), context());
  const taken = await storage.upload(NAME, bytesOf(1), context());
  const listing = await storage.list(context());
  const file = promisedFile(stored, FILE_SIZE);
  return {
    observed: [told(stored), told(taken), told(listing)],
    promised: [
      { value: { kind: 'stored', file } },
      { value: { kind: 'name_taken' } },
      { value: [file] },
    ],
  };
}

/** A deleted file leaves the listing, cannot be read or deleted again (TRV-50, CL-TRV-04). */
async function deletesForGood(storageIn: ContractStorage): Promise<ContractCheck> {
  const { storage, id } = await storageWithFile(storageIn);
  const deleted = await storage.delete(id, context());
  const listing = await storage.list(context());
  const downloaded = await storage.download(id, context());
  const again = await storage.delete(id, context());
  return {
    observed: [told(deleted), told(listing), told(downloaded), told(again)],
    promised: [{ value: null }, { value: [] }, NOT_FOUND, NOT_FOUND],
  };
}

/** A download streams back the bytes that were sent, and an unknown file is `not_found` (TRV-53). */
async function streamsFileBack(storageIn: ContractStorage): Promise<ContractCheck> {
  const { storage, id } = await storageWithFile(storageIn);
  const downloaded = await storage.download(id, context());
  const unknown = await storage.download(UNKNOWN_ID, context());
  return {
    observed: [await bytesRead(downloaded), told(unknown)],
    promised: [[...bytesOf(FILE_SIZE)], NOT_FOUND],
  };
}

/** A file one byte above the limit is `too_large` at no cost and stores nothing; a file at the limit is stored. */
async function refusesLargerFile(storageIn: ContractStorage): Promise<ContractCheck> {
  const storage = await readyStorage(storageIn, 'ready');
  const refused = await storage.upload(NAME, bytesOf(CONTRACT_MAX_FILE_BYTES + 1), context());
  const listing = await storage.list(context());
  const atLimit = await storage.upload(NAME, bytesOf(CONTRACT_MAX_FILE_BYTES), context());
  return {
    observed: [refused, told(listing), told(atLimit)],
    promised: [
      { ok: false, error: TOO_LARGE, call: NO_CALLS },
      { value: [] },
      { value: { kind: 'stored', file: promisedFile(atLimit, CONTRACT_MAX_FILE_BYTES) } },
    ],
  };
}

/** The health check says whether the space is private, in one request at most (TRV-47, CL-TRV-04). */
async function reportsPrivacy(storageIn: ContractStorage): Promise<ContractCheck> {
  const answers = [
    await storageIn('ready').checkHealth(context()),
    await storageIn('not_private').checkHealth(context()),
  ];
  return {
    observed: answers.map((answer) => [told(answer), answer.call.httpRequests <= 1]),
    promised: [
      [{ value: { private: true } }, true],
      [{ value: { private: false } }, true],
    ],
  };
}

/** An upload into a space that is not private sends no byte and stores nothing (TRV-56, CL-TRV-04). */
async function keepsPublicSpaceEmpty(storageIn: ContractStorage): Promise<ContractCheck> {
  const storage = await readyStorage(storageIn, 'not_private');
  const upload = await storage.upload(NAME, bytesOf(FILE_SIZE), context());
  const listing = await storage.list(context());
  return {
    observed: [told(upload), upload.call.bytesSent, told(listing)],
    promised: [{ value: { kind: 'not_private' } }, 0, { value: [] }],
  };
}

/** An expired or revoked token makes calls `unauthorized`, with that cause (TRV-47). */
async function reportsRejectedToken(storageIn: ContractStorage): Promise<ContractCheck> {
  const storage = storageIn('token_expired');
  const answers: readonly BackupStorageOutcome<unknown>[] = [
    await storage.checkHealth(context()),
    await storage.ensureContainer(context()),
    await storage.list(context()),
  ];
  return {
    observed: answers.map((answer) => told(answer)),
    promised: [TOKEN_REJECTED, TOKEN_REJECTED, TOKEN_REJECTED],
  };
}

/** Without its space or its token, every call is `unauthorized` as not configured, at no cost (TRV-47). */
async function reportsMissingConfiguration(storageIn: ContractStorage): Promise<ContractCheck> {
  const storage = storageIn('not_configured');
  const answers: readonly BackupStorageOutcome<unknown>[] = [
    await storage.checkHealth(context()),
    await storage.ensureContainer(context()),
    await storage.upload(NAME, bytesOf(FILE_SIZE), context()),
    await storage.list(context()),
    await storage.delete(UNKNOWN_ID, context()),
    await storage.download(UNKNOWN_ID, context()),
  ];
  return { observed: answers, promised: answers.map(() => UNCONFIGURED) };
}

/** An interrupted upload is `unavailable` and leaves an incomplete file, which the next upload of its name deletes first. */
async function replacesHalfCreatedFile(storageIn: ContractStorage): Promise<ContractCheck> {
  const storage = await readyStorage(storageIn, 'upload_interrupted');
  const interrupted = await storage.upload(NAME, bytesOf(FILE_SIZE), context());
  const leftover = await storage.list(context());
  const retried = await storage.upload(NAME, bytesOf(FILE_SIZE), context());
  const listing = await storage.list(context());
  const file = promisedFile(retried, FILE_SIZE);
  return {
    observed: [told(interrupted), told(leftover), told(retried), told(listing)],
    promised: [
      { error: { kind: 'unavailable' } },
      { value: [{ ...listedFiles(leftover)[0], name: NAME, complete: false }] },
      { value: { kind: 'stored', file } },
      { value: [file] },
    ],
  };
}

/**
 * The behaviors that every backup storage shows, the fake and each real adapter
 * alike, by title, which the port's colocated tests run (module map §2.3): one
 * container created once; one named file per upload, a taken name reported; a
 * listing with names, sizes and creation instants (TRV-50); true deletion
 * (TRV-50, CL-TRV-04); a file streamed back (TRV-53); a file above the size limit
 * refused before any byte is sent; the space's privacy, and no upload into a space
 * that is not private (TRV-56, CL-TRV-04); an unconfigured storage and a rejected
 * token reported with their cause (TRV-47); and the half-created file of an
 * interrupted upload deleted before the file is sent again.
 */
export const BACKUP_STORAGE_CONTRACT: Readonly<Record<string, ContractCase>> = {
  'creates its container once, then finds it': createsItsContainerOnce,
  'finds no file while its container does not exist': findsNoFileWithoutContainer,
  '[TRV-50] stores one named file, lists its name, size and creation instant, and reports its name taken':
    storesOneNamedFile,
  '[TRV-50] [CL-TRV-04] deletes a file for good: no listing and no address returns it':
    deletesForGood,
  '[TRV-53] streams a stored file back, byte for byte': streamsFileBack,
  'refuses a file above its size limit before sending any byte, and stores one at the limit':
    refusesLargerFile,
  '[TRV-47] [CL-TRV-04] reports whether its space is private, in one request at most':
    reportsPrivacy,
  '[TRV-56] [CL-TRV-04] uploads nothing into a space that is not private': keepsPublicSpaceEmpty,
  '[TRV-47] reports an expired or revoked token as unauthorized': reportsRejectedToken,
  '[TRV-47] answers "not configured" to every call without its configuration, sending nothing':
    reportsMissingConfiguration,
  'deletes the half-created file of an interrupted upload before it sends the file again':
    replacesHalfCreatedFile,
};
