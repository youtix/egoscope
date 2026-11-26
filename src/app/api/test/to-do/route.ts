import { connection } from 'next/server';
import { z } from 'zod';

import { getDb } from '@/lib/db';
import { isHermetic } from '@/lib/env';
import { closeTodoItem, openTodoItem, readCommand } from '@/lib/testing';

import type { Database } from '@/lib/db';

const BAD_REQUEST = 400;
const NOT_FOUND = 404;
const SERVICE_UNAVAILABLE = 503;
const NO_STORE = { 'Cache-Control': 'no-store' };

const itemRequest = z.strictObject({ name: z.string().min(1) });

type Change = (db: Database, name: string) => Promise<number>;

/**
 * Applies `change` to the to-do item that the request names, `{ "name": "<text>" }`, in the
 * hermetic mode only, and answers the number of items to do; not found on any other server.
 */
async function changeItem(request: Request, change: Change): Promise<Response> {
  await connection();
  if (!isHermetic()) {
    return new Response(null, { status: NOT_FOUND, headers: NO_STORE });
  }
  const parsed = itemRequest.safeParse(await readCommand(request));
  if (!parsed.success) {
    return Response.json(
      { error: 'Expected { "name": text }.' },
      { status: BAD_REQUEST, headers: NO_STORE },
    );
  }
  const database = await getDb();
  if (!database.ok) {
    return Response.json(database.error, { status: SERVICE_UNAVAILABLE, headers: NO_STORE });
  }
  const count = await change(database.db, parsed.data.name);
  return Response.json({ count }, { headers: NO_STORE });
}

/**
 * End-to-end control of the running app, in the hermetic mode only: opens the to-do item
 * named, a failed backup whose cause is the name, and answers the number of items to do
 * that the navigation bar now shows (IHM-16). Not found on any other server.
 */
export async function POST(request: Request): Promise<Response> {
  return changeItem(request, openTodoItem);
}

/**
 * End-to-end control of the running app, in the hermetic mode only: closes the to-do item
 * named, which POST opened, and answers the number of items to do (IHM-16). Not found on
 * any other server.
 */
export async function DELETE(request: Request): Promise<Response> {
  return changeItem(request, closeTodoItem);
}
