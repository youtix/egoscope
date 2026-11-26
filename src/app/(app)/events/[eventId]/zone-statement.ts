import 'server-only';

import { getDb } from '@/lib/db';
import { getParam, storedValueOf } from '@/lib/params';
import { formatZoneStatement } from '@/lib/time';

/**
 * The statement of the zone in use at the top of the event page, whose lists show
 * instants in the short form: "Times in Paris time" for the owner's zone, the
 * `display.timeZone` setting, or for its default while the database cannot be read
 * (CL-IHM-04, IHM-14).
 */
export async function zoneStatement(): Promise<string> {
  const database = await getDb();
  const zone = database.ok
    ? await getParam(database.db, 'display.timeZone')
    : storedValueOf('display.timeZone', undefined);
  return formatZoneStatement(zone);
}
