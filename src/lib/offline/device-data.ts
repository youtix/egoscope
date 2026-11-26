// The erasure of what the device keeps for the owner. It runs in the browser only.

import { clearDeviceDrafts } from '@/lib/device-drafts';

import { SCREEN_COPIES_CACHE } from './screen-copies';

/**
 * The cookie that the erase step of the login page sets for a short while beside the expiry
 * of the session's, after a session that the owner ended: a browser that honors
 * Clear-Site-Data removes it with the rest, and the login page that finds it has the device
 * erase its data in script, for a browser that ignores that header (IHM-08, DSN-33). Only
 * the server sets it, so that no link can erase a device's data.
 */
export const ERASE_DEVICE_DATA_COOKIE = '__Host-egoscope-erase';

/**
 * Erases every piece of data that this device keeps for the owner: the copies of the
 * screens, the device copies of the drafts, and its storage, the last screen and its
 * scroll position among them (IHM-08, IHM-59, DSN-33, CL-IHM-06, CL-IHM-10). The static
 * files of the build, which hold no data, stay for the next login. Called at logout and
 * at the next contact after a session that the owner ended elsewhere.
 */
export async function clearDeviceData(): Promise<void> {
  await caches.delete(SCREEN_COPIES_CACHE);
  await clearDeviceDrafts();
  localStorage.clear();
  sessionStorage.clear();
}
