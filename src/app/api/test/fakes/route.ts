import { connection } from 'next/server';

import { isHermetic } from '@/lib/env';
import { readCommand, scriptFake } from '@/lib/testing';

const BAD_REQUEST = 400;
const NOT_FOUND = 404;
const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * End-to-end control of the running app, in the hermetic mode only (TRV-15): scripts
 * one of the server's fakes, `{ "control": "<fake>.<control>", ...arguments }`, and
 * answers the control it ran; an invalid command runs none. Not found on any other
 * server.
 */
export async function POST(request: Request): Promise<Response> {
  await connection();
  if (!isHermetic()) {
    return new Response(null, { status: NOT_FOUND, headers: NO_STORE });
  }
  const scripted = scriptFake(await readCommand(request));
  return scripted.ok
    ? Response.json({ ran: scripted.value }, { headers: NO_STORE })
    : Response.json(scripted.error, { status: BAD_REQUEST, headers: NO_STORE });
}
