import { connection } from 'next/server';

import { requireSession } from '@/lib/auth';
import { readServerEnv } from '@/lib/env';
import { logger } from '@/lib/log';

import type { ReadyError, SessionEndReason, SessionRefusal } from '@/lib/auth';

const UNAUTHORIZED = 401;
const SERVICE_UNAVAILABLE = 503;
const NO_STORE = { 'Cache-Control': 'no-store' };
const HOME = '/';

/** The answer to a request without a valid session, with how its session ended (IHM-08). */
function unauthorized(ended: SessionEndReason | null): Response {
  return Response.json(
    { status: 'unauthorized', ended },
    { status: UNAUTHORIZED, headers: NO_STORE },
  );
}

/** The answer while the server cannot work, whose cause only the server log names (TRV-64). */
function unavailable(message: string, context: Readonly<Record<string, unknown>>): Response {
  logger.error(message, context);
  return Response.json(
    { status: 'unavailable' },
    { status: SERVICE_UNAVAILABLE, headers: NO_STORE },
  );
}

/** The answer to a session that `requireSession` refused, or could not check. */
function refused(error: ReadyError | SessionRefusal): Response {
  switch (error.kind) {
    case 'log-in': {
      return unauthorized(error.ended);
    }
    case 'choose-password': {
      return unauthorized(null);
    }
    case 'database-not-configured':
    case 'initial-password-missing': {
      return unavailable('The session could not be checked.', { cause: error.kind });
    }
  }
}

/**
 * Health probe, for a device with a valid session only (CL-TRV-13): 200 while the server
 * environment is valid, 503 otherwise. The session check of `auth.requireSession()` is the
 * only database work it does, and a request without a session cookie asks nothing of the
 * database. A refused session answers 401 with how it ended, so that the device erases its
 * data when the owner ended it (IHM-08). The body never says which variable is wrong; the
 * server log names it, and never its value (TRV-64).
 */
export async function GET(): Promise<Response> {
  // Answer at request time: a response prerendered at build time would describe
  // the build machine, not the running server.
  await connection();
  const session = await requireSession(HOME);
  if (!session.ok) {
    return refused(session.error);
  }
  const env = readServerEnv();
  return env.ok
    ? Response.json({ status: 'ok' }, { headers: NO_STORE })
    : unavailable('The server environment is invalid.', { variables: env.error.variables });
}
