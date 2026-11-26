import { unstable_rethrow } from 'next/navigation';

import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/log';
import { paths } from '@/lib/navigation';
import { DeviceShell } from '@/lib/offline';
import { getParam } from '@/lib/params';

import type { ReactNode } from 'react';

/**
 * The owner's zone, the `display.timeZone` setting, for an open session only, read through
 * the connection that the session check already woke. Without an open session there is
 * none: the screen itself sends the device to the login page.
 */
async function ownerTimeZone(): Promise<string | null> {
  const session = await requireSession(paths.home());
  if (!session.ok) {
    return null;
  }
  const database = await getDb();
  return database.ok ? getParam(database.db, 'display.timeZone') : null;
}

/**
 * The zone, or none when the database fails while it is read, since the screen below
 * answers for itself. The errors through which Next.js controls the request go on to it.
 */
async function timeZoneOrNone(): Promise<string | null> {
  try {
    return await ownerTimeZone();
  } catch (error) {
    unstable_rethrow(error);
    logger.error('The device pieces are left out, since the time zone could not be read.', {
      error,
    });
    return null;
  }
}

/**
 * The app-wide device pieces of a signed-in owner (module map section 2.1), whose offline
 * banner writes the date of a copy in the owner's zone (IHM-57, CL-IHM-04); nothing for any
 * other request, nor when the database fails.
 */
export async function DevicePieces(): Promise<ReactNode> {
  const timeZone = await timeZoneOrNone();
  return timeZone === null ? null : <DeviceShell timeZone={timeZone} />;
}
