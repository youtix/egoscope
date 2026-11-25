import { describe, expect, it } from 'vitest';

import { parseServerEnv } from '@/lib/env';
import { now, parseTimestamp, toEpochMs } from '@/lib/time';
import asset from '@data/fixtures/backup-storage/asset.json';
import errors from '@data/fixtures/backup-storage/errors.json';
import repository from '@data/fixtures/backup-storage/repository.json';

import { BACKUP_STORAGE_CONTRACT, CONTRACT_MAX_FILE_BYTES } from './contract';
import { createGithubReleasesStorage } from './github-releases';
import { FILE_HOST, FIRST_REPLAY_ID, GithubReplay, REPLAY_REPOSITORY } from './github-replay';

import type { ContractCondition } from './contract';
import type { Seen } from './github-replay';
import type { BackupStorage, BackupStorageOutcome, CallContext } from './types';
import type { Secret } from '@/lib/env';
import type { EpochMs } from '@/lib/time';

const TOKEN = 'invented-token-for-tests';
const OTHER_TOKEN = 'invented-token-not-accepted';
const API = `https://api.github.com/repos/${REPLAY_REPOSITORY}`;
const UPLOADS = `https://uploads.github.com/repos/${REPLAY_REPOSITORY}`;
const NAME = 'egoscope-backup-20261116T040000Z-weekly.bin';
const MANUAL = 'egoscope-backup-20261123T040000Z-manual.bin';
const CALL_BUDGET_MS = 10_000;
// The ids of the release and of the first asset that a replay creates, in that order.
const RELEASE_ID = String(FIRST_REPLAY_ID);
const FIRST_ASSET_ID = String(FIRST_REPLAY_ID + 1);
const UPLOAD = `POST uploads/releases/${RELEASE_ID}/assets?name=${NAME}`;
const LISTING = `GET /releases/${RELEASE_ID}/assets?per_page=100`;
// The instants that the recorded x-ratelimit-reset headers give.
const WINDOW_RESETS_AT = toEpochMs(Date.UTC(2026, 10, 16, 5));
const LIMIT_RESETS_AT = toEpochMs(Date.UTC(2026, 10, 16, 6));
const UNAVAILABLE = { kind: 'unavailable' };
const NOT_FOUND = { kind: 'not_found' };
const TOKEN_REJECTED = { kind: 'unauthorized', cause: 'token_rejected' };
const NOT_CONFIGURED = { error: { kind: 'unauthorized', cause: 'not_configured' } };

/** The instant at which the recorded asset was created. */
function recordedCreation(): EpochMs {
  const parsed = parseTimestamp(asset.body.created_at);
  if (!parsed.ok || parsed.timestamp.kind !== 'instant') {
    throw new Error('The recorded asset has no creation instant.');
  }
  return parsed.timestamp.at;
}

/** The token as the configuration gives it. */
function secret(value: string): Secret {
  const parsed = parseServerEnv({ BACKUP_GITHUB_TOKEN: value });
  const token = parsed.ok ? parsed.env.BACKUP_GITHUB_TOKEN : undefined;
  if (token === undefined) {
    throw new Error('The test token does not parse.');
  }
  return token;
}

/** The recorded asset, created at `createdAt` as GitHub would write it. */
function assetCreatedAt(createdAt: string): Readonly<Record<string, unknown>> {
  return Object.fromEntries([...Object.entries(asset.body), ['created_at', createdAt]]);
}

function context(): CallContext {
  return { deadline: toEpochMs(now() + CALL_BUDGET_MS), signal: new AbortController().signal };
}

function replay(options: Readonly<{ isPrivate?: boolean; isUploadBroken?: boolean }> = {}) {
  return new GithubReplay({ acceptedToken: TOKEN, ...options });
}

/** The adapter on `github` for `repositoryName`, none meaning not configured, with the contract's size limit. */
function adapterFor(github: GithubReplay, repositoryName: string | undefined) {
  return createGithubReleasesStorage({
    repository: repositoryName,
    token: secret(TOKEN),
    maxFileBytes: CONTRACT_MAX_FILE_BYTES,
    fetch: github.fetch,
  });
}

/** The adapter on `github`, configured for its repository. */
function adapterOn(github: GithubReplay) {
  return adapterFor(github, REPLAY_REPOSITORY);
}

/** The adapter in `condition`, as the contract asks for it. */
function adapterIn(condition: ContractCondition): BackupStorage {
  const github = new GithubReplay({
    acceptedToken: condition === 'token_expired' ? OTHER_TOKEN : TOKEN,
    isPrivate: condition !== 'not_private',
    isUploadBroken: condition === 'upload_interrupted',
  });
  return adapterFor(github, condition === 'not_configured' ? undefined : REPLAY_REPOSITORY);
}

