import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { startServiceWorker } from './sw';

import type { Shell, WorkerEvents, WorkerScope } from './sw';

const ORIGIN = 'https://egoscope.test';
const APP_CHUNK = '/_next/static/chunks/app-2b7c.js';
const BUILD_MANIFEST = '/_next/static/build-2/_buildManifest.js';
const SHELL: Shell = { version: 'build-2', files: [APP_CHUNK, BUILD_MANIFEST] };
const SHELL_CACHE = 'egoscope-shell-build-2';
const EARLIER_SHELL_CACHE = 'egoscope-shell-build-1';
const SCREENS = 'egoscope-screens';
const OFFLINE_PAGE_KEY = `${ORIGIN}/offline-page`;
const NOT_FOUND = 404;
const SERVER_ERROR = 500;
const TEMPORARY_REDIRECT = 307;
// Thursday 26 November 2026 at 13:03 UTC, then an hour later.
const COPIED_AT = toEpochMs(Date.UTC(2026, 10, 26, 13, 3));
const HOUR_MS = 3_600_000;

type Network = (request: Request | string) => Promise<Response>;

const urlOf = (request: RequestInfo | URL): string =>
  new URL(request instanceof Request ? request.url : String(request), ORIGIN).href;

/** Runs `call` once the current turn ends, as an answer of the browser does. */
async function later<T>(call: () => T): Promise<T> {
  await Promise.resolve();
  return call();
}

/** The device without connection, as fetch sees it. */
const offline: Network = async () =>
  later(() => {
    throw new TypeError('Failed to fetch');
  });

/** A server that answers every file with its own URL, and counts what it was asked. */
function server(status = 200) {
  const asked: string[] = [];
  const network: Network = async (request) =>
    later(() => {
      asked.push(urlOf(request));
      return new Response(urlOf(request), { status });
    });
  return { asked, network };
}

/** The Cache Storage of one device, which downloads through `network`. */
function deviceCaches(network: Network) {
  type Store = Map<string, Response>;
  const stores: { name: string; store: Store }[] = [];
  const cacheOf = (store: Store) => ({
    add: async (request: RequestInfo | URL) => {
      const response = await network(urlOf(request));
      if (!response.ok) {
        throw new TypeError(`Request failed: ${urlOf(request)}`);
      }
      store.set(urlOf(request), response);
    },
    delete: async (request: RequestInfo | URL) => later(() => store.delete(urlOf(request))),
    keys: async () => later(() => Array.from(store.keys(), (url) => new Request(url))),
    match: async (request: RequestInfo | URL) => later(() => store.get(urlOf(request))?.clone()),
    put: async (request: RequestInfo | URL, response: Response) =>
      later(() => {
        store.set(urlOf(request), response);
      }),
  });
  const storeNamed = (name: string): Store => {
    const named = stores.find((entry) => entry.name === name);
    if (named !== undefined) {
      return named.store;
    }
    const store: Store = new Map();
    stores.push({ name, store });
    return store;
  };
  const caches: WorkerScope['caches'] = {
    open: async (name) => later(() => cacheOf(storeNamed(name))),
    match: async (request) =>
      later(() =>
        stores
          .find(({ store }) => store.has(urlOf(request)))
          ?.store.get(urlOf(request))
          ?.clone(),
      ),
    keys: async () => later(() => stores.map(({ name }) => name)),
    delete: async (name) =>
      later(() => {
        const index = stores.findIndex((entry) => entry.name === name);
        return index !== -1 && stores.splice(index, 1).length === 1;
      }),
  };
  const keysOf = (name: string): string[] => Array.from(storeNamed(name), ([url]) => url);
  return { caches, keysOf, storeNamed };
}

/** Dispatches an event that the worker may extend, and waits until the worker is done. */
async function extendable(dispatch: (event: WorkerEvents['install']) => void): Promise<void> {
  const pending: Promise<unknown>[] = [];
  dispatch({
    waitUntil: (promise) => {
      pending.push(promise);
    },
  });
  await Promise.all(pending);
}

