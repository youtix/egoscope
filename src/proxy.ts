import { NextResponse } from 'next/server';

import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from '@/lib/auth';
import { isHermetic, readServerEnv } from '@/lib/env';

import type { NextRequest } from 'next/server';

const LOG_IN = '/log-in';
const LOG_IN_STEPS = `${LOG_IN}/`;
const GALLERY = '/dev/ui';
const UNAUTHORIZED = 401;
const NOT_FOUND = 404;
const PERMANENT_REDIRECT = 308;
// Two years, in seconds: the duration that browsers' HSTS preload lists ask for.
const HSTS_MAX_AGE_SECONDS = 63_072_000;
// A path that no route can take, since Next.js never routes a folder whose name starts
// with an underscore: rewritten to it, with a 404, a request gets the not-found page.
const NO_ROUTE = '/_closed';

/**
 * What answers without a session (CL-TRV-13): the login page and the static files it
 * needs, the web app manifest, the icons, the service worker script, robots.txt, and the
 * two endpoints that check their own secret, the task trigger and Telegram's updates.
 */
const PUBLIC_PATHS: ReadonlySet<string> = new Set([
  LOG_IN,
  '/manifest.webmanifest',
  '/sw.js',
  '/robots.txt',
  '/api/tick',
  '/api/telegram/webhook',
]);
const PUBLIC_PREFIXES = ['/_next/static/', '/icons/'] as const;
// What also answers without a session in the hermetic end-to-end mode, which never runs
// in production: the test controls and the component gallery (module map §3.5).
const HERMETIC_PREFIX = '/api/test/';
// The data requests, which a missing session refuses instead of sending to the login page.
const DATA_PREFIX = '/api/';
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);
const READS: ReadonlySet<string> = new Set(['GET', 'HEAD']);

/** Whether the server runs under `next dev`. */
function isDevelopment(): boolean {
  const env = readServerEnv();
  return env.ok && env.env.NODE_ENV === 'development';
}

/**
 * The security headers of every response (TRV-58, TRV-59): a content security policy
 * that lets in only the app's own resources, without nonces, which would make every page
 * dynamic, and never in a frame; HTTPS only; no referrer, so that no address leaves the
 * app; and the request to search engines not to index anything.
 */
function securityHeaders(): Readonly<Record<string, string>> {
  // React evaluates code under `next dev` to rebuild server stacks; never in production.
  const evaluation = isDevelopment() ? " 'unsafe-eval'" : '';
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${evaluation}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  return {
    'Content-Security-Policy': policy.join('; '),
    'Strict-Transport-Security': `max-age=${String(HSTS_MAX_AGE_SECONDS)}; includeSubDomains`,
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
  };
}

/**
 * Whether the request came over plain HTTP from anywhere but this machine (TRV-59,
 * IHM-10): behind the host's proxy, the protocol that the browser used is the one it
 * forwards. Local development and the end-to-end server listen on a loopback address.
 */
function isPlainHttp(request: NextRequest): boolean {
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',', 1)[0]?.trim();
  const protocol = forwarded === undefined ? request.nextUrl.protocol : `${forwarded}:`;
  return protocol === 'http:' && !LOOPBACK_HOSTS.has(request.nextUrl.hostname);
}

/** The same address over HTTPS, for good (CA-TRV-19). */
function toHttps(request: NextRequest): NextResponse {
  const secure = request.nextUrl.clone();
  secure.protocol = 'https:';
  secure.port = '';
  return NextResponse.redirect(secure, PERMANENT_REDIRECT);
}

/** Whether the component gallery opens: under `next dev` and in the hermetic mode only. */
function isGalleryOpen(): boolean {
  return isDevelopment() || isHermetic();
}

/** Whether `path` answers without a session (CL-TRV-13, module map §3.5). */
function isPublic(path: string): boolean {
  const isListed =
    PUBLIC_PATHS.has(path) || PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix));
  return isListed || (isHermetic() && (path.startsWith(HERMETIC_PREFIX) || path === GALLERY));
}

/**
 * The answer to a request without a session cookie (TRV-58, IHM-05, IHM-10): a data
 * request is refused; a page sends the device to the login page, with the path and the
 * query it asked for as `next`, the target that `auth.requireSession` gives too.
 */
function withoutSession(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith(DATA_PREFIX)) {
    return new NextResponse(null, { status: UNAUTHORIZED });
  }
  const query = new URLSearchParams({ next: `${pathname}${search}` }).toString();
  return NextResponse.redirect(new URL(`${LOG_IN}?${query}`, request.url));
}

/**
 * Lets a request with a session cookie through to the screen or the handler, which
 * checks the session in the database. A page read sets the cookie again, so that the
 * browser keeps it 400 days after this use (TRV-62); a write, such as a logout, sets its
 * own cookie, which a second one on the same response could undo, and so does the step of
 * the login page that erases the device's data, its cookies included.
 */
function withSession(request: NextRequest, cookie: string): NextResponse {
  const response = NextResponse.next();
  if (READS.has(request.method) && !request.nextUrl.pathname.startsWith(LOG_IN_STEPS)) {
    response.cookies.set(SESSION_COOKIE, cookie, SESSION_COOKIE_OPTIONS);
  }
  return response;
}

/** Where the request goes, before the security headers (TRV-58, TRV-59, CL-TRV-13). */
function route(request: NextRequest): NextResponse {
  if (isPlainHttp(request)) {
    return toHttps(request);
  }
  const path = request.nextUrl.pathname;
  if (path === GALLERY && !isGalleryOpen()) {
    return NextResponse.rewrite(new URL(NO_ROUTE, request.url), { status: NOT_FOUND });
  }
  if (isPublic(path)) {
    return NextResponse.next();
  }
  const cookie = request.cookies.get(SESSION_COOKIE)?.value;
  return cookie === undefined ? withoutSession(request) : withSession(request, cookie);
}

/**
 * The request proxy (module map §1.4, §3.5): plain HTTP goes to HTTPS; the closed list of
 * CL-TRV-13 answers without a session; every other page sends a device without a session
 * cookie to the login page, and every other data request is refused; the component
 * gallery is not found outside development and the hermetic mode; every response carries
 * the security headers and `X-Robots-Tag: noindex, nofollow` (TRV-58, TRV-59, IHM-05,
 * IHM-10). It never touches the database: the session itself is checked by the screen or
 * the handler that the request reaches.
 */
export function proxy(request: NextRequest): NextResponse {
  const response = route(request);
  for (const [name, value] of Object.entries(securityHeaders())) {
    response.headers.set(name, value);
  }
  return response;
}
