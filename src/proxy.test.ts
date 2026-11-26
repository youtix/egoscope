import { getRedirectUrl, getRewrittenUrl } from 'next/experimental/testing/server';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

import type { DatabaseResult } from '@/lib/db';
import type { NextResponse } from 'next/server';

// The databases that the proxy must never ask for (D-23, module map §1.8).
const harness = vi.hoisted(() => ({
  getDb: vi.fn<() => Promise<DatabaseResult>>(),
  getDirectDb: vi.fn<() => Promise<DatabaseResult>>(),
}));

vi.mock(import('@/lib/db'), async (importOriginal) => ({
  ...(await importOriginal()),
  getDb: harness.getDb,
  getDirectDb: harness.getDirectDb,
}));

// The device sends no cookie to `auth.requireSession`, whose target the proxy's is compared with.
vi.mock(import('next/headers'), () => ({
  cookies: async () => {
    const server = await import('next/server');
    const incoming = new server.NextRequest('https://egoscope.test/').cookies;
    const outgoing = new server.NextResponse().cookies;
    return Object.assign(incoming, {
      set: outgoing.set.bind(outgoing),
      delete: outgoing.delete.bind(outgoing),
    });
  },
}));

const SITE = 'https://egoscope.test';
const COOKIE = '__Host-egoscope-session';
// A cookie value of the shape the auth module writes: a token, then the login instant.
const TOKEN = 'b3JhbmdlLWhhcmJvci1sYW50ZXJuLW9mLXRoZS1vd25lcg.1795770000000';
const HERMETIC = { EGOSCOPE_FAKES: 'all' } as const;
const DEVELOPMENT = { NODE_ENV: 'development' } as const;
const PRODUCTION = { NODE_ENV: 'production' } as const;

type Environment = Readonly<Record<string, string>>;
type Sent = Readonly<{ method?: string; cookie?: string; headers?: Record<string, string> }>;
type Proxy = Awaited<ReturnType<typeof proxyOf>>;

/** The proxy of a server whose environment is `environment`, read as the server loads. */
async function proxyOf(environment: Environment = PRODUCTION) {
  vi.resetModules();
  for (const [name, value] of Object.entries(environment)) {
    vi.stubEnv(name, value);
  }
  const { proxy } = await import('./proxy');
  return proxy;
}

/** A request to `address`, with the session cookie and the headers given. */
function request(address: string, sent: Sent = {}): NextRequest {
  const headers = new Headers(sent.headers);
  if (sent.cookie !== undefined) {
    headers.set('cookie', `${COOKIE}=${sent.cookie}`);
  }
  return new NextRequest(new URL(address, SITE), { method: sent.method ?? 'GET', headers });
}

/** The answer of `proxy` to a request to `address`, with the session cookie and the headers given. */
function ask(proxy: Proxy, address: string, sent: Sent = {}): NextResponse {
  return proxy(request(address, sent));
}

/** Whether the proxy lets the request through to its route. */
function isLetThrough(response: NextResponse): boolean {
  return response.headers.get('x-middleware-next') === '1';
}

const PUBLIC = [
  '/log-in',
  '/_next/static/chunks/main.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/sw.js',
  '/robots.txt',
  '/api/tick',
  '/api/telegram/webhook',
];

