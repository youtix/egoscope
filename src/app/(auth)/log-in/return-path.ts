import type { PasswordStatus } from '@/lib/auth';
import type { Route } from 'next';

const HOME = '/';
const LOG_IN = '/log-in';
// Any origin will do: a path read against it keeps it, an address elsewhere does not.
const ORIGIN = 'https://egoscope.invalid';

/** Whether `path` is the login page or one of its steps, never a screen to return to. */
function isLogInPath(path: string): boolean {
  return path === LOG_IN || path.startsWith(`${LOG_IN}/`);
}

/**
 * Whether `next` is a path of this app, with its query, written as a browser writes it:
 * nothing that leaves the app, such as another site's address or `//other.example`.
 */
function isReturnPath(next: unknown): next is Route {
  const url = typeof next === 'string' && next.startsWith('/') ? URL.parse(next, ORIGIN) : null;
  return (
    url?.origin === ORIGIN && `${url.pathname}${url.search}` === next && !isLogInPath(url.pathname)
  );
}

/**
 * The screen to return to once the device is logged in, from the `next` of the login
 * address: a path of this app, or Home for anything else, so that the login never sends
 * the device off the app (IHM-10, IHM-11). The login page itself is never one.
 */
export function returnPath(next: unknown): Route {
  return isReturnPath(next) ? next : HOME;
}

/**
 * Where a device goes once its session is open, from the screen it asked for, `next`:
 * that screen, or first "Choose your password", which then leads to it, while the
 * account uses its initial password (TRV-57, IHM-06, IHM-11).
 */
export function destination(passwordStatus: PasswordStatus, next: Route): Route {
  return passwordStatus === 'initial'
    ? `/choose-password?${new URLSearchParams({ next }).toString()}`
    : next;
}
