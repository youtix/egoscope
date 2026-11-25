import { z } from 'zod';

import { eventTypes, installation } from '@/lib/db';
import candidateTypeSheets from '@data/seeds/event-types.json';

import type { NewEventTypeRow } from './types';
import type { Database } from '@/lib/db';
import type { EpochMs } from '@/lib/time';

// The only row of the installation table (`id = 1`).
const INSTALLATION_ID = 1;

// A starter sheet of data/seeds/event-types.json: the sheet's own fields, the status and
// the origin of a seeded type being the same for all nine (TAX-15).
const candidateTypeSheet = z.strictObject({
  id: z.string(),
  name: z.string(),
  documentationDifficulty: z.enum(['easy', 'medium', 'hard']),
  isIntimateSubject: z.boolean(),
  knownInAdvance: z.boolean(),
  calendarDerivation: z.enum(['birthday', 'former_team']).nullable(),
  coverageThresholdOutlets: z.number().int().optional(),
  coverageThresholdDays: z.number().int().optional(),
  definition: z.string(),
  inclusionCriteria: z.string(),
  exclusionCriteria: z.string(),
  datingRule: z.string(),
  genericExample: z.string(),
  cautionNotes: z.string(),
});

// The nine candidate types, proposed, of origin scoping: the owner may change every field
// but the identifier before validating (TAX-15, H-TAX-05). A malformed seed file is a bug,
// which the first load reports.
const CANDIDATE_TYPES: readonly NewEventTypeRow[] = z
  .array(candidateTypeSheet)
  .parse(candidateTypeSheets)
  .map((sheet) => ({ ...sheet, status: 'proposed', origin: 'scoping' }));

/**
 * Seeds the reference data of a first start (TAX-15, H-TAX-05): the installation row,
 * dated `startedAt`, and the nine candidate types from `data/seeds/event-types.json`,
 * each created at `startedAt`, proposed and of origin scoping, none validated, none with
 * a doubtful criterion switched off (ADR 0015, ADR 0016, CL-TAX-02, CL-TAX-12,
 * CL-TAX-15). Idempotent: a row
 * that exists already, whatever the owner has made of it since (edited, validated,
 * rejected, withdrawn), is left as it is, so seeding twice changes nothing. Seeds no team
 * and no player (CL-STA-29): those come from the statistics source.
 */
export async function seedCandidateTypes(db: Database, startedAt: EpochMs): Promise<void> {
  await db
    .insert(installation)
    .values({ id: INSTALLATION_ID, firstStartedAt: new Date(startedAt) })
    .onConflictDoNothing({ target: installation.id });
  await db
    .insert(eventTypes)
    .values(CANDIDATE_TYPES.map((type) => ({ ...type, createdAt: new Date(startedAt) })))
    .onConflictDoNothing({
      target: eventTypes.id,
    });
}
