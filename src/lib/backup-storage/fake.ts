import { now } from '@/lib/time';

import { NOT_CONFIGURED } from './errors';
import { NO_CALLS } from './types';

import type { BackupStorageError } from './errors';
import type {
  BackupStorage,
  BackupStorageFailure,
  BackupStorageOperation,
  BackupStorageOutcome,
  CallMetadata,
  ContainerAnswer,
  StorageHealth,
  StoredFile,
  UploadAnswer,
} from './types';
import type { EpochMs } from '@/lib/time';

/** How the fake's space lets the app in: with a valid token, an expired one, or no configuration at all. */
export type FakeAccess = 'granted' | 'token_expired' | 'not_configured';

/** The in-memory backup storage of tests, development and the hermetic mode, with its failure scripts. */
export type FakeBackupStorage = BackupStorage &
  Readonly<{
    /** From now on, lets the app in as `access` says. */
    setAccess: (access: FakeAccess) => void;
    /** From now on, the space is private or not. */
    setPrivate: (isPrivate: boolean) => void;
    /**
     * The next call of `operation` that reaches the space fails with `error` and changes
     * nothing, reporting `rateLimitResetsAt` when given (CL-TRV-12): a call refused
     * before, for a file too large, no configuration or an expired token, leaves the
     * script in place.
     */
    failNext: (
      operation: BackupStorageOperation,
      error: BackupStorageError,
      rateLimitResetsAt?: EpochMs,
    ) => void;
    /** The next upload that reaches the container fails midway and leaves an empty, half-created file. */
    interruptNextUpload: () => void;
    /** The next deletion of a file answers that it succeeded but leaves the file in place. */
    keepNextDeletion: () => void;
  }>;

type HeldFile = Readonly<{ file: StoredFile; bytes: Uint8Array }>;
// A failure scripted for an operation, with the instant its call reports the quota resets.
type ScriptedFailure = Readonly<{ error: BackupStorageError; rateLimitResetsAt: EpochMs | null }>;

const TOKEN_REJECTED: BackupStorageError = { kind: 'unauthorized', cause: 'token_rejected' };
const NOT_FOUND: BackupStorageError = { kind: 'not_found' };
const TOO_LARGE: BackupStorageError = { kind: 'too_large' };
const UNAVAILABLE: BackupStorageError = { kind: 'unavailable' };
// The request that checks that the space is private, before every upload (CL-TRV-04).
const PRIVACY_CHECK = 1;

function cost(httpRequests: number, bytesSent = 0, bytesReceived = 0): CallMetadata {
  return { httpRequests, bytesSent, bytesReceived, rateLimitResetsAt: null };
}

function succeeded<T>(value: T, call: CallMetadata): BackupStorageOutcome<T> {
  return { ok: true, value, call };
}

function failed(error: BackupStorageError, call: CallMetadata): BackupStorageFailure {
  return { ok: false, error, call };
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
}

// Runs a call once the current turn of the event loop ends, as a call across the
// network answers, so that no caller can count on an answer in the same turn.
async function later<T>(call: () => T): Promise<T> {
  await Promise.resolve();
  return call();
}

// The fake's space: one container, the files it holds, and the scripts that make its calls fail.
class FakeSpace {
  readonly #maxFileBytes: number;
  readonly #failures = new Map<BackupStorageOperation, ScriptedFailure>();
  #files: readonly HeldFile[] = [];
  #access: FakeAccess = 'granted';
  #isPrivate = true;
  #hasContainer = false;
  #lastId = 0;
  #willInterruptUpload = false;
  #willKeepDeletion = false;

  constructor(maxFileBytes: number) {
    this.#maxFileBytes = maxFileBytes;
  }

