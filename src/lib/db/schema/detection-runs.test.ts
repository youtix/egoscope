import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { describeColumns, describeForeignKeys, describeIndexes } from '../catalog';
import { createTestDatabase } from '../test-database';
import { insertParents, PARENTS } from '../test-parents';
import { classificationIncidentDetails, detectionRuns, exposureCounts } from './detection-runs';
import { incidents } from './incidents';
import { followedPlayers } from './players';
import { taskRuns } from './scheduler';

import type { Database } from '../types';

// The tables of detection.md about its counts, its runs and its incidents.
const TABLES = ['classification_incident_details', 'detection_runs', 'exposure_counts'];

// Their columns, table by table and each table's in the order of the model, with the
// type, the null and the default that the model gives each, in the words of SQL.
const COLUMNS = [
  'classification_incident_details.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'classification_incident_details.incident_id integer NOT NULL',
  'classification_incident_details.cause text NOT NULL',
  'detection_runs.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'detection_runs.task_run_id integer NOT NULL',
  'detection_runs.articles_received integer NOT NULL DEFAULT 0',
  'detection_runs.articles_not_prefiltered_in integer NOT NULL DEFAULT 0',
  'detection_runs.articles_classified integer NOT NULL DEFAULT 0',
  'detection_runs.articles_classified_without_fact integer NOT NULL DEFAULT 0',
  'detection_runs.articles_failed integer NOT NULL DEFAULT 0',
  'detection_runs.articles_still_queued integer NOT NULL DEFAULT 0',
  'detection_runs.facts_attached_to_existing_event integer NOT NULL DEFAULT 0',
  'detection_runs.facts_below_threshold integer NOT NULL DEFAULT 0',
  'detection_runs.facts_below_coverage_threshold integer NOT NULL DEFAULT 0',
  'detection_runs.facts_old integer NOT NULL DEFAULT 0',
  'detection_runs.facts_already_reported_by_backtest integer NOT NULL DEFAULT 0',
  'detection_runs.proposals_submitted integer NOT NULL DEFAULT 0',
  'detection_runs.occurrences_added integer NOT NULL DEFAULT 0',
  'detection_runs.descriptions_replaced integer NOT NULL DEFAULT 0',
  'detection_runs.events_created integer NOT NULL DEFAULT 0',
  'detection_runs.quota_calls_used integer NOT NULL DEFAULT 0',
  'detection_runs.quota_calls_left integer',
  'exposure_counts.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'exposure_counts.player_id uuid NOT NULL',
  'exposure_counts.counted_on date NOT NULL',
  'exposure_counts.article_count integer NOT NULL DEFAULT 0',
];

// Their indexes, primary keys and unique constraints included, in the words of the catalog.
const INDEXES = [
  'CREATE UNIQUE INDEX classification_incident_details_incident_uq ON public.classification_incident_details USING btree (incident_id)',
  'CREATE UNIQUE INDEX classification_incident_details_pkey ON public.classification_incident_details USING btree (id)',
  'CREATE UNIQUE INDEX detection_runs_pkey ON public.detection_runs USING btree (id)',
  'CREATE UNIQUE INDEX detection_runs_task_run_uq ON public.detection_runs USING btree (task_run_id)',
  'CREATE UNIQUE INDEX exposure_counts_pkey ON public.exposure_counts USING btree (id)',
  'CREATE UNIQUE INDEX exposure_counts_uq ON public.exposure_counts USING btree (player_id, counted_on)',
];

// Their references: each row goes with its player, its run or its incident.
const FOREIGN_KEYS = [
  'classification_incident_details FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE',
  'detection_runs FOREIGN KEY (task_run_id) REFERENCES task_runs(id) ON DELETE CASCADE',
  'exposure_counts FOREIGN KEY (player_id) REFERENCES followed_players(id) ON DELETE CASCADE',
];

const RUN_ID = 1;
const INCIDENT_ID = 1;
const EXPOSURE = { playerId: PARENTS.playerId, countedOn: '2024-12-02' } as const;
// The incident of a reached quota of the language model.
const QUOTA_REACHED = {
  kind: 'quota_reached',
  causeKey: 'language_model',
  serviceRole: 'language_model',
  quotaCauses: ['limit_reached'],
} as const;
// The counters of a run, each of which a negative value breaks.
const COUNTERS = [
  'articlesReceived',
  'articlesNotPrefilteredIn',
  'articlesClassified',
  'articlesClassifiedWithoutFact',
  'articlesFailed',
  'articlesStillQueued',
  'factsAttachedToExistingEvent',
  'factsBelowThreshold',
  'factsBelowCoverageThreshold',
  'factsOld',
  'factsAlreadyReportedByBacktest',
  'proposalsSubmitted',
  'occurrencesAdded',
  'descriptionsReplaced',
  'eventsCreated',
  'quotaCallsUsed',
  'quotaCallsLeft',
] as const;

