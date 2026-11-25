import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { toEpochMs } from '@/lib/time';

// The connection strings of a made-up configuration, secrets that the journal never
// holds. The direct one holds the pooled one, as a secret may hold another.
const POOLED_URL = 'postgresql://journal@db.example.test/egoscope?sslmode=verify-full';
const DIRECT_URL = `${POOLED_URL}&application_name=migrations`;
const PARIS = 'Europe/Paris';
const OPENED_AT = toEpochMs(Date.UTC(2026, 10, 18, 12));
const DAY_18 = { from: toEpochMs(Date.UTC(2026, 10, 18)), to: toEpochMs(Date.UTC(2026, 10, 19)) };

/**
 * The journal of a server whose configuration holds `variables` and nothing else: its
 * modules load afresh and read that configuration, with a database of their own.
 */
async function journalWith(variables: Readonly<Record<string, string>>) {
  for (const [name, value] of Object.entries(variables)) {
    vi.stubEnv(name, value);
  }
  vi.resetModules();
  const [{ record }, { exportText }, schema] = await Promise.all([
    import('./record'),
    import('./read'),
    import('@/lib/db'),
  ]);
  const database = await schema.createTestDatabase();
  onTestFinished(database.close);
  return { record, exportText, schema, db: database.db };
}

type Journal = Awaited<ReturnType<typeof journalWith>>;

/** The technical details that `journal` stores. */
async function storedDetails(journal: Journal): Promise<readonly unknown[]> {
  const { journalTechnicalDetails } = journal.schema;
  const rows = await journal.db
    .select({ details: journalTechnicalDetails.details })
    .from(journalTechnicalDetails);
  return rows.map((row) => row.details);
}

/** The text of an export. */
async function joined(parts: AsyncIterable<string>): Promise<string> {
  let text = '';
  for await (const part of parts) {
    text += part;
  }
  return text;
}

describe('technical details', { timeout: 60_000 }, () => {
  it('[TRV-44] [TRV-64] masks every secret of the configuration in the technical details it stores, an error message before its cut', async () => {
    const journal = await journalWith({
      DATABASE_URL: POOLED_URL,
      DATABASE_URL_UNPOOLED: DIRECT_URL,
    });
    const lead = 'x'.repeat(280);

    await journal.db.transaction(async (tx) =>
      journal.record(tx, {
        messageKey: 'service_call_failed',
        params: { service: 'database' },
        occurredAt: OPENED_AT,
        technicalDetails: {
          service: 'database',
          operation: `migrate through ${DIRECT_URL}`,
          errorCode: 'ECONNREFUSED',
          errorMessage: `${lead}${POOLED_URL} refused the connection`,
          requestIds: [`${POOLED_URL}#1`, 'request-2'],
          validation: { field: DIRECT_URL },
        },
      }),
    );

    await expect(storedDetails(journal)).resolves.toStrictEqual([
      {
        service: 'database',
        operation: 'migrate through [secret]',
        errorCode: 'ECONNREFUSED',
        errorMessage: `${lead}[secret] refused the`,
        requestIds: ['[secret]#1', 'request-2'],
        validation: { field: '[secret]' },
      },
    ]);
  });

  it('[TRV-44] [TRV-49] [CA-TRV-35] exports the incident of an outside service in plain text and, on demand, its technical details, without any secret value', async () => {
    const journal = await journalWith({ DATABASE_URL: POOLED_URL });
    const { incidents } = journal.schema;
    const [incident] = await journal.db
      .insert(incidents)
      .values({ kind: 'stats_source_unavailable', serviceRole: 'stats_source' })
      .returning({ id: incidents.id });
    await journal.db.transaction(async (tx) =>
      journal.record(tx, {
        messageKey: 'incident_opened',
        incidentId: incident?.id ?? 0,
        params: { incident: { kind: 'stats_source_unavailable' } },
        occurredAt: OPENED_AT,
        technicalDetails: {
          service: 'stats_source',
          operation: 'getSeasonGames',
          httpStatus: 503,
          errorMessage: `Service Unavailable, retried through ${POOLED_URL}`,
        },
      }),
    );

    const plain = await joined(journal.exportText(journal.db, { timeZone: PARIS, period: DAY_18 }));
    const detailed = await joined(
      journal.exportText(journal.db, {
        timeZone: PARIS,
        period: DAY_18,
        withTechnicalDetails: true,
      }),
    );

    const entry = [
      'Activity journal from Wednesday 18 November 2026, 01:00 Paris time to Thursday 19 November 2026, 01:00 Paris time\n',
      'Wednesday 18 November 2026, 13:00 Paris time · Incident · Incident',
      'The incident "Stats source unavailable" opened. It stays open while its cause lasts and closes by itself once the cause is gone. What to do: follow what the incident says on Home or on the app status screen.',
    ].join('\n');
    expect(plain).toBe(`${entry}\n`);
    expect(detailed).toBe(
      `${entry}\n  service: stats_source\n  operation: getSeasonGames\n  httpStatus: 503\n  errorMessage: Service Unavailable, retried through [secret]\n`,
    );
  });

  it('keeps the technical details as given while the configuration is invalid, and so reveals no secret', async () => {
    const journal = await journalWith({ LOG_LEVEL: 'verbose' });

    await journal.db.transaction(async (tx) =>
      journal.record(tx, {
        messageKey: 'service_call_failed',
        params: { service: 'stats_source' },
        occurredAt: OPENED_AT,
        technicalDetails: { service: 'stats_source', httpStatus: 503, errorMessage: 'Unavailable' },
      }),
    );

    await expect(storedDetails(journal)).resolves.toStrictEqual([
      { service: 'stats_source', httpStatus: 503, errorMessage: 'Unavailable' },
    ]);
  });

  it('[CL-STA-17] [CL-DSN-11] keeps the source game identifier in the details of a held-back schedule row only', async () => {
    const journal = await journalWith({});
    const sourceGameRef = '401700001';

    await journal.db.transaction(async (tx) => {
      await journal.record(tx, {
        messageKey: 'stats_status_unknown',
        params: { status: 'Suspended' },
        occurredAt: OPENED_AT,
        technicalDetails: { service: 'stats_source', sourceGameRef },
      });
      await journal.record(tx, {
        messageKey: 'service_call_failed',
        params: { service: 'stats_source' },
        occurredAt: OPENED_AT,
        technicalDetails: { service: 'stats_source', sourceGameRef },
      });
    });

    await expect(storedDetails(journal)).resolves.toStrictEqual([
      { service: 'stats_source', sourceGameRef },
      { service: 'stats_source' },
    ]);
  });
});