describe('the request proxy', () => {
  it.each(PUBLIC)('[CL-TRV-13] [TRV-58] lets %s through without a session', async (path) => {
    const proxy = await proxyOf();

    expect(isLetThrough(ask(proxy, path))).toBe(true);
  });

  it('[TRV-58] [CA-TRV-19] [IHM-05] [IHM-10] sends a page asked for without a session to the login page, with its path and query as next', async () => {
    const proxy = await proxyOf();

    const response = ask(proxy, '/players/12?tab=cases');

    expect(response.status).toBe(307);
    expect(getRedirectUrl(response)).toBe(`${SITE}/log-in?next=%2Fplayers%2F12%3Ftab%3Dcases`);
  });

  it('[IHM-10] sends the device to the very target that auth.requireSession gives a request without a session', async () => {
    const proxy = await proxyOf();
    const { requireSession } = await import('@/lib/auth');

    const required = await requireSession('/choose-password?next=%2F');
    const redirect = getRedirectUrl(ask(proxy, '/choose-password?next=%2F'));

    expect(required.ok ? null : required.error).toStrictEqual({
      kind: 'log-in',
      redirect: redirect?.slice(SITE.length),
      ended: null,
    });
  });

  it.each(['/', '/choose-password', '/log-in/erase', '/settings/account'])(
    '[CL-TRV-13] sends %s, which is not on the closed list, to the login page without a session',
    async (path) => {
      const proxy = await proxyOf();

      expect(getRedirectUrl(ask(proxy, path))).toBe(
        `${SITE}/log-in?next=${encodeURIComponent(path)}`,
      );
    },
  );

  it.each(['/api/health', '/api/exports/full', '/api/test/ping'])(
    '[CL-TRV-13] [TRV-58] refuses the data request %s without a session',
    async (path) => {
      const proxy = await proxyOf();

      const response = ask(proxy, path);

      expect(response.status).toBe(401);
      expect(isLetThrough(response)).toBe(false);
    },
  );

  it('[CL-TRV-13] lets the test controls and the gallery through without a session in the hermetic mode only', async () => {
    const proxy = await proxyOf({ ...PRODUCTION, ...HERMETIC });

    expect(isLetThrough(ask(proxy, '/api/test/ping'))).toBe(true);
    expect(isLetThrough(ask(proxy, '/dev/ui?tab=forms'))).toBe(true);
    expect(getRedirectUrl(ask(proxy, '/dev/ui/other'))).toBe(
      `${SITE}/log-in?next=%2Fdev%2Fui%2Fother`,
    );
  });

  it('answers the gallery not found, with its 404, outside development and the hermetic mode, with or without a session', async () => {
    const proxy = await proxyOf();

    expect(getRewrittenUrl(ask(proxy, '/dev/ui'))).toBe(`${SITE}/_closed`);
    expect(getRewrittenUrl(ask(proxy, '/dev/ui', { cookie: TOKEN }))).toBe(`${SITE}/_closed`);
  });

  it('asks a session for the gallery under next dev', async () => {
    const proxy = await proxyOf(DEVELOPMENT);

    expect(getRedirectUrl(ask(proxy, '/dev/ui'))).toBe(`${SITE}/log-in?next=%2Fdev%2Fui`);
    expect(isLetThrough(ask(proxy, '/dev/ui', { cookie: TOKEN }))).toBe(true);
  });

  it('[TRV-62] lets a request with a session cookie through, and sets the cookie again for 400 days on a read', async () => {
    const proxy = await proxyOf();

    const response = ask(proxy, '/players', { cookie: TOKEN });

    expect(isLetThrough(response)).toBe(true);
    // Next.js also writes the end of the 400 days as an Expires date, from the machine's clock.
    const renewed = response.headers.get('set-cookie')?.replace(/ Expires=[^;]*;/u, '');
    expect(renewed).toBe(
      `${COOKIE}=${TOKEN}; Path=/; Max-Age=34560000; Secure; HttpOnly; SameSite=lax`,
    );
  });

  it('[TRV-62] leaves the cookie of a write, such as a logout, to the action that answers it', async () => {
    const proxy = await proxyOf();

    const response = ask(proxy, '/settings/account', { method: 'POST', cookie: TOKEN });

    expect(isLetThrough(response)).toBe(true);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('[TRV-62] [IHM-08] leaves the cookie alone on the steps of the login page, where the device may erase it', async () => {
    const proxy = await proxyOf();

    const response = ask(proxy, '/log-in/erase?next=%2F', { cookie: TOKEN });

    expect(isLetThrough(response)).toBe(true);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('[D-23] never asks for the database, whatever the request', async () => {
    const proxy = await proxyOf({ ...PRODUCTION, ...HERMETIC });

    const statuses = [
      request('/players', { cookie: TOKEN }),
      request('/players'),
      request('/api/health'),
      request('/api/test/session', { method: 'POST' }),
      request('http://egoscope.test/log-in'),
    ].map((sent) => proxy(sent).status);

    expect(statuses).toStrictEqual([200, 307, 401, 200, 308]);
    expect([harness.getDb.mock.calls, harness.getDirectDb.mock.calls]).toStrictEqual([[], []]);
  });

  it('[TRV-59] [CA-TRV-19] [IHM-10] sends an address typed without encryption to the same address over HTTPS, for good', async () => {
    const proxy = await proxyOf();

    const direct = ask(proxy, 'http://egoscope.test/players?tab=cases', { cookie: TOKEN });
    const forwarded = ask(proxy, '/log-in', { headers: { 'x-forwarded-proto': 'http, https' } });

    expect(direct.status).toBe(308);
    expect(getRedirectUrl(direct)).toBe(`${SITE}/players?tab=cases`);
    expect(getRedirectUrl(forwarded)).toBe(`${SITE}/log-in`);
  });

  it('[TRV-59] keeps plain HTTP on this machine, and what the host received over HTTPS', async () => {
    const proxy = await proxyOf();

    expect(isLetThrough(ask(proxy, 'http://127.0.0.1:3000/log-in'))).toBe(true);
    expect(isLetThrough(ask(proxy, 'http://localhost:3000/log-in'))).toBe(true);
    expect(isLetThrough(ask(proxy, 'http://[::1]:3000/log-in'))).toBe(true);
    const forwarded = ask(proxy, 'http://egoscope.test/log-in', {
      headers: { 'x-forwarded-proto': 'https' },
    });
    expect(isLetThrough(forwarded)).toBe(true);
  });

  it('[IHM-10] puts the session token in no address it redirects to', async () => {
    const proxy = await proxyOf();
    const redirects = [
      ask(proxy, 'http://egoscope.test/players', { cookie: TOKEN }),
      ask(proxy, '/players?tab=cases'),
    ].map((response) => getRedirectUrl(response));

    expect(redirects).toStrictEqual([
      `${SITE}/players`,
      `${SITE}/log-in?next=%2Fplayers%3Ftab%3Dcases`,
    ]);
    expect(redirects.join(' ')).not.toContain(TOKEN);
  });

  it.each([
    ['a page that passes', request('/log-in')],
    ['a redirect to the login page', request('/players')],
    ['a refused data request', request('/api/health')],
    ['a redirect to HTTPS', request('http://egoscope.test/log-in')],
    ['the closed gallery', request('/dev/ui')],
  ])(
    '[TRV-58] [TRV-59] gives %s the security headers and asks search engines not to index it',
    async (_answer, sent) => {
      const proxy = await proxyOf();

      const headers = Object.fromEntries(proxy(sent).headers);

      expect(headers).toMatchObject({
        'content-security-policy':
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
        'strict-transport-security': 'max-age=63072000; includeSubDomains',
        'x-frame-options': 'DENY',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
        'x-robots-tag': 'noindex, nofollow',
      });
    },
  );

  it('lets React evaluate code under next dev only', async () => {
    const proxy = await proxyOf(DEVELOPMENT);

    expect(ask(proxy, '/log-in').headers.get('content-security-policy')).toContain(
      "script-src 'self' 'unsafe-inline' 'unsafe-eval';",
    );
  });
});