/** An adapter whose release exists, on a replay that then forgets its requests. */
async function readyAdapter(github: GithubReplay): Promise<BackupStorage> {
  const storage = adapterOn(github);
  await storage.ensureContainer(context());
  github.forget();
  return storage;
}

/** The method and address of each request, the start of the API's address left out. */
function routes(github: GithubReplay): readonly string[] {
  return github.requests.map(
    ({ method, url }) => `${method} ${url.replace(API, '').replace(UPLOADS, 'uploads')}`,
  );
}

function told<T>(outcome: BackupStorageOutcome<T>) {
  return outcome.ok ? { value: outcome.value } : { error: outcome.error };
}

describe('createGithubReleasesStorage, on the recorded answers', () => {
  it.each(Object.entries(BACKUP_STORAGE_CONTRACT))('%s', async (_title, run) => {
    const { observed, promised } = await run(adapterIn);

    expect(observed).toStrictEqual(promised);
  });
});

describe('createGithubReleasesStorage', () => {
  it('[TRV-50] finds or creates the draft release named backups once, then keeps its id', async () => {
    const github = replay();
    github.addRelease('backups', false);
    github.addRelease('other', true);
    const first = adapterOn(github);
    const answers = [
      await first.ensureContainer(context()),
      await adapterOn(github).ensureContainer(context()),
      await first.ensureContainer(context()),
    ];

    expect(answers.map((outcome) => told(outcome))).toStrictEqual([
      { value: { created: true } },
      { value: { created: false } },
      { value: { created: false } },
    ]);
    expect(routes(github)).toStrictEqual([
      'GET /releases?per_page=100',
      'POST /releases',
      'GET /releases?per_page=100',
    ]);
    expect(new TextDecoder().decode(github.requests[1]?.body)).toBe(
      '{"tag_name":"backups","name":"backups","draft":true}',
    );
  });

  it('[TRV-50] [TRV-56] checks that the repository is private, then sends one asset under its name with the token, the media types and the API version', async () => {
    const github = replay();
    await adapterOn(github).ensureContainer(context());
    github.forget();
    const stored = await adapterOn(github).upload(NAME, Uint8Array.of(7, 8, 9), context());
    const file = { id: FIRST_ASSET_ID, name: NAME, sizeBytes: 3, complete: true };

    expect(stored).toMatchObject({
      ok: true,
      value: { kind: 'stored', file: { ...file, createdAt: recordedCreation() } },
      call: { httpRequests: 3, bytesSent: 3, rateLimitResetsAt: WINDOW_RESETS_AT },
    });
    expect(routes(github)).toStrictEqual(['GET ', 'GET /releases?per_page=100', UPLOAD]);
    expect([...(github.requests[2]?.body ?? [])]).toStrictEqual([7, 8, 9]);
    expect(Object.fromEntries(github.requests[2]?.headers ?? [])).toMatchObject({
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/octet-stream',
      'x-github-api-version': '2026-03-10',
    });
  });

  it('[TRV-50] reports a name that a complete asset holds as taken, after one listing and no deletion', async () => {
    const github = replay();
    const storage = await readyAdapter(github);
    await storage.upload(NAME, Uint8Array.of(1), context());
    github.forget();
    const taken = await storage.upload(NAME, Uint8Array.of(2), context());

    expect(told(taken)).toStrictEqual({ value: { kind: 'name_taken' } });
    expect(routes(github)).toStrictEqual(['GET ', UPLOAD, LISTING]);
  });

  it('deletes the leftover asset in state starter of a failed upload before it sends the file again', async () => {
    const github = replay({ isUploadBroken: true });
    const storage = await readyAdapter(github);
    const failed = await storage.upload(NAME, Uint8Array.of(1, 2), context());
    github.forget();
    const retried = await storage.upload(NAME, Uint8Array.of(1, 2), context());

    expect(told(failed)).toStrictEqual({ error: UNAVAILABLE });
    expect(retried).toMatchObject({ ok: true, value: { kind: 'stored' }, call: { bytesSent: 4 } });
    expect(routes(github)).toStrictEqual([
      'GET ',
      UPLOAD,
      LISTING,
      `DELETE /releases/assets/${FIRST_ASSET_ID}`,
      UPLOAD,
    ]);
  });

  it.each([
    ['another state', { ...asset.body, state: 'starter' }],
    ['another size', { ...asset.body, size: 2 }],
    ['no creation instant', assetCreatedAt('16 November')],
    ['another shape', { message: 'Created' }],
  ])('answers unavailable when GitHub takes the file but reports %s', async (_case, body) => {
    const github = replay();
    const storage = await readyAdapter(github);
    github.script('upload', { ...asset, body });
    const upload = await storage.upload(NAME, Uint8Array.of(1, 2, 3), context());

    expect(told(upload)).toStrictEqual({ error: UNAVAILABLE });
  });

  it('fails an upload whose taken name cannot be cleared: refused again, held by no asset, unlisted or kept', async () => {
    const github = replay({ isUploadBroken: true });
    const storage = await readyAdapter(github);
    await storage.upload(NAME, Uint8Array.of(1), context());
    const answers: BackupStorageOutcome<unknown>[] = [];
    github.script('delete', { status: 204, headers: {} });
    answers.push(await storage.upload(NAME, Uint8Array.of(1), context()));
    github.script('upload', errors.already_exists);
    answers.push(await storage.upload(MANUAL, Uint8Array.of(1), context()));
    github.script('assets', errors.bad_gateway);
    answers.push(await storage.upload(NAME, Uint8Array.of(1), context()));
    github.script('delete', errors.not_accessible);
    answers.push(await storage.upload(NAME, Uint8Array.of(1), context()));

    expect(answers.map((outcome) => told(outcome))).toStrictEqual([
      { error: UNAVAILABLE },
      { error: UNAVAILABLE },
      { error: UNAVAILABLE },
      { error: TOKEN_REJECTED },
    ]);
  });

  it('[TRV-50] lists every asset, page after page, following only the pages of the API', async () => {
    const github = replay();
    const storage = await readyAdapter(github);
    await storage.upload(NAME, Uint8Array.of(1), context());
    await storage.upload(MANUAL, Uint8Array.of(1), context());
    await storage.upload(
      'egoscope-backup-20261130T040000Z-weekly.bin',
      Uint8Array.of(1),
      context(),
    );
    github.setPageSize(2);
    github.forget();
    const listing = await storage.list(context());
    const link = { link: '<https://elsewhere.example/assets?page=2>; rel="next"' };
    github.script('assets', { status: 200, headers: link, body: [] });
    const elsewhere = await storage.list(context());

    expect(listing).toMatchObject({
      ok: true,
      value: [{ name: NAME }, { name: MANUAL }, { complete: true, sizeBytes: 1 }],
    });
    expect(told(elsewhere)).toStrictEqual({ value: [] });
    expect(github.requests).toHaveLength(3);
  });

  it('[TRV-53] downloads with Accept application/octet-stream, following the redirect without the token, and streams', async () => {
    const github = replay();
    const storage = await readyAdapter(github);
    await storage.upload(NAME, Uint8Array.of(4, 5, 6), context());
    github.forget();
    const downloaded = await storage.download(FIRST_ASSET_ID, context());
    const sent = github.requests.map(({ url, headers }) => ({
      host: new URL(url).host,
      accept: headers.get('accept'),
      authorization: headers.get('authorization'),
    }));

    expect(downloaded).toMatchObject({ ok: true, call: { httpRequests: 2, bytesReceived: 3 } });
    expect(downloaded.ok && downloaded.value instanceof ReadableStream).toBe(true);
    expect(sent).toStrictEqual([
      {
        host: 'api.github.com',
        accept: 'application/octet-stream',
        authorization: `Bearer ${TOKEN}`,
      },
      { host: FILE_HOST, accept: 'application/octet-stream', authorization: null },
    ]);
  });

  it('[TRV-53] answers unavailable for a redirect without an address or a file its host refuses, and not_found at no request for an id that is no number', async () => {
    const github = replay();
    const storage = await readyAdapter(github);
    await storage.upload(NAME, Uint8Array.of(1), context());
    github.script('asset', { status: 302, headers: {} });
    const noAddress = await storage.download(FIRST_ASSET_ID, context());
    github.script('file', errors.not_accessible);
    const refused = await storage.download(FIRST_ASSET_ID, context());
    github.script('file', { status: 200, headers: {}, body: [1] });
    const unmeasured = await storage.download(FIRST_ASSET_ID, context());
    const unknown = [
      await storage.delete('../releases', context()),
      await storage.download('x', context()),
    ];

    expect([told(noAddress), told(refused)]).toStrictEqual([
      { error: UNAVAILABLE },
      { error: UNAVAILABLE },
    ]);
    expect(unmeasured).toMatchObject({ ok: true, call: { bytesReceived: 0 } });
    expect(unknown.map((outcome) => [told(outcome), outcome.call.httpRequests])).toStrictEqual([
      [{ error: NOT_FOUND }, 0],
      [{ error: NOT_FOUND }, 0],
    ]);
  });

  it.each([
    {
      what: 'a token without the permission (403)',
      recorded: errors.not_accessible,
      error: TOKEN_REJECTED,
      resetsAt: WINDOW_RESETS_AT,
    },
    {
      what: 'the hourly rate limit (403, none left)',
      recorded: errors.rate_limited,
      error: { kind: 'rate_limited' },
      resetsAt: LIMIT_RESETS_AT,
    },
    {
      what: 'a secondary rate limit (429)',
      recorded: errors.secondary_rate_limit,
      error: { kind: 'rate_limited' },
      resetsAt: WINDOW_RESETS_AT,
    },
    {
      what: 'a server error (502)',
      recorded: errors.bad_gateway,
      error: UNAVAILABLE,
      resetsAt: null,
    },
    {
      what: 'an answer of another shape',
      recorded: { ...repository, body: { private: 'yes' } },
      error: UNAVAILABLE,
      resetsAt: WINDOW_RESETS_AT,
    },
    {
      what: 'a body that is no JSON',
      recorded: { ...repository, body: undefined },
      error: UNAVAILABLE,
      resetsAt: WINDOW_RESETS_AT,
    },
    {
      what: 'a reset that is no instant',
      recorded: { ...errors.bad_gateway, headers: { 'x-ratelimit-reset': '9'.repeat(13) } },
      error: UNAVAILABLE,
      resetsAt: null,
    },
  ])(
    '[TRV-47] [CL-TRV-12] maps $what, with the reset that its header gives',
    async ({ recorded, error, resetsAt }) => {
      const github = replay();
      github.script('repository', recorded);
      const health = await adapterOn(github).checkHealth(context());

      expect(health).toMatchObject({
        ok: false,
        error,
        call: { httpRequests: 1, bytesSent: 0, rateLimitResetsAt: resetsAt },
      });
    },
  );

  it('[CL-TRV-12] reports the reset of the hourly window that a successful answer gives', async () => {
    const health = await adapterOn(replay()).checkHealth(context());

    expect(health).toMatchObject({
      ok: true,
      value: { private: true },
      call: { rateLimitResetsAt: WINDOW_RESETS_AT },
    });
  });

  it('answers unavailable for a lost connection, a body cut off, an asset without its instant, a release not created and a call that ended', async () => {
    const github = replay();
    const answers: BackupStorageOutcome<unknown>[] = [];
    github.script('create', errors.bad_gateway);
    answers.push(await adapterOn(github).ensureContainer(context()));
    const storage = await readyAdapter(github);
    github.script('assets', 'connection_lost');
    answers.push(await storage.list(context()));
    github.script('assets', 'body_cut');
    answers.push(await storage.list(context()));
    const undated = assetCreatedAt('2026-11-16');
    github.script('assets', { ...repository, body: [undated] });
    answers.push(await storage.list(context()));
    const controller = new AbortController();
    controller.abort();
    answers.push(await storage.checkHealth({ ...context(), signal: controller.signal }));

    expect(answers.map((outcome) => told(outcome))).toStrictEqual(
      answers.map(() => ({ error: UNAVAILABLE })),
    );
  });

  it('[TRV-47] answers "not configured" without the token or the repository, sending no request', async () => {
    const github = replay();
    const withoutToken = createGithubReleasesStorage({
      repository: REPLAY_REPOSITORY,
      token: undefined,
      maxFileBytes: CONTRACT_MAX_FILE_BYTES,
      fetch: github.fetch,
    });
    const answers: readonly BackupStorageOutcome<unknown>[] = [
      await withoutToken.checkHealth(context()),
      await adapterFor(github, undefined).list(context()),
    ];

    expect(answers.map((outcome) => told(outcome))).toStrictEqual([NOT_CONFIGURED, NOT_CONFIGURED]);
    expect(github.requests).toHaveLength(0);
  });

  it('[TRV-64] sends the token to GitHub alone, and never puts it into an outcome', async () => {
    const github = replay();
    const storage = await readyAdapter(github);
    const outcomes = [
      await storage.upload(NAME, Uint8Array.of(1), context()),
      await storage.list(context()),
      await storage.download(FIRST_ASSET_ID, context()),
      await storage.delete(FIRST_ASSET_ID, context()),
    ];
    github.acceptOnly(OTHER_TOKEN);
    const refused = await storage.upload(MANUAL, Uint8Array.of(1), context());
    outcomes.push(refused);
    const hostsOf = (seen: readonly Seen[]) => new Set(seen.map(({ url }) => new URL(url).host));
    const carriers = github.requests.filter(({ headers }) => headers.has('authorization'));
    const others = github.requests.filter(({ headers }) => !headers.has('authorization'));
    const written = JSON.stringify(outcomes, (_key, value: unknown) =>
      value instanceof ReadableStream ? 'stream' : value,
    );

    expect(hostsOf(carriers)).toStrictEqual(new Set(['api.github.com', 'uploads.github.com']));
    expect(hostsOf(others)).toStrictEqual(new Set([FILE_HOST]));
    expect(told(refused)).toStrictEqual({ error: TOKEN_REJECTED });
    expect(written).not.toContain(TOKEN);
  });
});
