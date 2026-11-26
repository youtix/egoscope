import { now } from '@/lib/time';
import { sentence } from '@/lib/wording';

import type { WorkerContract } from '@/lib/offline';

// The service worker of the installable app (TRV-21, TRV-22; module map section 3.1).
// After each production build, next.config.ts bundles this file into /sw.js and starts it
// with the build's static files, which it precaches with the offline page: the page that a
// screen shows when the device has no connection and no copy of it. The offline page is
// built here, a static page with no data, never a route. Beside them, it keeps a copy of
// each screen that stays readable offline (module map section 3.3), as the network last
// answered it to a signed-in owner, and nothing before login (IHM-57, CL-TRV-13).

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

type ShellCache = Pick<Cache, 'add' | 'delete' | 'keys' | 'match' | 'put'>;

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
// The one screen that a copy answers first, which the page then refreshes (IHM-04).
const HOME = '/';
// The header of a copy that names the build whose static files it needs.
const BUILD_HEADER = 'x-egoscope-build';
// The answer of a screen whose object no longer exists, whose copy goes (CL-IHM-15).
const NOT_FOUND = 404;
// What the page shares with the worker, written out as its type says: a value of
// @/lib/offline would bring React into this script, which a worker cannot run.
const PAGE: WorkerContract = {
  applyNewVersionMessage: 'apply-new-version',
  refreshCopiesMessage: 'refresh-copies',
  screenCopiesCache: 'egoscope-screens',
  copiedAtHeader: 'x-egoscope-copied-at',
};
// The screens of module map section 3.3 whose Offline column says "cached" (IHM-57): Home,
// the players and a player's page, a profile, a case, a backtest request, More and, in
// Lot 2, an alert sheet. "new" is the static sibling of a player's identifier.
const KEPT_SCREENS: readonly RegExp[] = [
  /^\/$/u,
  /^\/players$/u,
  /^\/players\/(?!new$)[^/]+$/u,
  /^\/players\/[^/]+\/profiles\/[^/]+$/u,
  /^\/cases\/[^/]+$/u,
  /^\/backtests\/[^/]+$/u,
  /^\/more$/u,
  /^\/alerts\/[^/]+$/u,
];

const OFFLINE_PAGE_STYLE = [
  'body{margin:0;font-family:system-ui,sans-serif;line-height:1.5}',
  'main{max-width:48rem;margin:0 auto;padding:1.5rem 1rem}',
  'h1{font-size:1.5rem;margin:0 0 .5rem}',
].join('');

/**
 * The offline page: one heading and one sentence, in the phone's light or dark theme, with
 * no script and nothing to load (TRV-22): `message` says that the screen has not been
 * loaded yet, or that it is not available offline.
 */
