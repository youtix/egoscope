import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';

import { describeColumns, describeForeignKeys, describeIndexes } from '../catalog';
import { createTestDatabase } from '../test-database';
import {
  alertSheetEvents,
  alertSheetOutcomes,
  alertSheets,
  alertSheetSections,
  alertSheetSnapshots,
} from './alerts';
import { alertSheetCaveats, alertSheetExpectedGames, alertSheetUpdates } from './alerts-history';
import { isOutsideArchive } from './archive';
import {
  collectionGaps,
  collectionSourceReads,
  pressSourceDailyCounts,
  pressSourceDeactivations,
  pressSourceIncidents,
  pressSources,
} from './collection';
import { articles, articleSightings, dedupTraces } from './collection-articles';
import { articleParts, classificationResults } from './detection';
import { articleAttachments, classificationFacts } from './detection-facts';
import { classificationIncidentDetails, detectionRuns, exposureCounts } from './detection-runs';
import { notificationDailyCounts, telegramLinkCodes, telegramLinks } from './notifications';
import {
  notificationMessageEvents,
  notificationMessageFacts,
  notificationMessages,
} from './notifications-messages';
import {
  caseCategoryChanges,
  forecastVersions,
  regroupingExits,
  trackedCaseDecisions,
  trackedCases,
  trackedGameResults,
} from './tracking';

import type { Database } from '../types';

// The tables of notifications.md about the Telegram link and the daily cap.
const TABLES = ['notification_daily_counts', 'telegram_link_codes', 'telegram_links'];

// Their columns, table by table and each table's in the order of the model, with the
// type, the null and the default that the model gives each, in the words of SQL.
const COLUMNS = [
  'notification_daily_counts.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'notification_daily_counts.cap_day date NOT NULL',
  'notification_daily_counts.sent_count smallint NOT NULL DEFAULT 0',
  'telegram_link_codes.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'telegram_link_codes.code_sha256 bytea NOT NULL',
  'telegram_link_codes.created_at timestamp with time zone NOT NULL',
  'telegram_link_codes.expires_at timestamp with time zone NOT NULL',
  'telegram_link_codes.used_at timestamp with time zone',
  'telegram_links.id smallint NOT NULL DEFAULT 1',
  "telegram_links.status text NOT NULL DEFAULT 'not_linked'::text",
  'telegram_links.status_changed_at timestamp with time zone NOT NULL',
  'telegram_links.chat_id bigint',
  'telegram_links.linked_at timestamp with time zone',
  'telegram_links.last_successful_send_at timestamp with time zone',
  "telegram_links.inbound_mode text NOT NULL DEFAULT 'webhook'::text",
  'telegram_links.last_update_id bigint',
  'telegram_links.last_update_at timestamp with time zone',
  'telegram_links.row_version integer NOT NULL DEFAULT 1',
];

// Their indexes, primary keys and unique constraints included, in the words of the catalog.
const INDEXES = [
  'CREATE UNIQUE INDEX notification_daily_counts_day_uq ON public.notification_daily_counts USING btree (cap_day)',
  'CREATE UNIQUE INDEX notification_daily_counts_pkey ON public.notification_daily_counts USING btree (id)',
  'CREATE UNIQUE INDEX telegram_link_codes_code_uq ON public.telegram_link_codes USING btree (code_sha256)',
  'CREATE UNIQUE INDEX telegram_link_codes_pkey ON public.telegram_link_codes USING btree (id)',
  'CREATE UNIQUE INDEX telegram_links_pkey ON public.telegram_links USING btree (id)',
];

// They reference no other table.
const FOREIGN_KEYS: readonly string[] = [];

// The tables of Lot 2 that backups and full exports keep, every one but the link codes.
const ARCHIVED = [
  alertSheetCaveats,
  alertSheetEvents,
  alertSheetExpectedGames,
  alertSheetOutcomes,
  alertSheets,
  alertSheetSections,
  alertSheetSnapshots,
  alertSheetUpdates,
  articleAttachments,
  articleParts,
  articles,
  articleSightings,
  caseCategoryChanges,
  classificationFacts,
  classificationIncidentDetails,
  classificationResults,
  collectionGaps,
  collectionSourceReads,
  dedupTraces,
  detectionRuns,
  exposureCounts,
  forecastVersions,
  notificationDailyCounts,
  notificationMessageEvents,
  notificationMessageFacts,
  notificationMessages,
  pressSourceDailyCounts,
  pressSourceDeactivations,
  pressSourceIncidents,
  pressSources,
  regroupingExits,
  telegramLinks,
  trackedCaseDecisions,
  trackedCases,
  trackedGameResults,
];

/** An instant of 2 December 2024, at `hour` UTC. */
const at = (hour: number): Date => new Date(toEpochMs(Date.UTC(2024, 11, 2, hour)));
// A chat identifier beyond the range of a 32-bit integer, as Telegram's can be.
const CHAT_ID = 2 ** 40 + 7;
const LINK = { statusChangedAt: at(8) } as const;
const LINKED = { ...LINK, status: 'linked', chatId: CHAT_ID, linkedAt: at(8) } as const;
const HASH = new Uint8Array(32).fill(7);
const CODE = { codeSha256: HASH, createdAt: at(8), expiresAt: at(9) } as const;
// A value that no stored set of the model holds.
const OUTSIDE = sql`'outside'`;

