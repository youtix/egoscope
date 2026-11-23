import 'server-only';

import { connection } from 'next/server';

import { isHermetic, readServerEnv } from '@/lib/env';

/**
 * Says whether this server shows the component gallery: under `next dev`, and in
 * the hermetic mode of the end-to-end tests, which check it; nowhere else,
 * production included, where /dev/ui is not found (module map, `/dev/ui`).
 */
export function isGalleryOpen(): boolean {
  const env = readServerEnv();
  return (env.ok && env.env.NODE_ENV === 'development') || isHermetic();
}

/**
 * Says whether this render of /dev/ui shows the gallery. Where the environment
 * closes it, the answer comes at once, without waiting for a request, so that a
 * build there, production's included, prerenders the address as not found and
 * serves it with a 404 status: Next.js fixes a page's status as it prerenders it.
 * Where the environment opens it, the answer waits for the request, so that the
 * server decides again with its own environment, never with the build's.
 */
export async function isGalleryShown(): Promise<boolean> {
  if (!isGalleryOpen()) {
    return false;
  }
  await connection();
  return true;
}
