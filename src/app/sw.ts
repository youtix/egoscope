import { APPLY_NEW_VERSION_MESSAGE } from '@/lib/offline';
import { sentence } from '@/lib/wording';

// The service worker of the installable app (TRV-21, TRV-22; module map section 3.1).
// After each production build, next.config.ts bundles this file into /sw.js and starts it
// with the build's static files, which it precaches with the offline page: the page that a
// screen shows when the device has no connection and no copy of it. The offline page is
// built here, a static page with no data, never a route. The worker caches nothing else:
// no screen and no data, before login or after (CL-TRV-13).

/** The static files of one build, which the worker precaches, and their version. */
export type Shell = Readonly<{ version: string; files: readonly string[] }>;

// The parts of a worker's events that this worker reads, which the DOM types of the
// project do not hold.
type ExtendableEvent = Readonly<{ waitUntil: (promise: Promise<unknown>) => void }>;

/** The events that the worker answers, by type. */
export type WorkerEvents = Readonly<{
  install: ExtendableEvent;
  activate: ExtendableEvent;
  fetch: ExtendableEvent &
    Readonly<{ request: Request; respondWith: (response: Promise<Response>) => void }>;
  message: ExtendableEvent & Readonly<{ data: unknown }>;
}>;

type ShellCache = Pick<Cache, 'add' | 'match' | 'put'>;

/** The parts of the worker's global scope that this worker uses. */
export type WorkerScope = Readonly<{
  addEventListener: <T extends keyof WorkerEvents>(
    type: T,
    listener: (event: WorkerEvents[T]) => void,
  ) => void;
  caches: Readonly<{
    open: (name: string) => Promise<ShellCache>;
    match: (request: string) => Promise<Response | undefined>;
    keys: () => Promise<string[]>;
    delete: (name: string) => Promise<boolean>;
  }>;
  fetch: (request: Request) => Promise<Response>;
  location: Readonly<{ origin: string }>;
  skipWaiting: () => Promise<void>;
}>;

// One cache per build, named after its version, so that a new worker installs beside the
// running one and drops the earlier caches once it takes over.
const SHELL_CACHE_PREFIX = 'egoscope-shell-';
// The key of the offline page in that cache, which no route answers.
const OFFLINE_PAGE_KEY = '/offline-page';
// The title of a page, after the template of the root layout.
const TITLE_SEPARATOR = ' · ';

const OFFLINE_PAGE_STYLE = [
  'body{margin:0;font-family:system-ui,sans-serif;line-height:1.5}',
  'main{max-width:48rem;margin:0 auto;padding:1.5rem 1rem}',
  'h1{font-size:1.5rem;margin:0 0 .5rem}',
].join('');

/**
 * The offline page: one heading and one sentence, in the phone's light or dark theme, with
 * no script and nothing to load (TRV-22).
 */
function offlinePage(): Response {
  const heading = sentence('crossCutting.offlinePageHeading');
  const title = [heading, sentence('crossCutting.appName')].join(TITLE_SEPARATOR);
  const html = [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta name="color-scheme" content="light dark"><title>${title}</title>`,
    `<style>${OFFLINE_PAGE_STYLE}</style></head>`,
    `<body><main><h1>${heading}</h1><p>${sentence('crossCutting.offlinePageMessage')}</p>`,
    '</main></body></html>',
  ].join('');
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

const shellCacheName = (shell: Shell): string => SHELL_CACHE_PREFIX + shell.version;

/**
 * Puts the offline page and the build's static files in the build's cache. A file that an
 * earlier build already cached is taken from there, since a static file's name changes
 * with its content; any file that cannot be downloaded fails the installation, which the
 * browser tries again at its next check.
 */
async function install(scope: WorkerScope, shell: Shell): Promise<void> {
  const cache = await scope.caches.open(shellCacheName(shell));
  await cache.put(OFFLINE_PAGE_KEY, offlinePage());
  await Promise.all(
    shell.files.map(async (file) => {
      const earlier = await scope.caches.match(file);
      await (earlier === undefined ? cache.add(file) : cache.put(file, earlier));
    }),
  );
}

/** Drops the caches of earlier builds, and leaves every other cache alone. */
async function activate(scope: WorkerScope, shell: Shell): Promise<void> {
  const current = shellCacheName(shell);
  const names = await scope.caches.keys();
  await Promise.all(
    names
      .filter((name) => name.startsWith(SHELL_CACHE_PREFIX) && name !== current)
      .map(async (name) => scope.caches.delete(name)),
  );
}

/**
 * A screen from the network, or the offline page from the cache when the network does not
 * answer; the page itself if the cache lost it, never the browser's error page (TRV-22).
 */
async function navigate(scope: WorkerScope, shell: Shell, request: Request): Promise<Response> {
  try {
    return await scope.fetch(request);
  } catch {
    const cache = await scope.caches.open(shellCacheName(shell));
    return (await cache.match(OFFLINE_PAGE_KEY)) ?? offlinePage();
  }
}

/** A static file of the build from the cache, or from the network if the cache lost it. */
async function shellFile(scope: WorkerScope, shell: Shell, request: Request): Promise<Response> {
  const cache = await scope.caches.open(shellCacheName(shell));
  return (await cache.match(request)) ?? scope.fetch(request);
}

/**
 * Starts the worker in `scope`, its global scope, with the static files of its build
 * (TRV-21, TRV-22): it precaches them with the offline page as it installs, answers a
 * screen that the network cannot reach with the offline page, and serves the static files
 * from the cache. Everything else goes to the network untouched. A new version waits until
 * the page applies it (`applyNewVersion` of `@/lib/offline`).
 */
export function startServiceWorker(scope: WorkerScope, shell: Shell): void {
  const shellUrls = new Set(shell.files.map((file) => new URL(file, scope.location.origin).href));
  scope.addEventListener('install', (event) => event.waitUntil(install(scope, shell)));
  scope.addEventListener('activate', (event) => event.waitUntil(activate(scope, shell)));
  scope.addEventListener('fetch', (event) => {
    const { request } = event;
    // --- Slot: the network-first copies of the screens marked "cached" in module map
    // section 3.3, which F-offline adds before the offline page
    if (request.mode === 'navigate') {
      event.respondWith(navigate(scope, shell, request));
    } else if (request.method === 'GET' && shellUrls.has(request.url)) {
      event.respondWith(shellFile(scope, shell, request));
    }
  });
  scope.addEventListener('message', (event) => {
    if (event.data === APPLY_NEW_VERSION_MESSAGE) {
      event.waitUntil(scope.skipWaiting());
    }
  });
}
