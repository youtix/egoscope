import { assert, describe, expect, expectTypeOf, it, onTestFinished } from 'vitest';

import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { BACKUP_STORAGE_CONTRACT, CONTRACT_MAX_FILE_BYTES } from './contract';
import { createFakeBackupStorage } from './fake';

import type { ContractCondition } from './contract';
import type { BackupStorageError, UnauthorizedCause } from './errors';
import type { FakeBackupStorage } from './fake';
import type { BackupStorageOperation, CallContext } from './types';

const STORED_AT = toEpochMs(Date.UTC(2026, 10, 16, 4));
const WEEK_MS = 604_800_000;
const CONTEXT: CallContext = {
  deadline: toEpochMs(Date.UTC(2026, 10, 16, 4, 5)),
  signal: new AbortController().signal,
};
const WEEKLY = 'egoscope-backup-20261116T040000Z-weekly.bin';
const MANUAL = 'egoscope-backup-20261123T040000Z-manual.bin';
const RATE_LIMITED = { kind: 'rate_limited' } as const;

/** The fake in `condition`, as the contract asks for it. */
function fakeIn(condition: ContractCondition): FakeBackupStorage {
  const fake = createFakeBackupStorage({ maxFileBytes: CONTRACT_MAX_FILE_BYTES });
  switch (condition) {
    case 'ready': {
      break;
    }
    case 'not_private': {
      fake.setPrivate(false);
      break;
    }
    case 'token_expired': {
      fake.setAccess('token_expired');
      break;
    }
    case 'not_configured': {
      fake.setAccess('not_configured');
      break;
    }
    case 'upload_interrupted': {
      fake.interruptNextUpload();
      break;
    }
  }
  return fake;
}

/** A ready fake whose container exists. */
async function readyFake(): Promise<FakeBackupStorage> {
  const fake = fakeIn('ready');
  await fake.ensureContainer(CONTEXT);
  return fake;
}

/** Calls `operation` of `fake` on its first file. */
async function call(fake: FakeBackupStorage, operation: BackupStorageOperation) {
  const runs = {
    checkHealth: async () => fake.checkHealth(CONTEXT),
    ensureContainer: async () => fake.ensureContainer(CONTEXT),
    upload: async () => fake.upload(MANUAL, new Uint8Array(1), CONTEXT),
    list: async () => fake.list(CONTEXT),
    delete: async () => fake.delete('1', CONTEXT),
    download: async () => fake.download('1', CONTEXT),
  };
  return runs[operation]();
}

describe('[TRV-47] [TRV-50] [TRV-53] [TRV-56] [CL-TRV-04] the backup-storage contract, run against the fake', () => {
  it.each(Object.entries(BACKUP_STORAGE_CONTRACT))('%s', async (_title, run) => {
    const { observed, promised } = await run(fakeIn);

    expect(observed).toStrictEqual(promised);
  });
});