/** The worker started in a scope of its own, with events dispatched as the browser does. */
function startWorker(network: Network, caches: WorkerScope['caches']) {
  type Listeners = { [T in keyof WorkerEvents]?: (event: WorkerEvents[T]) => void };
  const listeners: Listeners = {};
  const skipWaiting = vi.fn(async () => later(() => undefined));
  startServiceWorker(
    {
      addEventListener: (type, listener) => {
        Object.assign(listeners, { [type]: listener });
      },
      caches,
      fetch: network,
      location: { origin: ORIGIN },
      skipWaiting,
    },
    SHELL,
  );
  return {
    install: async () => extendable((event) => listeners.install?.(event)),
    activate: async () => extendable((event) => listeners.activate?.(event)),
    message: async (data: unknown) =>
      extendable((event) => listeners.message?.({ ...event, data })),
    /**
     * The worker's answer to `request`, `undefined` when it leaves the request to the
     * network, once the work that the answer extends is done, as the browser waits for it.
     */
    fetch: async (request: Request): Promise<Response | undefined> => {
      const answers: Promise<Response>[] = [];
      const extended: Promise<unknown>[] = [];
      listeners.fetch?.({
        request,
        waitUntil: (promise) => {
          extended.push(promise);
        },
        respondWith: (response) => {
          answers.push(response);
        },
      });
      const [answer] = answers;
      const response = await answer;
      await Promise.all(extended);
      return response;
    },
    skipWaiting,
  };
}

/** The request of a screen that the owner opens. */
function navigation(path: string): Request {
  const request = new Request(new URL(path, ORIGIN));
  Object.defineProperty(request, 'mode', { value: 'navigate' });
  return request;
}

const OFFLINE_PAGE_MESSAGE =
  'This screen has not been loaded on this device yet: connect to the internet to open it.';
const NOT_KEPT_MESSAGE =
  'This screen is not available offline: connect to the internet to open it.';

/** The answer of a server that answers each screen with its own URL. */
const echo = (url: string): Response => new Response(url);

/** A server whose answers the test sets as it goes, and which counts what it was asked. */
function scriptedServer() {
  const asked: Request[] = [];
  let answer = echo;
  const network: Network = async (request) =>
    later(() => {
      asked.push(request instanceof Request ? request : new Request(urlOf(request)));
      return answer(urlOf(request));
    });
  return {
    asked,
    network,
    /** From now on, the server answers each screen with `next`. */
    answers: (next: (url: string) => Response) => {
      answer = next;
    },
  };
}

/** The device's copy of the screen at `path`, with its date and its build, or `undefined`. */
async function copyOf(device: ReturnType<typeof deviceCaches>, path: string) {
  const copy = device.storeNamed(SCREENS).get(`${ORIGIN}${path}`);
  return copy === undefined
    ? undefined
    : {
        text: await copy.clone().text(),
        copiedAt: copy.headers.get('x-egoscope-copied-at'),
        build: copy.headers.get('x-egoscope-build'),
      };
}

