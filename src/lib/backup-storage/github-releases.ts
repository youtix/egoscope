// The backup storage on GitHub (backup storage sheet, "How it is called"): one release
// asset per backup in the draft release `backups` of the owner's private repository,
// over the HTTP layer of github-http.ts.
import { z } from 'zod';

import { parseTimestamp } from '@/lib/time';

import { NOT_CONFIGURED } from './errors';
import {
  API,
  CREATED,
  errorOf,
  fail,
  FOUND,
  GithubCall,
  NO_CONTENT,
  OCTET_STREAM,
  parsedJson,
  succeed,
  UNAVAILABLE,
  UNPROCESSABLE,
  UPLOADS,
} from './github-http';
import { NO_CALLS } from './types';

import type { BackupStorageError } from './errors';
import type { Step } from './github-http';
import type {
  BackupStorage,
  BackupStorageFailure,
  BackupStorageOutcome,
  CallContext,
  ContainerAnswer,
  StorageHealth,
  StoredFile,
  UploadAnswer,
} from './types';
import type { Secret } from '@/lib/env';

/**
 * What the adapter needs: the repository (`owner/repository`) and the token, the
 * storage being "not configured" without either; the size limit of one file; and the
 * HTTP client.
 */
export type GithubReleasesConfig = Readonly<{
  repository: string | undefined;
  token: Secret | undefined;
  maxFileBytes: number;
  fetch: typeof fetch;
}>;

/** A file on its way into the draft release. */
type Upload = Readonly<{ releaseId: number; name: string; bytes: Uint8Array<ArrayBuffer> }>;

// The tag and the name of the draft release that holds every backup (sheet, step 1).
const RELEASE = 'backups';
const NEW_RELEASE = new TextEncoder().encode(
  JSON.stringify(
    Object.fromEntries([
      ['tag_name', RELEASE],
      ['name', RELEASE],
      ['draft', true],
    ]),
  ),
);
const PER_PAGE = 100;
const UPLOADED = 'uploaded';
const ASSET_ID = /^\d+$/u;
const NOT_FOUND: BackupStorageError = { kind: 'not_found' };
const TOO_LARGE: BackupStorageError = { kind: 'too_large' };

const repositorySchema = z.object({ private: z.boolean() });
const releaseSchema = z.object({
  id: z.number().int(),
  name: z.string().nullable(),
  draft: z.boolean(),
});
// GitHub writes the creation instant under `created_at`, which the schema reads as `createdAt`.
const assetSchema = z.preprocess(
  (raw) =>
    typeof raw === 'object' && raw !== null && 'created_at' in raw
      ? { ...raw, createdAt: raw.created_at }
      : raw,
  z.object({
    id: z.number().int(),
    name: z.string(),
    size: z.number().int(),
    state: z.string(),
    createdAt: z.string(),
  }),
);

type Asset = z.infer<typeof assetSchema>;

/** An asset as the port reports a file: complete once its state is `uploaded`. */
function storedFileOf(asset: Asset): Step<StoredFile> {
  const created = parseTimestamp(asset.createdAt);
  return created.ok && created.timestamp.kind === 'instant'
    ? succeed({
        id: String(asset.id),
        name: asset.name,
        sizeBytes: asset.size,
        createdAt: created.timestamp.at,
        complete: asset.state === UPLOADED,
      })
    : fail(UNAVAILABLE);
}

/** What an upload that GitHub took stored: the file, when the asset is `uploaded` at the size sent. */
function storedAnswer(text: string, sizeBytes: number): Step<UploadAnswer> {
  const asset = parsedJson(assetSchema, text);
  if (!asset.ok) {
    return asset;
  }
  if (asset.value.state !== UPLOADED || asset.value.size !== sizeBytes) {
    return fail(UNAVAILABLE);
  }
  const file = storedFileOf(asset.value);
  return file.ok ? succeed({ kind: 'stored', file: file.value }) : file;
}

/** The draft release of one repository, its id kept once found. */
class GithubReleases {
  readonly #repository: string;
  readonly #api: string;
  readonly #token: Secret;
  readonly #fetch: typeof fetch;
  #releaseId: number | null = null;

  constructor(repository: string, token: Secret, fetcher: typeof fetch) {
    this.#repository = repository;
    this.#api = `${API}/repos/${repository}`;
    this.#token = token;
    this.#fetch = fetcher;
  }

