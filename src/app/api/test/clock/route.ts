import { connection } from 'next/server';

import { isHermetic } from '@/lib/env';
import { readCommand, scriptClock } from '@/lib/testing';

const BAD_REQUEST = 400;
const NOT_FOUND = 404;
const CONFLICT = 409;
const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * End-to-end control of the running app, in the hermetic mode only (TRV-68): sets the
 * server's clock, `{ "at": "<ISO 8601 instant>" }`, moves it on, `{ "advanceMs": <n> }`,
 * or releases it, `{ "release": true }`, and answers the instant it now reads. Not
 * found on any other server.
 */
export async function POST(request: Request): Promise<Response> {
  await connection();
  if (!isHermetic()) {
    return new Response(null, { status: NOT_FOUND, headers: NO_STORE });
  }
  const scripted = scriptClock(await readCommand(request));
  if (!scripted.ok) {
    const status = scripted.error.kind === 'no_fixed_clock' ? CONFLICT : BAD_REQUEST;
    return Response.json(scripted.error, { status, headers: NO_STORE });
  }
  return Response.json({ now: new Date(scripted.value).toISOString() }, { headers: NO_STORE });
}