  // The refusal that a call meets before it reaches the space: no configuration, a
  // rejected token, or the failure scripted for its operation, which it uses up.
  #refusal(operation: BackupStorageOperation): BackupStorageFailure | null {
    if (this.#access === 'not_configured') {
      return failed(NOT_CONFIGURED, NO_CALLS);
    }
    if (this.#access === 'token_expired') {
      return failed(TOKEN_REJECTED, cost(1));
    }
    const scripted = this.#failures.get(operation);
    this.#failures.delete(operation);
    return scripted === undefined
      ? null
      : failed(scripted.error, { ...cost(1), rateLimitResetsAt: scripted.rateLimitResetsAt });
  }

  // A call on the files meets the same refusals, then needs the container.
  #containerRefusal(operation: BackupStorageOperation): BackupStorageFailure | null {
    const refused = this.#refusal(operation);
    return refused ?? (this.#hasContainer ? null : failed(NOT_FOUND, cost(1)));
  }

  #held(id: string): HeldFile | undefined {
    return this.#files.find((held) => held.file.id === id);
  }

  #remove(id: string): void {
    this.#files = this.#files.filter((held) => held.file.id !== id);
  }

  // Sends the file into the space, after deleting the half-created file of an
  // interrupted upload of the same name, which holds the name otherwise.
  #send(name: string, bytes: Uint8Array): BackupStorageOutcome<UploadAnswer> {
    const leftover = this.#files.find((held) => held.file.name === name);
    if (leftover?.file.complete === true) {
      return succeeded({ kind: 'name_taken' }, cost(PRIVACY_CHECK + 1));
    }
    let deletions = 0;
    if (leftover !== undefined) {
      this.#remove(leftover.file.id);
      deletions = 1;
    }
    const call = cost(PRIVACY_CHECK + deletions + 1, bytes.byteLength);
    const file = this.#hold(name, bytes);
    return file.complete ? succeeded({ kind: 'stored', file }, call) : failed(UNAVAILABLE, call);
  }

  // Keeps a copy of `bytes` under `name` or, when the upload is scripted to break,
  // only the empty, half-created file that the interruption leaves.
  #hold(name: string, bytes: Uint8Array): StoredFile {
    const isComplete = !this.#willInterruptUpload;
    const kept = isComplete ? new Uint8Array(bytes) : new Uint8Array();
    this.#willInterruptUpload = false;
    this.#lastId += 1;
    const file: StoredFile = {
      id: String(this.#lastId),
      name,
      sizeBytes: kept.byteLength,
      createdAt: now(),
      complete: isComplete,
    };
    this.#files = [...this.#files, { file, bytes: kept }];
    return file;
  }

  setAccess(access: FakeAccess): void {
    this.#access = access;
  }

  setPrivate(isPrivate: boolean): void {
    this.#isPrivate = isPrivate;
  }

  failNext(
    operation: BackupStorageOperation,
    error: BackupStorageError,
    rateLimitResetsAt: EpochMs | null,
  ): void {
    this.#failures.set(operation, { error, rateLimitResetsAt });
  }

  interruptNextUpload(): void {
    this.#willInterruptUpload = true;
  }

  keepNextDeletion(): void {
    this.#willKeepDeletion = true;
  }

  checkHealth(): BackupStorageOutcome<StorageHealth> {
    return this.#refusal('checkHealth') ?? succeeded({ private: this.#isPrivate }, cost(1));
  }

  ensureContainer(): BackupStorageOutcome<ContainerAnswer> {
    const refused = this.#refusal('ensureContainer');
    if (refused !== null) {
      return refused;
    }
    const wasMissing = !this.#hasContainer;
    this.#hasContainer = true;
    return succeeded({ created: wasMissing }, cost(1));
  }

  upload(name: string, bytes: Uint8Array): BackupStorageOutcome<UploadAnswer> {
    if (bytes.byteLength > this.#maxFileBytes) {
      return failed(TOO_LARGE, NO_CALLS);
    }
    const refused = this.#containerRefusal('upload');
    if (refused !== null) {
      return refused;
    }
    return this.#isPrivate
      ? this.#send(name, bytes)
      : succeeded({ kind: 'not_private' }, cost(PRIVACY_CHECK));
  }

  list(): BackupStorageOutcome<readonly StoredFile[]> {
    const files = this.#files.map((held) => held.file);
    return this.#containerRefusal('list') ?? succeeded(files, cost(1));
  }

  delete(id: string): BackupStorageOutcome<null> {
    const refused = this.#containerRefusal('delete');
    if (refused !== null) {
      return refused;
    }
    if (this.#held(id) === undefined) {
      return failed(NOT_FOUND, cost(1));
    }
    if (!this.#willKeepDeletion) {
      this.#remove(id);
    }
    this.#willKeepDeletion = false;
    return succeeded(null, cost(1));
  }

  download(id: string): BackupStorageOutcome<ReadableStream<Uint8Array>> {
    const refused = this.#containerRefusal('download');
    if (refused !== null) {
      return refused;
    }
    const held = this.#held(id);
    return held === undefined
      ? failed(NOT_FOUND, cost(1))
      : succeeded(streamOf(held.bytes), cost(1, 0, held.bytes.byteLength));
  }
}

/**
 * An in-memory backup storage with one container and a size limit of
 * `maxFileBytes`, private and open to the app until a script says otherwise
 * (module map §5): it deletes for real (TRV-50, CL-TRV-04), refuses a larger file
 * before sending anything, streams a file back (TRV-53), and its scripts make a
 * call fail, interrupt an upload, keep a deleted file, expire the token or remove
 * the configuration (TRV-47).
 */
export function createFakeBackupStorage(
  scenario: Readonly<{ maxFileBytes: number }>,
): FakeBackupStorage {
  const space = new FakeSpace(scenario.maxFileBytes);
  return {
    checkHealth: async () => later(() => space.checkHealth()),
    ensureContainer: async () => later(() => space.ensureContainer()),
    upload: async (name, bytes) => later(() => space.upload(name, bytes)),
    list: async () => later(() => space.list()),
    delete: async (id) => later(() => space.delete(id)),
    download: async (id) => later(() => space.download(id)),
    setAccess: (access) => {
      space.setAccess(access);
    },
    setPrivate: (isPrivate) => {
      space.setPrivate(isPrivate);
    },
    failNext: (operation, error, rateLimitResetsAt) => {
      space.failNext(operation, error, rateLimitResetsAt ?? null);
    },
    interruptNextUpload: () => {
      space.interruptNextUpload();
    },
    keepNextDeletion: () => {
      space.keepNextDeletion();
    },
  };
}
