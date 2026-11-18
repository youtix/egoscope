import { connection } from 'next/server';

import { isHermetic } from '@/lib/env';

const NOT_FOUND = 404;
const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * End-to-end control of the running app, in the hermetic mode only: answers that
 * this server is hermetic, and is not found on any other server, like every
 * route under /api/test/.
 */
export async function GET(): Promise<Response> {
  // Answer at request time: a response prerendered at build time would describe
  // the build machine, not the running server.
  await connection();
  return isHermetic()
    ? Response.json({ hermetic: true }, { headers: NO_STORE })
    : new Response(null, { status: NOT_FOUND, headers: NO_STORE });
}