  #assetUrl(id: string): string {
    return `${this.#api}/releases/assets/${id}`;
  }

  /** The draft release's id, or nothing when the repository has none. */
  async #foundRelease(call: GithubCall): Promise<Step<number | null>> {
    if (this.#releaseId !== null) {
      return succeed(this.#releaseId);
    }
    const url = `${this.#api}/releases?per_page=${String(PER_PAGE)}`;
    const releases = await call.pages(url, releaseSchema);
    if (!releases.ok) {
      return releases;
    }
    const found = releases.value.find((release) => release.draft && release.name === RELEASE);
    this.#releaseId = found?.id ?? null;
    return succeed(this.#releaseId);
  }

  async #release(call: GithubCall): Promise<Step<number>> {
    const found = await this.#foundRelease(call);
    if (!found.ok) {
      return found;
    }
    return found.value === null ? fail(NOT_FOUND) : succeed(found.value);
  }

  /** Posts the asset; a taken name sends the call to `#replaceTaken`, once (sheet, step 2). */
  async #send(call: GithubCall, upload: Upload, canRetry: boolean): Promise<Step<UploadAnswer>> {
    const { releaseId, name, bytes } = upload;
    const address = `${UPLOADS}/repos/${this.#repository}/releases/${String(releaseId)}/assets`;
    const url = `${address}?name=${encodeURIComponent(name)}`;
    const body = { bytes, type: OCTET_STREAM };
    const answer = await call.read({ url, method: 'POST', body }, [CREATED, UNPROCESSABLE]);
    if (!answer.ok) {
      return answer;
    }
    if (answer.value.status === CREATED) {
      return storedAnswer(answer.value.text, bytes.byteLength);
    }
    return canRetry ? this.#replaceTaken(call, upload) : fail(UNAVAILABLE);
  }

  /** The file that holds a refused name: a complete one is reported, the half-created one of a broken upload deleted before the file is sent again. */
  async #replaceTaken(call: GithubCall, upload: Upload): Promise<Step<UploadAnswer>> {
    const files = await this.files(call);
    if (!files.ok) {
      return files;
    }
    const taken = files.value.find((file) => file.name === upload.name);
    if (taken === undefined || taken.complete) {
      return taken === undefined ? fail(UNAVAILABLE) : succeed({ kind: 'name_taken' });
    }
    const deleted = await this.delete(call, taken.id);
    return deleted.ok ? this.#send(call, upload, false) : deleted;
  }

  /** Runs `body` as one call inside `ctx`. */
  async run<T>(
    ctx: CallContext,
    body: (call: GithubCall) => Promise<Step<T>>,
  ): Promise<BackupStorageOutcome<T>> {
    const call = new GithubCall(this.#fetch, this.#token, ctx);
    return call.outcome(await body(call));
  }

  /** Whether the repository is private, from its own endpoint (CL-TRV-04). */
  async health(call: GithubCall): Promise<Step<StorageHealth>> {
    const answer = await call.read({ url: this.#api });
    return answer.ok ? parsedJson(repositorySchema, answer.value.text) : answer;
  }

  /** Finds the draft release `backups`, or creates it (sheet, step 1). */
  async ensureRelease(call: GithubCall): Promise<Step<ContainerAnswer>> {
    const found = await this.#foundRelease(call);
    if (!found.ok) {
      return found;
    }
    if (found.value !== null) {
      return succeed({ created: false });
    }
    const body = { bytes: NEW_RELEASE, type: 'application/json' };
    const url = `${this.#api}/releases`;
    const answer = await call.read({ url, method: 'POST', body }, [CREATED]);
    const release = answer.ok ? parsedJson(releaseSchema, answer.value.text) : answer;
    if (!release.ok) {
      return release;
    }
    this.#releaseId = release.value.id;
    return succeed({ created: true });
  }

  /** Checks that the repository is private, then sends the file as one asset (sheet, step 2; TRV-56). */
  async upload(call: GithubCall, name: string, bytes: Uint8Array): Promise<Step<UploadAnswer>> {
    const health = await this.health(call);
    if (!health.ok) {
      return health;
    }
    if (!health.value.private) {
      return succeed({ kind: 'not_private' });
    }
    const release = await this.#release(call);
    return release.ok
      ? this.#send(call, { releaseId: release.value, name, bytes: Uint8Array.from(bytes) }, true)
      : release;
  }

  /** The files of the draft release, page after page, with their creation instants (TRV-50). */
  async files(call: GithubCall): Promise<Step<readonly StoredFile[]>> {
    const release = await this.#release(call);
    if (!release.ok) {
      return release;
    }
    const url = `${this.#api}/releases/${String(release.value)}/assets?per_page=${String(PER_PAGE)}`;
    const assets = await call.pages(url, assetSchema);
    if (!assets.ok) {
      return assets;
    }
    const files = assets.value.flatMap((asset) => {
      const file = storedFileOf(asset);
      return file.ok ? [file.value] : [];
    });
    return files.length === assets.value.length ? succeed(files) : fail(UNAVAILABLE);
  }

  /** Deletes an asset for good, through the interface (sheet, step 3; CL-TRV-04). */
  async delete(call: GithubCall, id: string): Promise<Step<null>> {
    if (!ASSET_ID.test(id)) {
      return fail(NOT_FOUND);
    }
    const answer = await call.read({ url: this.#assetUrl(id), method: 'DELETE' }, [NO_CONTENT]);
    return answer.ok ? succeed(null) : answer;
  }

  /** Streams an asset back, following the redirect to its file without the token (sheet, step 4; TRV-53). */
  async download(call: GithubCall, id: string): Promise<Step<ReadableStream<Uint8Array>>> {
    if (!ASSET_ID.test(id)) {
      return fail(NOT_FOUND);
    }
    const answer = await call.send({ url: this.#assetUrl(id), accept: OCTET_STREAM });
    if (answer?.status !== FOUND) {
      return call.stream(answer, errorOf);
    }
    await answer.body?.cancel();
    const location = answer.headers.get('location');
    const file =
      location === null
        ? undefined
        : await call.send({ url: location, accept: OCTET_STREAM }, false);
    return call.stream(file, () => UNAVAILABLE);
  }
}

// Answers once the current turn of the event loop ends, as every storage call does.
async function refuseUnconfigured(): Promise<BackupStorageFailure> {
  await Promise.resolve();
  return { ok: false, error: NOT_CONFIGURED, call: NO_CALLS };
}

// A storage without its repository or its token: every call "not configured", no request sent (TRV-47).
const UNCONFIGURED_STORAGE: BackupStorage = {
  checkHealth: refuseUnconfigured,
  ensureContainer: refuseUnconfigured,
  upload: refuseUnconfigured,
  list: refuseUnconfigured,
  delete: refuseUnconfigured,
  download: refuseUnconfigured,
};

/**
 * The backup storage in the draft release `backups` of the owner's private GitHub
 * repository (module map §5, ADR 0018, backup storage sheet): the release created
 * once; one asset per backup, under the size limit, sent only once the repository is
 * found private and checked `uploaded` at its size, a taken name reported and the
 * half-created asset of a broken upload deleted before the retry (TRV-50, TRV-56,
 * CL-TRV-04); the assets listed with their creation instants, deleted for good
 * (TRV-50) and streamed back (TRV-53); an expired or revoked token reported as
 * rejected, and every call "not configured" at no request without the repository or
 * the token (TRV-47). The token goes only into GitHub's Authorization header (TRV-64);
 * each call reports its requests, bytes and rate-limit reset (TRV-03, CL-TRV-12).
 */
export function createGithubReleasesStorage(config: GithubReleasesConfig): BackupStorage {
  const { repository, token, maxFileBytes } = config;
  if (repository === undefined || token === undefined) {
    return UNCONFIGURED_STORAGE;
  }
  const releases = new GithubReleases(repository, token, config.fetch);
  return {
    checkHealth: async (ctx) => releases.run(ctx, async (call) => releases.health(call)),
    ensureContainer: async (ctx) => releases.run(ctx, async (call) => releases.ensureRelease(call)),
    upload: async (name, bytes, ctx) =>
      bytes.byteLength > maxFileBytes
        ? { ok: false, error: TOO_LARGE, call: NO_CALLS }
        : releases.run(ctx, async (call) => releases.upload(call, name, bytes)),
    list: async (ctx) => releases.run(ctx, async (call) => releases.files(call)),
    delete: async (id, ctx) => releases.run(ctx, async (call) => releases.delete(call, id)),
    download: async (id, ctx) => releases.run(ctx, async (call) => releases.download(call, id)),
  };
}