function offlinePage(message: string): Response {
  const heading = sentence('crossCutting.offlinePageHeading');
  const title = [heading, sentence('crossCutting.appName')].join(TITLE_SEPARATOR);
  const html = [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta name="color-scheme" content="light dark"><title>${title}</title>`,
    `<style>${OFFLINE_PAGE_STYLE}</style></head>`,
    `<body><main><h1>${heading}</h1><p>${message}</p>`,
    '</main></body></html>',
  ].join('');
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

const shellCacheName = (shell: Shell): string => SHELL_CACHE_PREFIX + shell.version;

/** Whether the screen at `url` stays readable offline from its copy (IHM-57). */
const isKeptScreen = (url: string): boolean => {
  const { pathname } = new URL(url);
  return KEPT_SCREENS.some((screen) => screen.test(pathname));
};

/**
 * Puts the offline page and the build's static files in the build's cache. A file that an
 * earlier build already cached is taken from there, since a static file's name changes
 * with its content; any file that cannot be downloaded fails the installation, which the
 * browser tries again at its next check.
 */
async function install(scope: WorkerScope, shell: Shell): Promise<void> {
  const cache = await scope.caches.open(shellCacheName(shell));
  await cache.put(OFFLINE_PAGE_KEY, offlinePage(sentence('crossCutting.offlinePageMessage')));
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

/** The offline page of a screen not loaded yet, from the cache, or built again if the cache lost it. */
async function notLoadedPage(scope: WorkerScope, shell: Shell): Promise<Response> {
  const cache = await scope.caches.open(shellCacheName(shell));
  return (
    (await cache.match(OFFLINE_PAGE_KEY)) ??
    offlinePage(sentence('crossCutting.offlinePageMessage'))
  );
}

/**
 * A screen that needs the network, from it, or the offline page that says that the screen
 * is not available offline when the network does not answer, never the browser's error
 * page (TRV-22, IHM-57).
 */
async function navigate(request: Request, scope: WorkerScope): Promise<Response> {
  try {
    return await scope.fetch(request);
  } catch {
    return offlinePage(sentence('crossCutting.offlinePageNotKept'));
  }
}

/** The network's answer for the screen at `url`. */
type ScreenAnswer = Readonly<{ url: string; answer: Response }>;

/**
 * Replaces the copy of the screen at `url` whole with the network's `answer` to the signed-in
 * owner, marked with its instant and its build; deletes it when the screen's object no
 * longer exists; and keeps it with its date for any other answer, a redirect to the login
 * page or a server error (IHM-57, IHM-59, DSN-33, CL-IHM-15, CL-DSN-18).
 */
async function keepCopy(
  copies: ShellCache,
  shell: Shell,
  { url, answer }: ScreenAnswer,
): Promise<void> {
  if (answer.ok) {
    const headers = new Headers(answer.headers);
    headers.set(PAGE.copiedAtHeader, String(now()));
    headers.set(BUILD_HEADER, shell.version);
    // The copy answers its address alone, whatever headers ask for it.
    headers.delete('Vary');
    const { status, statusText } = answer;
    await copies.put(url, new Response(answer.body, { status, statusText, headers }));
  } else if (answer.status === NOT_FOUND) {
    await copies.delete(url);
  }
}

/**
 * A screen that stays readable offline (IHM-57): from the network, which replaces its copy,
 * or from its copy when the network does not answer, else the offline page of a screen not
 * loaded yet. Home answers from a copy of the running build first, which the page then
 * refreshes (IHM-04, CL-IHM-06).
 */
async function keptScreen(
  scope: WorkerScope,
  shell: Shell,
  event: WorkerEvents['fetch'],
): Promise<Response> {
  const { request } = event;
  const copies = await scope.caches.open(PAGE.screenCopiesCache);
  const copy = await copies.match(request.url);
  const isHome = new URL(request.url).pathname === HOME;
  if (isHome && copy?.headers.get(BUILD_HEADER) === shell.version) {
    return copy;
  }
  try {
    const answer = await scope.fetch(request);
    event.waitUntil(keepCopy(copies, shell, { url: request.url, answer: answer.clone() }));
    return answer;
  } catch {
    return copy ?? notLoadedPage(scope, shell);
  }
}

/**
 * Reloads every copy from the network, as the page asks at each connection, and replaces
 * each whole; a copy whose screen no longer stays readable offline goes, and one that the
 * network cannot reach stays with its date (CL-IHM-15, CL-DSN-18).
 */
async function refreshCopies(scope: WorkerScope, shell: Shell): Promise<void> {
  const copies = await scope.caches.open(PAGE.screenCopiesCache);
  const requests = await copies.keys();
  await Promise.all(
    requests.map(async ({ url }) => {
      if (!isKeptScreen(url)) {
        await copies.delete(url);
        return;
      }
      try {
        const answer = await scope.fetch(new Request(url, { redirect: 'manual' }));
        await keepCopy(copies, shell, { url, answer });
      } catch {
        // No connection: the copy stays with its date.
      }
    }),
  );
}

/** A static file of the build from the cache, or from the network if the cache lost it. */
async function shellFile(scope: WorkerScope, shell: Shell, request: Request): Promise<Response> {
  const cache = await scope.caches.open(shellCacheName(shell));
  return (await cache.match(request)) ?? scope.fetch(request);
}

/**
 * Starts the worker in `scope`, its global scope, with the static files of its build
 * (TRV-21, TRV-22): it precaches them with the offline page as it installs, keeps a copy of
 * each screen that stays readable offline and answers it from there when the network does
 * not, reloading every copy when the page asks (IHM-57, CL-IHM-15), answers any other
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
    if (request.mode === 'navigate' && isKeptScreen(request.url)) {
      event.respondWith(keptScreen(scope, shell, event));
      return;
    }
    if (request.mode === 'navigate') {
      event.respondWith(navigate(request, scope));
    } else if (request.method === 'GET' && shellUrls.has(request.url)) {
      event.respondWith(shellFile(scope, shell, request));
    }
  });
  scope.addEventListener('message', (event) => {
    if (event.data === PAGE.applyNewVersionMessage) {
      event.waitUntil(scope.skipWaiting());
    } else if (event.data === PAGE.refreshCopiesMessage) {
      event.waitUntil(refreshCopies(scope, shell));
    }
  });
}
