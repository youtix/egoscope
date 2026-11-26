import { getDb } from '@/lib/db';
import { guardScreen, paths } from '@/lib/navigation';
import { listByStatus } from '@/lib/taxonomy';

import { TypesByStatus } from './types-by-status';

import type { ReactNode } from 'react';

/**
 * /types, the Types screen (module map section 3.3; IHM-31, IHM-55, TAX-10, TAX-15): the
 * types by state, read in one query once the session is checked. A server without a
 * database is a deployment fault, which the error screen shows.
 */
export default async function TypesPage(): Promise<ReactNode> {
  await guardScreen(paths.types());
  const database = await getDb();
  if (!database.ok) {
    throw new Error(`The server cannot read the types: ${database.error.kind}.`);
  }
  return <TypesByStatus groups={await listByStatus(database.db)} />;
}
