import { describe, expect, it, vi } from 'vitest';

import { startServiceWorker } from './sw';

import type { Shell, WorkerEvents, WorkerScope } from './sw';

const ORIGIN = 'https://egoscope.test';
const APP_CHUNK = '/_next/static/chunks/app-2b7c.js';
const BUILD_MANIFEST = '/_next/static/build-2/_buildManifest.js';
const SHELL: Shell = { version: 'build-2', files: [APP_CHUNK, BUILD_MANIFEST] };
const SHELL_CACHE = 'egoscope-shell-build-2';
const EARLIER_SHELL_CACHE = 'egoscope-shell-build-1';
const OFFLINE_PAGE_KEY = `${ORIGIN}/offline-page`;
const NOT_FOUND = 404;
const SERVER_ERROR = 500;

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
    fetch: (request: Request): Promise<Response> | undefined => {
      const answers: Promise<Response>[] = [];
      listeners.fetch?.({
        request,
        waitUntil: () => undefined,
        respondWith: (response) => {
          answers.push(response);
        },
      });
      return answers[0];
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

  it('[CL-TRV-13] caches no screen that it answered from the network, an error included', async () => {
    const online = server();
    let network: Network = online.network;
    const device = deviceCaches(online.network);
    const worker = startWorker(async (request) => network(request), device.caches);
    await worker.install();

    const home = await worker.fetch(navigation('/'));
    const players = await worker.fetch(navigation('/players'));
    network = server(SERVER_ERROR).network;
    const settings = await worker.fetch(navigation('/settings'));

    expect(await home?.text()).toBe(`${ORIGIN}/`);
    expect(await players?.text()).toBe(`${ORIGIN}/players`);
    expect(settings?.status).toBe(SERVER_ERROR);
    expect(await device.caches.keys()).toStrictEqual([SHELL_CACHE]);
    expect(device.keysOf(SHELL_CACHE)).toStrictEqual([
      OFFLINE_PAGE_KEY,
      `${ORIGIN}${APP_CHUNK}`,
      `${ORIGIN}${BUILD_MANIFEST}`,
    ]);
  });

  it('[CL-TRV-13] [TRV-22] answers a screen that it answered online with the offline page once the network does not answer, never with that earlier copy', async () => {
    const online = server();
    let network: Network = online.network;
    const device = deviceCaches(online.network);
    const worker = startWorker(async (request) => network(request), device.caches);
    await worker.install();
    await worker.fetch(navigation('/players'));
    network = offline;

    const reopened = await worker.fetch(navigation('/players'));

    expect(await reopened?.text()).toContain(`<h1>Offline</h1><p>${OFFLINE_PAGE_MESSAGE}</p>`);
    expect(await device.caches.keys()).toStrictEqual([SHELL_CACHE]);
    expect(device.keysOf(SHELL_CACHE)).toHaveLength(SHELL.files.length + 1);
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

    const answers = [
      worker.fetch(new Request(`${ORIGIN}/api/health`)),
      worker.fetch(new Request(`${ORIGIN}/_next/static/chunks/other-9f1d.js`)),
      worker.fetch(new Request(`https://elsewhere.test${APP_CHUNK}`)),
      worker.fetch(new Request(`${ORIGIN}${APP_CHUNK}`, { method: 'POST' })),
    ];

    expect(answers).toStrictEqual([undefined, undefined, undefined, undefined]);
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
});
