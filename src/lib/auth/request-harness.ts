import { createTestDatabase } from '@/lib/db';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import type * as Requests from './requests';
import type { Database } from '@/lib/db';
import type { FixedClock } from '@/lib/time';
import type { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';

// The requests of the tests of `requests.ts`, shared by `requests.test.ts` and
// `lockout.test.ts`. Their `vi.mock` factories and the `vi.hoisted` object those read stay in
// each test file: this file imports nothing from the test runner. `instance()` resets the
// modules, so the cookies live in one jar that the test file creates and hands both to its
// `next/headers` mock and to the helpers here.

/** The session cookie that a response sets, as the device reads it. */
type SentCookie = ReturnType<NextResponse['cookies']['get']>;

/** The cookies that `next/headers` gives a request. */
type RequestCookieStore = Awaited<ReturnType<typeof cookies>>;

/** The request handlers of one server instance. */
type Auth = typeof Requests;

/** The session cookie of the requests: the one the device sends, and the one it is sent back. */
export type CookieJar = Readonly<{
  /** The cookies of the current request, for the `next/headers` mock. */
  cookies: () => Promise<RequestCookieStore>;
  /** Runs `call` as a request that carries `cookie`, and gives the cookie its response set. */
  exchange: <T>(
    cookie: string | undefined,
    call: () => Promise<T>,
  ) => Promise<Readonly<{ result: T; sent: SentCookie }>>;
  /** The cookie the last request set, read after the request has run. */
  lastSent: () => SentCookie;
}>;

/** What the test runner lends the harness to start a new server instance. */
export type ModuleReload = Readonly<{
  resetModules: () => unknown;
  stubEnv: (name: 'INITIAL_PASSWORD', value: string) => unknown;
}>;

/** A browser, with the session cookie it keeps. */
type Device = Readonly<{
  name: string;
  kept: { cookie: string | undefined };
  request: <T>(call: () => Promise<T>) => Promise<T>;
}>;

/** The server instances and the devices of one test file. */
type RequestHarness = Readonly<{
  /** A new server instance, configured with the initial password `initial`. */
  instance: (initial?: string) => Promise<Auth>;
  /** The cookie the last request set, read after the request has run. */
  lastSent: () => SentCookie;
  /** A browser named `name`, which starts with `cookie`. */
  device: (name?: string, cookie?: string) => Device;
}>;

/** A fresh database and a clock fixed at `START`, for one test. */
type TestServer = Readonly<{
  db: Database;
  clock: FixedClock;
  restoreClock: () => void;
  close: () => Promise<void>;
}>;

export const INITIAL = 'initial-harbor-lantern';
export const CHOSEN = 'chosen-meadow-violet-quartz';
export const NEWER = 'newer-copper-falcon-river';
export const WRONG = 'wrong-guess-of-a-stranger';
// Monday 23 November 2026, 10:00 Paris time, and a minute.
const START_UNIX_MS = 1_795_424_400_000;
export const START = toEpochMs(START_UNIX_MS);
export const MINUTE = 60_000;

/**
 * The session cookie of one test file's requests (TRV-62): `cookies` gives each request the
 * cookie the device sent, and keeps the one that its response sets.
 */
export function cookieJar(): CookieJar {
  const name = '__Host-egoscope-session';
  let incoming: string | undefined;
  let sent: SentCookie;
  return {
    cookies: async () => {
      const server = await import('next/server');
      const received = new server.NextRequest('https://egoscope.test/').cookies;
      if (incoming !== undefined) {
        received.set(name, incoming);
      }
      const outgoing = new server.NextResponse().cookies;
      const set = (...args: Parameters<typeof outgoing.set>) => {
        sent = outgoing.set(...args).get(name);
        return outgoing;
      };
      return Object.assign(received, { set, delete: outgoing.delete.bind(outgoing) });
    },
    exchange: async (cookie, call) => {
      incoming = cookie;
      sent = undefined;
      const result = await call();
      return { result, sent };
    },
    lastSent: () => sent,
  };
}

/**
 * The server instances and the devices of one test file, whose session cookies go through
 * `jar` (TRV-62); `reload` comes from the test runner.
 */
export function requestHarness(jar: CookieJar, reload: ModuleReload): RequestHarness {
  return {
    instance: async (initial = INITIAL) => {
      reload.resetModules();
      reload.stubEnv('INITIAL_PASSWORD', initial);
      return import('./requests');
    },
    lastSent: jar.lastSent,
    device: (name = 'Phone', cookie?: string) => {
      const kept: { cookie: string | undefined } = { cookie };
      const request = async <T>(call: () => Promise<T>): Promise<T> => {
        const { result, sent } = await jar.exchange(kept.cookie, call);
        if (sent !== undefined) {
          kept.cookie = sent.maxAge === 0 ? undefined : sent.value;
        }
        return result;
      };
      return { name, kept, request };
    },
  };
}

/** A fresh database and a clock fixed at `START`; the test calls `restoreClock` and `close` when it ends. */
export async function openServer(): Promise<TestServer> {
  const database = await createTestDatabase();
  const clock = fixedClock(START);
  return {
    db: database.db,
    clock,
    restoreClock: installFakeClock(clock),
    close: database.close,
  };
}

/** Logs `on` in with `password` (TRV-62). */
export async function logIn(auth: Auth, on: Device, password: string): ReturnType<Auth['logIn']> {
  return on.request(async () => auth.logIn({ password, device: on.name }));
}

/** The session check of a page that `on` opens (TRV-62). */
export async function check(auth: Auth, on: Device): ReturnType<Auth['requireSession']> {
  return on.request(async () => auth.requireSession('/players'));
}

/** Logs `on` in with the initial password, then replaces it with the chosen one (TRV-57). */
export async function chosenOn(auth: Auth, on: Device): Promise<void> {
  await logIn(auth, on, INITIAL);
  await on.request(async () => auth.choosePassword(CHOSEN));
}
