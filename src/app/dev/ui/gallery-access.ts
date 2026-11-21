import 'server-only';

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
