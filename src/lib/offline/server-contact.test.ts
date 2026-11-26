import { describe, expect, it, vi } from 'vitest';

type Answer = Readonly<{ status: number; body?: unknown }>;

/** Runs `call` once the current turn ends, as an answer of the network does. */
async function later<T>(call: () => T): Promise<T> {
  await Promise.resolve();
  return call();
}

/** The contact of a page just opened: the builds that it saw live as long as the page. */
async function freshPage() {
  vi.resetModules();
  return import('./server-contact');
}

/** The server, which answers /api/health with each of `answers` in turn. */
function server(...answers: readonly Answer[]) {
  const asked: { url: RequestInfo | URL; init: RequestInit | undefined }[] = [];
  const queue = [...answers];
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url, init) =>
      later(() => {
        asked.push({ url, init });
        const answer = queue.shift() ?? { status: 200 };
        const body = answer.body === undefined ? null : JSON.stringify(answer.body);
        return new Response(body, { status: answer.status });
      }),
    ),
  );
  return asked;
}

const BUILD_1 = { status: 200, body: { status: 'ok', version: 'dpl_build1' } };
const BUILD_2 = { status: 200, body: { status: 'ok', version: 'dpl_build2' } };
const INITIAL_PASSWORD = { status: 401, body: { status: 'unauthorized', ended: null } };

describe('the contact with the server', () => {
  it('[IHM-03] [IHM-04] asks /api/health past every cache for the session and the build of the server', async () => {
    const contact = await freshPage();
    const asked = server(BUILD_1);

    await expect(contact.contactServer()).resolves.toStrictEqual({
      kind: 'open',
      version: 'dpl_build1',
    });
    expect(asked).toStrictEqual([{ url: '/api/health', init: { cache: 'no-store' } }]);
  });

  it('[IHM-03] reads no build from an answer that names none', async () => {
    const contact = await freshPage();
    server({ status: 200, body: { status: 'ok', version: null } }, { status: 200, body: [] });

    await expect(contact.contactServer()).resolves.toStrictEqual({ kind: 'open', version: null });
    await expect(contact.contactServer()).resolves.toStrictEqual({ kind: 'open', version: null });
  });

  it.each(['logged_out', 'password_changed', 'reset', 'restored'])(
    '[IHM-08] [CL-IHM-10] [CL-TRV-05] tells that the owner ended the session, by %s, so that the device erases its data',
    async (ended) => {
      const contact = await freshPage();
      server({ status: 401, body: { status: 'unauthorized', ended } });

      await expect(contact.contactServer()).resolves.toStrictEqual({
        kind: 'refused',
        endedByOwner: true,
      });
    },
  );

  it.each([
    ['an expired session', { status: 'unauthorized', ended: 'expired' }],
    ['a session still on the initial password', { status: 'unauthorized', ended: null }],
    ['an answer that names no ending', { status: 'unauthorized' }],
    ['the empty answer of the proxy to a device without a session cookie', undefined],
  ])(
    '[IHM-08] [IHM-42] tells a refused session that the owner did not end, which erases nothing: %s',
    async (_case, body) => {
      const contact = await freshPage();
      server({ status: 401, body });

      await expect(contact.contactServer()).resolves.toStrictEqual({
        kind: 'refused',
        endedByOwner: false,
      });
    },
  );

  it('says that there is no answer when the device is offline or the server cannot work', async () => {
    const contact = await freshPage();
    server({ status: 503, body: { status: 'unavailable', ended: 'logged_out' } });

    await expect(contact.contactServer()).resolves.toStrictEqual({ kind: 'unavailable' });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(contact.contactServer()).resolves.toStrictEqual({ kind: 'unavailable' });
  });

  it('[IHM-03] tells no new version while the server runs the build of the first contact of the page, whatever answers come between', async () => {
    const contact = await freshPage();
    server(BUILD_1, INITIAL_PASSWORD, BUILD_1);

    expect(contact.hasServerNewVersion()).toBe(false);

    await contact.contactServer();
    await contact.contactServer();
    await contact.contactServer();

    expect(contact.hasServerNewVersion()).toBe(false);
  });

  it('[IHM-03] tells a new version once the server runs another build than at the first contact of the page', async () => {
    const contact = await freshPage();
    server(BUILD_1, BUILD_2);
    await contact.contactServer();

    await contact.contactServer();

    expect(contact.hasServerNewVersion()).toBe(true);
  });

  it('[IHM-03] tells those who watch after each answer that names a build, until they stop', async () => {
    const contact = await freshPage();
    server(BUILD_1, INITIAL_PASSWORD, BUILD_2, BUILD_2);
    const watcher = vi.fn<() => void>();
    const stop = contact.watchServerVersion(watcher);

    await contact.contactServer();
    await contact.contactServer();
    await contact.contactServer();

    expect(watcher).toHaveBeenCalledTimes(2);

    stop();
    await contact.contactServer();

    expect(watcher).toHaveBeenCalledTimes(2);
  });
});
