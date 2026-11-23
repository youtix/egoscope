import { connection } from 'next/server';
import { z } from 'zod';

import { getDb } from '@/lib/db';
import { isHermetic } from '@/lib/env';
import { applyScenarios, readCommand } from '@/lib/testing';

const BAD_REQUEST = 400;
const NOT_FOUND = 404;
const SERVICE_UNAVAILABLE = 503;
const NO_STORE = { 'Cache-Control': 'no-store' };

const seedRequest = z.strictObject({ scenarios: z.array(z.string()) });

/**
 * End-to-end control of the running app, in the hermetic mode only (TRV-76): applies
 * the scenarios named, `{ "scenarios": ["<name>", …] }`, in the order given, after the
 * reference data, to the server's in-memory database, and answers which it applied; an
 * unknown name applies none. Not found on any other server.
 */
export async function POST(request: Request): Promise<Response> {
  await connection();
  if (!isHermetic()) {
    return new Response(null, { status: NOT_FOUND, headers: NO_STORE });
  }
  const parsed = seedRequest.safeParse(await readCommand(request));
  if (!parsed.success) {
    return Response.json(
      { error: 'Expected { "scenarios": [names] }.' },
      { status: BAD_REQUEST, headers: NO_STORE },
    );
  }
  const database = await getDb();
  if (!database.ok) {
    return Response.json(database.error, { status: SERVICE_UNAVAILABLE, headers: NO_STORE });
  }
  const applied = await applyScenarios(database.db, parsed.data.scenarios);
  return applied.ok
    ? Response.json({ applied: applied.value }, { headers: NO_STORE })
    : Response.json(applied.error, { status: BAD_REQUEST, headers: NO_STORE });
}
