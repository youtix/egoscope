// What this device holds of its drafts, online or not, once the copies that have expired
// are gone (CL-IHM-11, CL-DSN-22, CL-IHM-10).
import { now } from '@/lib/time';

import { hasExpired } from './device-rules';
import { deleteCopy, listCopies, readContact } from './device-store';

import type { DeviceCopy } from './device-store';

/**
 * Deletes every device copy that has expired, by the retention the device last received,
 * whatever its screen and whether or not the network is there, and gives the copies left:
 * a device copy goes at the latest at the draft's expiry (CL-IHM-11, CL-DSN-22).
 */
export async function dropExpiredCopies(): Promise<DeviceCopy[]> {
  const contact = await readContact();
  const at = now();
  const copies = await listCopies();
  const kept: DeviceCopy[] = [];
  for (const copy of copies) {
    if (hasExpired(copy, contact?.retentionDays ?? null, at)) {
      await deleteCopy(copy.key);
    } else {
      kept.push(copy);
    }
  }
  return kept;
}

/**
 * Says whether this device holds a draft whose text has not reached the server, which a
 * logout would lose, for the logout warning; an expired copy, never shown again, is
 * deleted first and counts for nothing (CL-IHM-10, CL-IHM-11).
 */
export async function hasUnsentDeviceDrafts(): Promise<boolean> {
  const copies = await dropExpiredCopies();
  return copies.some((copy) => !copy.sent);
}
