import { connection } from 'next/server';

import { readServerEnv } from '@/lib/env';
import { logger } from '@/lib/log';

const SERVICE_UNAVAILABLE = 503;
const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * Health probe: 200 while the server environment is valid, 503 otherwise. The
 * body never says which variable is wrong; the server log names it, and never
 * its value (TRV-64).
 */
export async function GET(): Promise<Response> {
  // Answer at request time: a response prerendered at build time would describe
  // the build machine, not the running server.
  await connection();
  const env = readServerEnv();
  if (env.ok) {
    return Response.json({ status: 'ok' }, { headers: NO_STORE });
  }
  logger.error('The server environment is invalid.', { variables: env.error.variables });
  return Response.json(
    { status: 'unavailable' },
    { status: SERVICE_UNAVAILABLE, headers: NO_STORE },
  );
}
