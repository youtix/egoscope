import { connection } from 'next/server';

import { choosePassword, logIn } from '@/lib/auth';
import { accounts, getDb } from '@/lib/db';
import { isHermetic, readServerEnv } from '@/lib/env';
import { ok } from '@/lib/result';

import type { Result } from '@/lib/result';

const NO_CONTENT = 204;
const NOT_FOUND = 404;
const CONFLICT = 409;
const NO_STORE = { 'Cache-Control': 'no-store' };
const DEVICE = 'End-to-end test browser';
// The password that the control chooses for the hermetic account, never a real one.
const CHOSEN = 'chosen-by-the-session-control';

type Refusal = Readonly<{ kind: string }>;

// One request at a time, so that two first sessions never both replace the initial
// password, the second choice ending the session that the first one opened: the work of
// the last request that arrived, which the next one waits for.
const queue: { last: Promise<unknown> } = { last: Promise.resolve() };

/** Runs `work` once `before` has settled, whether it succeeded or not. */
async function after<T>(before: Promise<unknown>, work: () => Promise<T>): Promise<T> {
  await Promise.allSettled([before]);
  return work();
}

/** Runs `work` once every earlier request of this server has run its own. */
async function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const mine = after(queue.last, work);
  queue.last = mine;
  return mine;
}

/** Whether the account exists with a password already chosen. */
async function passwordChoice(): Promise<Result<boolean, Refusal>> {
  const database = await getDb();
  if (!database.ok) {
    return database;
  }
  const [account] = await database.db.select({ status: accounts.passwordStatus }).from(accounts);
  return ok(account?.status === 'chosen');
}

/**
 * Opens a session of the owner with the auth module's own functions, which set its
 * cookie on the answer: on an account whose password is chosen, a login with it; on a new
 * one, a login with the configured initial password, then the choice of the password.
 */
async function openSession(): Promise<Result<unknown, Refusal>> {
  const chosen = await passwordChoice();
  if (!chosen.ok) {
    return chosen;
  }
  if (chosen.value) {
    return logIn({ password: CHOSEN, device: DEVICE });
  }
  const env = readServerEnv();
  const initial = env.ok ? env.env.INITIAL_PASSWORD?.reveal() : undefined;
  const first = await logIn({ password: initial ?? '', device: DEVICE });
  return first.ok ? choosePassword(CHOSEN) : first;
}

/**
 * End-to-end control of the running app, in the hermetic mode only: opens a session of
 * the owner, whose cookie the answer sets, on an account whose password is already
 * chosen, so that a spec starts signed in (CLAUDE.md, "End-to-end tests"). Not found on
 * any other server.
 */
export async function POST(): Promise<Response> {
  await connection();
  if (!isHermetic()) {
    return new Response(null, { status: NOT_FOUND, headers: NO_STORE });
  }
  const opened = await inTurn(openSession);
  return opened.ok
    ? new Response(null, { status: NO_CONTENT, headers: NO_STORE })
    : Response.json({ refused: opened.error.kind }, { status: CONFLICT, headers: NO_STORE });
}
