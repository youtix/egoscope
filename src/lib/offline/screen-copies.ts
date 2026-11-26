// The device copies of the screens that stay readable offline (IHM-57), which the service
// worker of src/app/sw.ts keeps in one cache and the page reads for the date of a copy. It
// runs in the browser only.

import { toEpochMs } from '@/lib/time';

import type { APPLY_NEW_VERSION_MESSAGE } from './update';
import type { EpochMs } from '@/lib/time';

/** The cache that holds the copies, apart from the static files of each build. */
export const SCREEN_COPIES_CACHE = 'egoscope-screens';

/** The header of a copy that holds the instant it was made, in milliseconds (IHM-57). */
export const COPIED_AT_HEADER = 'x-egoscope-copied-at';

/** The message that asks the worker to reload every copy and replace each whole (CL-IHM-15). */
export const REFRESH_COPIES_MESSAGE = 'refresh-copies';

/**
 * What the worker of src/app/sw.ts shares with the page: its messages, the cache of the
 * copies and the header of a copy's date. The worker writes them out under this type,
 * which the compiler holds to the page's values: a value imported from this module would
 * bring React into the worker's script, which a worker cannot run.
 */
export type WorkerContract = Readonly<{
  applyNewVersionMessage: typeof APPLY_NEW_VERSION_MESSAGE;
  refreshCopiesMessage: typeof REFRESH_COPIES_MESSAGE;
  screenCopiesCache: typeof SCREEN_COPIES_CACHE;
  copiedAtHeader: typeof COPIED_AT_HEADER;
}>;

/**
 * When the device copy of the screen at `url` was made, or null when the device holds
 * none, for the offline banner (IHM-57).
 */
export async function copyDate(url: string): Promise<EpochMs | null> {
  const copies = await caches.open(SCREEN_COPIES_CACHE);
  const copy = await copies.match(url);
  const copiedAt = copy?.headers.get(COPIED_AT_HEADER);
  return copiedAt === null || copiedAt === undefined ? null : toEpochMs(Number(copiedAt));
}
