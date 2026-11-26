import { NextResponse } from 'next/server';

import { currentSession, SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from '@/lib/auth';
import { logger } from '@/lib/log';
import { ERASE_DEVICE_DATA_COOKIE } from '@/lib/offline';

import type { SessionEndReason } from '@/lib/auth';
import type { NextRequest } from 'next/server';

const SEE_OTHER = 303;
// What the browser erases of this app: its HTTP cache; its cookies, the session's among
// them; and its storage, the device drafts and the service worker with the copies of the
// screens that it caches among them (IHM-08, DSN-33).
const EVERYTHING = '"cache", "cookies", "storage"';
// How long the login page has the device erase its data in script, in seconds: enough for
// the login page that this step sends the device to.
const ERASE_IN_SCRIPT_SECONDS = 300;

/** How the device's session ended, or null while it is open, absent or cannot be checked. */
async function endingOfSession(): Promise<SessionEndReason | null> {
  const session = await currentSession();
  if (!session.ok) {
    logger.error('The login screen could not check the session.', { cause: session.error.kind });
    return null;
  }
  return session.value.state === 'ended' ? session.value.reason : null;
}

/**
 * The step of the login page that tells a device how its session ended (IHM-08,
 * CL-IHM-10, CL-TRV-05): a session that the owner ended, by a logout, a password change,
 * a reset or a restore, has the device erase every piece of data it holds, its session
 * cookie among them (TRV-62), before the login page shows, "Data restored" after a
 * restore; an expired one leaves the device's
 * data, its drafts included, to be found after the login (IHM-11), and its cookie, so
 * that a later logout of every device still has it erase them (CL-IHM-10). Either way the
 * device goes back to the login page, with the screen it asked for and how its session
 * ended. Only the session that the server checks decides, so that no link can erase a
 * device's data.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const query = new URLSearchParams({ next: request.nextUrl.searchParams.get('next') ?? '/' });
  const ended = await endingOfSession();
  if (ended !== null) {
    query.set('ended', ended);
  }
  // A path, which the browser reads against the address it asked for: the server may know
  // itself by another host name than the one the device reached it by.
  const response = new NextResponse(null, {
    status: SEE_OTHER,
    headers: { Location: `/log-in?${query.toString()}`, 'Cache-Control': 'no-store' },
  });
  if (ended !== null && ended !== 'expired') {
    response.headers.set('Clear-Site-Data', EVERYTHING);
    // The cookie is expired too, where the browser ignores Clear-Site-Data, so that the
    // next login page finds no session and never sends the device through the step again.
    response.cookies.set(SESSION_COOKIE, '', { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
    // Where the browser ignores Clear-Site-Data too, the login page erases in script.
    response.cookies.set(ERASE_DEVICE_DATA_COOKIE, '1', {
      ...SESSION_COOKIE_OPTIONS,
      maxAge: ERASE_IN_SCRIPT_SECONDS,
    });
  }
  return response;
}