describe('createFakeBackupStorage', () => {
  it('fails with the five errors of the port, an unauthorized one with its cause', async () => {
    const fake = await readyFake();
    const tooLarge = await fake.upload(
      WEEKLY,
      new Uint8Array(CONTRACT_MAX_FILE_BYTES + 1),
      CONTEXT,
    );
    const notFound = await fake.download('1', CONTEXT);
    fake.failNext('list', RATE_LIMITED);
    const rateLimited = await fake.list(CONTEXT);
    fake.interruptNextUpload();
    const unavailable = await fake.upload(WEEKLY, new Uint8Array(1), CONTEXT);
    fake.setAccess('token_expired');
    const unauthorized = await fake.list(CONTEXT);

    expectTypeOf<BackupStorageError['kind']>().toEqualTypeOf<
      'unauthorized' | 'not_found' | 'too_large' | 'rate_limited' | 'unavailable'
    >();
    expectTypeOf<UnauthorizedCause>().toEqualTypeOf<'not_configured' | 'token_rejected'>();
    expect([unauthorized, notFound, tooLarge, rateLimited, unavailable]).toMatchObject([
      { error: { kind: 'unauthorized', cause: 'token_rejected' } },
      { error: { kind: 'not_found' } },
      { error: { kind: 'too_large' } },
      { error: { kind: 'rate_limited' } },
      { error: { kind: 'unavailable' } },
    ]);
  });

  it('[TRV-50] lists each file with its name, its size and the instant it was stored', async () => {
    const clock = fixedClock(STORED_AT);
    onTestFinished(installFakeClock(clock));
    const fake = await readyFake();
    await fake.upload(WEEKLY, new Uint8Array(3), CONTEXT);
    clock.advance(WEEK_MS);
    await fake.upload(MANUAL, new Uint8Array(5), CONTEXT);

    expect(await fake.list(CONTEXT)).toStrictEqual({
      ok: true,
      value: [
        { id: '1', name: WEEKLY, sizeBytes: 3, createdAt: STORED_AT, complete: true },
        { id: '2', name: MANUAL, sizeBytes: 5, createdAt: STORED_AT + WEEK_MS, complete: true },
      ],
      meta: { requests: 1, bytesSent: 0, bytesReceived: 0, rateLimitResetsAt: null },
    });
  });

  it('reports the requests and the bytes of each call', async () => {
    const fake = await readyFake();
    const upload = await fake.upload(WEEKLY, new Uint8Array(6), CONTEXT);
    const download = await fake.download('1', CONTEXT);

    expect([upload.meta, download.meta]).toStrictEqual([
      { requests: 2, bytesSent: 6, bytesReceived: 0, rateLimitResetsAt: null },
      { requests: 1, bytesSent: 0, bytesReceived: 6, rateLimitResetsAt: null },
    ]);
  });

  it('deletes the half-created file first when it sends the file again, in one request more', async () => {
    const fake = fakeIn('upload_interrupted');
    await fake.ensureContainer(CONTEXT);
    const interrupted = await fake.upload(WEEKLY, new Uint8Array(4), CONTEXT);
    const retried = await fake.upload(WEEKLY, new Uint8Array(4), CONTEXT);

    expect([interrupted.meta.requests, retried.meta.requests]).toStrictEqual([2, 3]);
    expect(await fake.list(CONTEXT)).toMatchObject({
      value: [{ id: '2', name: WEEKLY, sizeBytes: 4, complete: true }],
    });
  });

  it('keeps a file whose deletion it answered, as an unverified deletion leaves it', async () => {
    const fake = await readyFake();
    await fake.upload(WEEKLY, new Uint8Array(2), CONTEXT);
    fake.keepNextDeletion();
    const kept = await fake.delete('1', CONTEXT);
    const listing = await fake.list(CONTEXT);
    const deleted = await fake.delete('1', CONTEXT);

    expect([kept, listing, deleted]).toMatchObject([
      { ok: true, value: null },
      { ok: true, value: [{ id: '1', name: WEEKLY }] },
      { ok: true, value: null },
    ]);
    expect(await fake.list(CONTEXT)).toMatchObject({ value: [] });
  });

  it.each<BackupStorageOperation>([
    'checkHealth',
    'ensureContainer',
    'upload',
    'list',
    'delete',
    'download',
  ])('fails the next call of %s with the scripted error, once', async (operation) => {
    const fake = await readyFake();
    await fake.upload(WEEKLY, new Uint8Array(2), CONTEXT);
    fake.failNext(operation, RATE_LIMITED);
    const failed = await call(fake, operation);
    const next = await call(fake, operation);

    expect(failed).toStrictEqual({
      ok: false,
      error: RATE_LIMITED,
      meta: { requests: 1, bytesSent: 0, bytesReceived: 0, rateLimitResetsAt: null },
    });
    expect(next.ok).toBe(true);
  });

  it('changes nothing in the space on a scripted failure', async () => {
    const fake = await readyFake();
    fake.failNext('upload', { kind: 'unavailable' });
    await fake.upload(WEEKLY, new Uint8Array(2), CONTEXT);

    expect(await fake.list(CONTEXT)).toMatchObject({ value: [] });
  });

  it('lets the app in again, files kept, once its token is renewed', async () => {
    const fake = await readyFake();
    await fake.upload(WEEKLY, new Uint8Array(2), CONTEXT);
    fake.setAccess('token_expired');
    const refused = await fake.list(CONTEXT);
    fake.setAccess('granted');

    expect(refused).toMatchObject({ error: { kind: 'unauthorized', cause: 'token_rejected' } });
    expect(await fake.list(CONTEXT)).toMatchObject({ value: [{ name: WEEKLY, sizeBytes: 2 }] });
  });

  it('keeps what it was sent, whatever the sender does with its bytes afterwards', async () => {
    const fake = await readyFake();
    const bytes = Uint8Array.of(7, 8);
    await fake.upload(WEEKLY, bytes, CONTEXT);
    bytes.fill(0);
    const downloaded = await fake.download('1', CONTEXT);
    assert(downloaded.ok);
    const body = await new Response(downloaded.value).arrayBuffer();

    expect([...new Uint8Array(body)]).toStrictEqual([7, 8]);
  });
});
