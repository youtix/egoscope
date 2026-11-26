// The device's contact with the server, at the opening of the app, at each return to it and
// when the network returns, never on a timer (IHM-03, IHM-04, IHM-08): /api/health says
// whether the session is still open and which build the server runs. It runs in the
// browser only.

const HEALTH = '/api/health';
const UNAUTHORIZED = 401;
// The endings of a session that the owner made, by a logout, a password change, a reset or
// a restore: each has the device erase its data, where an expiry erases nothing (IHM-08,
// IHM-42, CL-IHM-10, CL-TRV-05).
const OWNER_ENDINGS: ReadonlySet<unknown> = new Set([
  'logged_out',
  'password_changed',
  'reset',
  'restored',
]);

/**
 * What the server answered: an open session and the build it runs; a refused session, and
 * whether the owner ended it; or no answer, the device being offline or the server unable
 * to work.
 */
type Contact =
  | Readonly<{ kind: 'open'; version: string | null }>
  | Readonly<{ kind: 'refused'; endedByOwner: boolean }>
  | Readonly<{ kind: 'unavailable' }>;

// The builds that the server ran at the first contact of this page and at the last one,
// and the parts of the page that watch them.
const versions: { first?: string | null; last?: string | null } = {};
const watchers = new Set<() => void>();

async function bodyOf(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    // The proxy refuses a request without a session cookie with no body.
    return null;
  }
}

function versionOf(body: unknown): string | null {
  return typeof body === 'object' &&
    body !== null &&
    'version' in body &&
    typeof body.version === 'string'
    ? body.version
    : null;
}

function isEndedByOwner(body: unknown): boolean {
  return (
    typeof body === 'object' && body !== null && 'ended' in body && OWNER_ENDINGS.has(body.ended)
  );
}

function record(version: string | null): void {
  versions.first = versions.first === undefined ? version : versions.first;
  versions.last = version;
  for (const watcher of watchers) {
    watcher();
  }
}

/**
 * Asks the server whether the device's session is still open, and which build it runs,
 * which `hasServerNewVersion` then compares with the first one of this page (IHM-03,
 * IHM-08).
 */
export async function contactServer(): Promise<Contact> {
  let response: Response;
  try {
    response = await fetch(HEALTH, { cache: 'no-store' });
  } catch {
    return { kind: 'unavailable' };
  }
  const body = await bodyOf(response);
  if (response.ok) {
    const version = versionOf(body);
    record(version);
    return { kind: 'open', version };
  }
  return response.status === UNAUTHORIZED
    ? { kind: 'refused', endedByOwner: isEndedByOwner(body) }
    : { kind: 'unavailable' };
}

/**
 * Whether the server has run another build since the first contact of this page: a new
 * version of the app, for a device whose browser runs no service worker (IHM-03).
 */
export function hasServerNewVersion(): boolean {
  return versions.first !== versions.last;
}

/** Calls `onChange` after each answer of the server that gives its build; returns the function that stops. */
export function watchServerVersion(onChange: () => void): () => void {
  watchers.add(onChange);
  return () => {
    watchers.delete(onChange);
  };
}