/** The error of a query that a CHECK constraint refused. */
const violationOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23514', constraint },
});

/** The error of a query that a unique index refused. */
const duplicateOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23505', constraint },
});

describe('the Telegram link and the daily cap', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    return database.close;
  }, 60_000);

  it('builds the columns, indexes and references that notifications.md gives these tables', async () => {
    await expect(describeColumns(db, TABLES)).resolves.toStrictEqual(COLUMNS);
    await expect(describeIndexes(db, TABLES)).resolves.toStrictEqual(INDEXES);
    await expect(describeForeignKeys(db, TABLES)).resolves.toStrictEqual(FOREIGN_KEYS);
  });

  it('[TEL-01] [TEL-28] [TEL-32] keeps one link, not linked and on the webhook by default', async () => {
    await db.insert(telegramLinks).values(LINK);
    const second = db.insert(telegramLinks).values(LINK);
    await expect(second).rejects.toMatchObject(duplicateOf('telegram_links_pkey'));
    const other = db.insert(telegramLinks).values({ ...LINK, id: 2 });
    await expect(other).rejects.toMatchObject(violationOf('telegram_links_id_check'));

    await expect(db.select().from(telegramLinks)).resolves.toStrictEqual([
      {
        ...LINK,
        id: 1,
        status: 'not_linked',
        chatId: null,
        linkedAt: null,
        lastSuccessfulSendAt: null,
        inboundMode: 'webhook',
        lastUpdateId: null,
        lastUpdateAt: null,
        rowVersion: 1,
      },
    ]);
  });

  it.each([
    [
      'awaiting its confirmation',
      { ...LINK, status: 'awaiting_confirmation', inboundMode: 'polling' },
    ],
    [
      'linked to a chat, with the last update handled',
      { ...LINKED, lastUpdateId: CHAT_ID, lastUpdateAt: at(9), lastSuccessfulSendAt: at(9) },
    ],
    ['broken, keeping its chat', { ...LINKED, status: 'broken' }],
  ] as const)('[TEL-29] [TEL-30] [TEL-37] [CL-TEL-20] keeps a link %s', async (_case, link) => {
    await db.insert(telegramLinks).values(link);

    await expect(db.select().from(telegramLinks)).resolves.toMatchObject([link]);
  });

  it.each([
    ['a status outside the list', { ...LINK, status: OUTSIDE }, 'status'],
    ['a linked status without a chat', { ...LINK, status: 'linked' }, 'chat'],
    ['a chat while not linked', { ...LINKED, status: 'not_linked' }, 'chat'],
    ['a chat without its linking instant', { ...LINKED, linkedAt: null }, 'linked'],
    ['a linking instant without a chat', { ...LINK, linkedAt: at(8) }, 'linked'],
    ['an inbound mode outside the list', { ...LINK, inboundMode: OUTSIDE }, 'inbound_mode'],
  ] as const)('[TEL-29] [TEL-30] [TEL-32] refuses a link with %s', async (_case, link, check) => {
    const insert = db.insert(telegramLinks).values(link);

    await expect(insert).rejects.toMatchObject(violationOf(`telegram_links_${check}_check`));
  });

  it('[TEL-29] [TEL-31] [CL-TEL-23] keeps the digest of each one-time code once, expiring after it was made', async () => {
    await db.insert(telegramLinkCodes).values({ ...CODE, expiresAt: at(8), usedAt: at(8) });
    const again = db.insert(telegramLinkCodes).values(CODE);
    await expect(again).rejects.toMatchObject(duplicateOf('telegram_link_codes_code_uq'));
    const digest = violationOf('telegram_link_codes_code_sha256_check');
    const short = db.insert(telegramLinkCodes).values({ ...CODE, codeSha256: new Uint8Array(31) });
    await expect(short).rejects.toMatchObject(digest);
    const long = db.insert(telegramLinkCodes).values({ ...CODE, codeSha256: new Uint8Array(33) });
    await expect(long).rejects.toMatchObject(digest);

    const expired = db
      .insert(telegramLinkCodes)
      .values({ ...CODE, codeSha256: new Uint8Array(32), expiresAt: at(7) });

    await expect(expired).rejects.toMatchObject(violationOf('telegram_link_codes_expires_check'));
  });

  it('[TEL-31] [CL-TRV-05] keeps the link codes out of backups and exports, and every other table of Lot 2 in them', () => {
    expect(isOutsideArchive(telegramLinkCodes)).toBe(true);
    expect(ARCHIVED.filter((table) => isOutsideArchive(table))).toStrictEqual([]);
  });

  it('[TEL-22] [CL-TEL-07] [CL-TEL-19] counts the messages of each day once, from zero and never below it', async () => {
    await db.insert(notificationDailyCounts).values({ capDay: '2024-12-02' });
    const again = db.insert(notificationDailyCounts).values({ capDay: '2024-12-02', sentCount: 3 });
    await expect(again).rejects.toMatchObject(duplicateOf('notification_daily_counts_day_uq'));
    const negative = db
      .insert(notificationDailyCounts)
      .values({ capDay: '2024-12-03', sentCount: -1 });
    await expect(negative).rejects.toMatchObject(
      violationOf('notification_daily_counts_sent_count_check'),
    );

    await expect(db.select().from(notificationDailyCounts)).resolves.toStrictEqual([
      { id: 1, capDay: '2024-12-02', sentCount: 0 },
    ]);
  });
});
