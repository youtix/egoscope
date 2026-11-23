import 'server-only';

import { cookies } from 'next/headers';

/**
 * The name of the cookie that carries a device's session (TRV-62): `__Host-` makes the
 * browser keep it only from this host, over HTTPS, for every path. The request proxy
 * only checks that it is present (module map §1.4).
 */
export const SESSION_COOKIE = '__Host-egoscope-session';

// The longest a browser keeps a cookie, 400 days (RFC 6265bis), in seconds: well beyond the
// idle expiry, which the server applies, so that a device left aside longer still sends its
// token and its login instant, and learns how its session ended (IHM-08).
const COOKIE_LIFETIME_SECONDS = 34_560_000;

const ATTRIBUTES = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } as const;

/** The session cookie the device sent, if any. */
export async function readSessionCookie(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value;
}

/** Gives the device the session cookie `value`: HttpOnly, Secure, SameSite=Lax (TRV-62). */
export async function writeSessionCookie(value: string): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, value, { ...ATTRIBUTES, maxAge: COOKIE_LIFETIME_SECONDS });
}

/** Removes the device's session cookie, with the attributes its `__Host-` name requires. */
export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, '', { ...ATTRIBUTES, maxAge: 0 });
}