/** The error of a query that a CHECK constraint refused. */
const violationOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23514', constraint },
});

/** The error of a query that a unique index refused. */
const duplicateOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23505', constraint },
});

describe('the counts, runs and incidents of detection', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    await insertParents(db);
    await db
      .insert(taskRuns)
      .values({ taskKey: 'detection', trigger: 'on_demand', dueAt: sql`now()` });
    await db.insert(incidents).values(QUOTA_REACHED);
    return database.close;
  }, 60_000);

  it('builds the columns, indexes and references that detection.md gives these tables', async () => {
    await expect(describeColumns(db, TABLES)).resolves.toStrictEqual(COLUMNS);
    await expect(describeIndexes(db, TABLES)).resolves.toStrictEqual(INDEXES);
    await expect(describeForeignKeys(db, TABLES)).resolves.toStrictEqual(FOREIGN_KEYS);
  });

  it('[DET-57] [CL-JOU-06] keeps one exposure count per player and day, never negative, which goes with the player', async () => {
    await db.insert(exposureCounts).values(EXPOSURE);
    const again = db.insert(exposureCounts).values({ ...EXPOSURE, articleCount: 2 });
    await expect(again).rejects.toMatchObject(duplicateOf('exposure_counts_uq'));
    const negative = db
      .insert(exposureCounts)
      .values({ ...EXPOSURE, countedOn: '2024-12-03', articleCount: -1 });
    await expect(negative).rejects.toMatchObject(
      violationOf('exposure_counts_article_count_check'),
    );
    await expect(
      db.select({ count: exposureCounts.articleCount }).from(exposureCounts),
    ).resolves.toStrictEqual([{ count: 0 }]);

    await db.insert(exposureCounts).values({ ...EXPOSURE, playerId: PARENTS.otherPlayerId });

    await db.delete(followedPlayers).where(eq(followedPlayers.id, PARENTS.otherPlayerId));

    await expect(
      db.select({ player: exposureCounts.playerId }).from(exposureCounts),
    ).resolves.toStrictEqual([{ player: PARENTS.playerId }]);
  });

  it('[DET-55] [TRV-26] keeps one summary per detection run, its counters at zero and the quota left unknown by default', async () => {
    await db.insert(detectionRuns).values({ taskRunId: RUN_ID });
    const again = db.insert(detectionRuns).values({ taskRunId: RUN_ID });
    await expect(again).rejects.toMatchObject(duplicateOf('detection_runs_task_run_uq'));

    const [run] = await db.select().from(detectionRuns);

    expect(run).toStrictEqual({
      id: 1,
      taskRunId: RUN_ID,
      ...Object.fromEntries(COUNTERS.map((counter) => [counter, 0])),
      quotaCallsLeft: null,
    });
    await db.delete(taskRuns).where(eq(taskRuns.id, RUN_ID));
    await expect(db.$count(detectionRuns)).resolves.toBe(0);
  });

  it.each(COUNTERS)('[DET-55] refuses a run whose counter %s is negative', async (counter) => {
    const insert = db.insert(detectionRuns).values({ taskRunId: RUN_ID, [counter]: -1 });

    await expect(insert).rejects.toMatchObject(violationOf('detection_runs_counters_check'));
  });

  it('[DET-11] [CL-DET-04] details a quota incident by one of the causes of the core, and goes with it', async () => {
    await db.insert(incidents).values([
      { kind: 'quota_warning', causeKey: 'language_model', serviceRole: 'language_model' },
      { ...QUOTA_REACHED, causeKey: 'language_model-answers', quotaCauses: ['not_answering'] },
    ]);
    await db.insert(classificationIncidentDetails).values([
      { incidentId: INCIDENT_ID, cause: 'limit_reached' },
      { incidentId: 2, cause: 'refused_before_limit' },
      { incidentId: 3, cause: 'not_answering' },
    ]);
    const again = db
      .insert(classificationIncidentDetails)
      .values({ incidentId: INCIDENT_ID, cause: 'not_answering' });
    await expect(again).rejects.toMatchObject(
      duplicateOf('classification_incident_details_incident_uq'),
    );
    const outside = db
      .insert(classificationIncidentDetails)
      .values({ incidentId: 2, cause: sql`'outside'` });
    await expect(outside).rejects.toMatchObject(
      violationOf('classification_incident_details_cause_check'),
    );

    await db.delete(incidents).where(eq(incidents.id, INCIDENT_ID));

    await expect(db.$count(classificationIncidentDetails)).resolves.toBe(2);
  });
});