describe('the service worker', () => {
  it('[TRV-22] [CL-TRV-13] precaches the offline page and the static files of its build as it installs, and nothing else', async () => {
    const { asked, network } = server();
    const device = deviceCaches(network);

    await startWorker(network, device.caches).install();

    expect(device.keysOf(SHELL_CACHE)).toStrictEqual([
      OFFLINE_PAGE_KEY,
      `${ORIGIN}${APP_CHUNK}`,
      `${ORIGIN}${BUILD_MANIFEST}`,
    ]);
    expect(asked).toStrictEqual([`${ORIGIN}${APP_CHUNK}`, `${ORIGIN}${BUILD_MANIFEST}`]);
  });

  it('takes a static file that an earlier build cached from there instead of downloading it again', async () => {
    const { asked, network } = server();
    const device = deviceCaches(network);
    device.storeNamed(EARLIER_SHELL_CACHE).set(`${ORIGIN}${APP_CHUNK}`, new Response('kept'));

    await startWorker(network, device.caches).install();

    expect(asked).toStrictEqual([`${ORIGIN}${BUILD_MANIFEST}`]);
    expect(await device.storeNamed(SHELL_CACHE).get(`${ORIGIN}${APP_CHUNK}`)?.text()).toBe('kept');
  });

  it('fails the installation when a static file cannot be downloaded', async () => {
    const { network } = server(NOT_FOUND);
    const device = deviceCaches(network);

    await expect(startWorker(network, device.caches).install()).rejects.toThrow('Request failed');
  });

  it('[TRV-22] answers a screen with the offline page from its cache when the network does not answer', async () => {
    const device = deviceCaches(server().network);
    const worker = startWorker(offline, device.caches);
    await worker.install();
    device.storeNamed(SHELL_CACHE).set(OFFLINE_PAGE_KEY, new Response('the cached page'));

    const response = await worker.fetch(navigation('/players'));

    expect(await response?.text()).toBe('the cached page');
  });

  it('[TRV-22] writes the offline page as one heading and one sentence, in the theme of the phone, with no script', async () => {
    const device = deviceCaches(server().network);
    const worker = startWorker(offline, device.caches);
    await worker.install();

    const response = await worker.fetch(navigation('/players'));

    expect(response?.status).toBe(200);
    expect(response?.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(await response?.text()).toBe(
      [
        '<!doctype html><html lang="en"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        '<meta name="color-scheme" content="light dark"><title>Offline · Egoscope</title>',
        '<style>body{margin:0;font-family:system-ui,sans-serif;line-height:1.5}',
        'main{max-width:48rem;margin:0 auto;padding:1.5rem 1rem}',
        'h1{font-size:1.5rem;margin:0 0 .5rem}</style></head>',
        `<body><main><h1>Offline</h1><p>${OFFLINE_PAGE_MESSAGE}</p></main></body></html>`,
      ].join(''),
    );
  });

  it('[TRV-22] still answers with the offline page when the cache lost it, never with an error', async () => {
    const worker = startWorker(offline, deviceCaches(offline).caches);

    const response = await worker.fetch(navigation('/'));

    expect(await response?.text()).toContain(`<h1>Offline</h1><p>${OFFLINE_PAGE_MESSAGE}</p>`);
  });

  it('answers a screen from the network whenever the network answers, an error included', async () => {
    const { network } = server(SERVER_ERROR);
    const worker = startWorker(network, deviceCaches(network).caches);

    const response = await worker.fetch(navigation('/players'));

    expect(response?.status).toBe(SERVER_ERROR);
    expect(await response?.text()).toBe(`${ORIGIN}/players`);
  });

  it('[IHM-57] [CL-TRV-13] keeps a copy of the screens that stay readable offline alone, never of another screen', async () => {
    const { network } = server();
    const device = deviceCaches(network);
    const worker = startWorker(network, device.caches);
    await worker.install();
    const kept = [
      '/',
      '/players',
      '/players/7',
      '/players/7/profiles/media-storm',
      '/cases/3',
      '/backtests/12',
      '/more',
      '/alerts/5',
    ];
    const notKept = ['/players/new', '/players/7/edit', '/cases', '/settings', '/imports/4'];

    for (const path of [...kept, ...notKept]) {
      await worker.fetch(navigation(path));
    }

    expect(device.keysOf(SCREENS)).toStrictEqual(kept.map((path) => `${ORIGIN}${path}`));
  });

  it('[IHM-57] [TRV-22] answers a screen that needs the network with the page that says so once the network does not answer, and keeps no copy of it', async () => {
    const online = server();
    let network: Network = online.network;
    const device = deviceCaches(online.network);
    const worker = startWorker(async (request) => network(request), device.caches);
    await worker.install();
    await worker.fetch(navigation('/settings'));
    network = offline;

    const reopened = await worker.fetch(navigation('/settings'));

    expect(await reopened?.text()).toContain(`<h1>Offline</h1><p>${NOT_KEPT_MESSAGE}</p>`);
    expect(device.keysOf(SCREENS)).toStrictEqual([]);
  });

  it('serves the static files of its build from its cache, and from the network when the cache lost them', async () => {
    const { asked, network } = server();
    const device = deviceCaches(network);
    const worker = startWorker(network, device.caches);
    await worker.install();
    device.storeNamed(SHELL_CACHE).set(`${ORIGIN}${APP_CHUNK}`, new Response('from the cache'));
    device.storeNamed(SHELL_CACHE).delete(`${ORIGIN}${BUILD_MANIFEST}`);
    asked.length = 0;

    const cached = await worker.fetch(new Request(`${ORIGIN}${APP_CHUNK}`));
    const lost = await worker.fetch(new Request(`${ORIGIN}${BUILD_MANIFEST}`));

    expect(await cached?.text()).toBe('from the cache');
    expect(await lost?.text()).toBe(`${ORIGIN}${BUILD_MANIFEST}`);
    expect(asked).toStrictEqual([`${ORIGIN}${BUILD_MANIFEST}`]);
  });

  it('[CL-TRV-13] leaves every other request to the network, and caches nothing of it', async () => {
    const { network } = server();
    const device = deviceCaches(network);
    const worker = startWorker(network, device.caches);
    await worker.install();

    const answers = await Promise.all([
      worker.fetch(new Request(`${ORIGIN}/api/health`)),
      worker.fetch(new Request(`${ORIGIN}/_next/static/chunks/other-9f1d.js`)),
      worker.fetch(new Request(`https://elsewhere.test${APP_CHUNK}`)),
      worker.fetch(new Request(`${ORIGIN}${APP_CHUNK}`, { method: 'POST' })),
      // The data of a screen that a client-side navigation loads is as signed-in as the screen.
      worker.fetch(new Request(`${ORIGIN}/players?_rsc=1a2b`, { headers: { RSC: '1' } })),
    ]);

    expect(answers).toStrictEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(await device.caches.keys()).toStrictEqual([SHELL_CACHE]);
    expect(device.keysOf(SHELL_CACHE)).toHaveLength(SHELL.files.length + 1);
  });

  it('drops the caches of earlier builds as it takes over, and keeps every other cache', async () => {
    const device = deviceCaches(offline);
    device.storeNamed(EARLIER_SHELL_CACHE);
    device.storeNamed(SHELL_CACHE);
    device.storeNamed('egoscope-screens');

    await startWorker(offline, device.caches).activate();

    expect(await device.caches.keys()).toStrictEqual([SHELL_CACHE, 'egoscope-screens']);
  });

  it('[IHM-03] takes over from the running worker when the page applies the new version, and only then', async () => {
    const worker = startWorker(offline, deviceCaches(offline).caches);

    await worker.message('reload');
    await worker.message({ type: 'apply-new-version' });

    expect(worker.skipWaiting).not.toHaveBeenCalled();

    await worker.message('apply-new-version');

    expect(worker.skipWaiting).toHaveBeenCalledOnce();
  });

  it('[IHM-57] [CL-TRV-13] keeps a kept screen as the network answered it to the owner, dated and marked with its build, for any request', async () => {
    onTestFinished(installFakeClock(fixedClock(COPIED_AT)));
    const online = scriptedServer();
    online.answers(
      (url) =>
        new Response(`players of ${url}`, { headers: { Vary: 'RSC, Next-Router-State-Tree' } }),
    );
    const device = deviceCaches(online.network);
    const worker = startWorker(online.network, device.caches);

    const shown = await worker.fetch(navigation('/players'));

    expect(await shown?.text()).toBe(`players of ${ORIGIN}/players`);
    expect(await copyOf(device, '/players')).toStrictEqual({
      text: `players of ${ORIGIN}/players`,
      copiedAt: String(COPIED_AT),
      build: SHELL.version,
    });
    expect(device.storeNamed(SCREENS).get(`${ORIGIN}/players`)?.headers.has('Vary')).toBe(false);
  });

  it('[IHM-57] answers a kept screen from its copy once the network does not answer', async () => {
    const online = server();
    let network: Network = online.network;
    const device = deviceCaches(online.network);
    const worker = startWorker(async (request) => network(request), device.caches);
    await worker.install();
    await worker.fetch(navigation('/players/7'));
    network = offline;

    const reopened = await worker.fetch(navigation('/players/7'));

    expect(await reopened?.text()).toBe(`${ORIGIN}/players/7`);
  });

  it('[IHM-59] [DSN-33] [CL-IHM-15] replaces a copy whole with each new answer, never merging the two', async () => {
    const clock = fixedClock(COPIED_AT);
    onTestFinished(installFakeClock(clock));
    const online = scriptedServer();
    online.answers(() => new Response('first', { headers: { 'X-Withdrawn-Player': '7' } }));
    const device = deviceCaches(online.network);
    const worker = startWorker(online.network, device.caches);
    await worker.fetch(navigation('/players'));
    clock.advance(HOUR_MS);
    online.answers(() => new Response('second'));

    await worker.fetch(navigation('/players'));

    expect(await copyOf(device, '/players')).toStrictEqual({
      text: 'second',
      copiedAt: String(COPIED_AT + HOUR_MS),
      build: SHELL.version,
    });
    expect(
      device.storeNamed(SCREENS).get(`${ORIGIN}/players`)?.headers.has('X-Withdrawn-Player'),
    ).toBe(false);
    expect(device.keysOf(SCREENS)).toStrictEqual([`${ORIGIN}/players`]);
  });

  it('[CL-IHM-15] [CL-DSN-18] deletes the copy of a screen whose object no longer exists, and keeps it through a redirect to the login page or a server error', async () => {
    const online = scriptedServer();
    const device = deviceCaches(online.network);
    const worker = startWorker(online.network, device.caches);
    await worker.fetch(navigation('/cases/3'));
    await worker.fetch(navigation('/cases/4'));
    online.answers(
      () => new Response(null, { status: TEMPORARY_REDIRECT, headers: { Location: '/log-in' } }),
    );
    await worker.fetch(navigation('/cases/3'));
    online.answers(() => new Response('down', { status: SERVER_ERROR }));
    await worker.fetch(navigation('/cases/3'));

    online.answers(() => new Response('gone', { status: NOT_FOUND }));
    await worker.fetch(navigation('/cases/4'));

    expect(await copyOf(device, '/cases/3')).toMatchObject({ text: `${ORIGIN}/cases/3` });
    expect(device.keysOf(SCREENS)).toStrictEqual([`${ORIGIN}/cases/3`]);
  });

  it('[CL-TRV-13] keeps no copy of a screen that the network did not answer to a signed-in owner', async () => {
    const online = scriptedServer();
    online.answers(
      () => new Response(null, { status: TEMPORARY_REDIRECT, headers: { Location: '/log-in' } }),
    );
    const device = deviceCaches(online.network);
    const worker = startWorker(online.network, device.caches);

    const shown = await worker.fetch(navigation('/more'));

    expect(shown?.status).toBe(TEMPORARY_REDIRECT);
    expect(device.keysOf(SCREENS)).toStrictEqual([]);
  });

  it('[IHM-04] [CL-IHM-06] answers Home from its copy of the running build first, which the page then refreshes, and from the network after another build', async () => {
    const online = scriptedServer();
    const device = deviceCaches(online.network);
    const worker = startWorker(online.network, device.caches);
    device
      .storeNamed(SCREENS)
      .set(
        `${ORIGIN}/`,
        new Response('Home of build-2', { headers: { 'x-egoscope-build': 'build-2' } }),
      );

    const first = await worker.fetch(navigation('/'));

    expect(await first?.text()).toBe('Home of build-2');
    expect(online.asked).toStrictEqual([]);

    device
      .storeNamed(SCREENS)
      .set(
        `${ORIGIN}/`,
        new Response('Home of build-1', { headers: { 'x-egoscope-build': 'build-1' } }),
      );
    const afterUpdate = await worker.fetch(navigation('/'));

    expect(await afterUpdate?.text()).toBe(`${ORIGIN}/`);
  });

  it('[IHM-04] answers every kept screen other than Home from the network first', async () => {
    const online = scriptedServer();
    const device = deviceCaches(online.network);
    const worker = startWorker(online.network, device.caches);
    device
      .storeNamed(SCREENS)
      .set(
        `${ORIGIN}/more`,
        new Response('More of build-2', { headers: { 'x-egoscope-build': 'build-2' } }),
      );

    const shown = await worker.fetch(navigation('/more'));

    expect(await shown?.text()).toBe(`${ORIGIN}/more`);
  });

  it('[IHM-57] answers a kept screen of which the device holds no copy yet with the page that says it was not loaded', async () => {
    const device = deviceCaches(server().network);
    const worker = startWorker(offline, device.caches);
    await worker.install();

    const shown = await worker.fetch(navigation('/backtests/12'));

    expect(await shown?.text()).toContain(`<p>${OFFLINE_PAGE_MESSAGE}</p>`);
  });

  it('[CL-IHM-15] [IHM-59] reloads every copy when the page asks, replaces each whole without following a redirect, and drops the copies of screens no longer kept', async () => {
    onTestFinished(installFakeClock(fixedClock(COPIED_AT)));
    const online = scriptedServer();
    const device = deviceCaches(online.network);
    const worker = startWorker(online.network, device.caches);
    device.storeNamed(SCREENS).set(`${ORIGIN}/players`, new Response('old players'));
    device.storeNamed(SCREENS).set(`${ORIGIN}/cases/3`, new Response('old case'));
    device.storeNamed(SCREENS).set(`${ORIGIN}/settings`, new Response('an earlier build kept it'));
    online.answers((url) => new Response(`new ${url}`));

    await worker.message('refresh-copies');

    expect(await copyOf(device, '/players')).toStrictEqual({
      text: `new ${ORIGIN}/players`,
      copiedAt: String(COPIED_AT),
      build: SHELL.version,
    });
    expect(await copyOf(device, '/cases/3')).toMatchObject({ text: `new ${ORIGIN}/cases/3` });
    expect(device.keysOf(SCREENS)).toStrictEqual([`${ORIGIN}/players`, `${ORIGIN}/cases/3`]);
    expect(online.asked.map((request) => [request.url, request.redirect])).toStrictEqual([
      [`${ORIGIN}/players`, 'manual'],
      [`${ORIGIN}/cases/3`, 'manual'],
    ]);
  });

  it('[CL-DSN-18] keeps every copy with its date when the page asks for a reload that the network cannot answer', async () => {
    const device = deviceCaches(offline);
    const worker = startWorker(offline, device.caches);
    device
      .storeNamed(SCREENS)
      .set(
        `${ORIGIN}/players`,
        new Response('players', { headers: { 'x-egoscope-copied-at': String(COPIED_AT) } }),
      );

    await worker.message('refresh-copies');

    expect(await copyOf(device, '/players')).toStrictEqual({
      text: 'players',
      copiedAt: String(COPIED_AT),
      build: null,
    });
  });
});
