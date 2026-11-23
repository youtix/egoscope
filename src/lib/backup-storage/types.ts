import type { BackupStorageError } from './errors';
import type { EpochMs } from '@/lib/time';

/** The bounds of one call inside the tick budget: the instant it must end by, and the signal that cancels it. */
export type CallContext = Readonly<{ deadline: EpochMs; signal: AbortSignal }>;

/**
 * What one call cost, which `quotas.withQuota` records (TRV-03, TRV-04): its
 * HTTP requests, the bytes it sent and received, and the instant the provider says its
 * request window resets, when it says so (CL-TRV-12).
 */
export type CallMetadata = Readonly<{
  httpRequests: number;
  bytesSent: number;
  bytesReceived: number;
  rateLimitResetsAt: EpochMs | null;
}>;

/** The metadata of a call refused before any request: it cost nothing. */
export const NO_CALLS: CallMetadata = {
  httpRequests: 0,
  bytesSent: 0,
  bytesReceived: 0,
  rateLimitResetsAt: null,
};

/**
 * A file of the backup storage as a listing reports it (TRV-50): `complete` is
 * false for the half-created file that an interrupted upload left behind.
 */
export type StoredFile = Readonly<{
  id: string;
  name: string;
  sizeBytes: number;
  createdAt: EpochMs;
  complete: boolean;
}>;

/**
 * What an upload did: stored the file; found its name taken by a complete file;
 * or found the space not private and sent nothing (CL-TRV-04, TRV-56).
 */
export type UploadAnswer =
  | Readonly<{ kind: 'stored'; file: StoredFile }>
  | Readonly<{ kind: 'name_taken' }>
  | Readonly<{ kind: 'not_private' }>;

/** What the health check found: whether the space is private (TRV-47, CL-TRV-04). */
export type StorageHealth = Readonly<{ private: boolean }>;

/** What `ensureContainer` did: created the container, or found it there. */
export type ContainerAnswer = Readonly<{ created: boolean }>;

/** A call that failed, with what it cost. */
export type BackupStorageFailure = Readonly<{
  ok: false;
  error: BackupStorageError;
  call: CallMetadata;
}>;

/** The answer to one call: its value or its error, with what the call cost. */
export type BackupStorageOutcome<T> =
  Readonly<{ ok: true; value: T; call: CallMetadata }> | BackupStorageFailure;

/**
 * The backup storage (module map §5): one container that holds one encrypted
 * file per backup (TRV-50, ADR 0018). `checkHealth` makes one request at most
 * (TRV-47); `upload` refuses a file above the size limit before sending any byte,
 * deletes the half-created file of an interrupted upload of the same name before
 * it sends the file again, and checks first that the space is private
 * (CL-TRV-04); `delete` removes a file for good; `download` streams a file back
 * (TRV-53).
 */
export type BackupStorage = Readonly<{
  checkHealth: (context: CallContext) => Promise<BackupStorageOutcome<StorageHealth>>;
  ensureContainer: (context: CallContext) => Promise<BackupStorageOutcome<ContainerAnswer>>;
  upload: (
    name: string,
    bytes: Uint8Array,
    context: CallContext,
  ) => Promise<BackupStorageOutcome<UploadAnswer>>;
  list: (context: CallContext) => Promise<BackupStorageOutcome<readonly StoredFile[]>>;
  delete: (id: string, context: CallContext) => Promise<BackupStorageOutcome<null>>;
  download: (
    id: string,
    context: CallContext,
  ) => Promise<BackupStorageOutcome<ReadableStream<Uint8Array>>>;
}>;

/** One operation of the backup storage, which the fake can make fail. */
export type BackupStorageOperation = keyof BackupStorage;
