import { crc32, inflateRawSync } from 'node:zlib';

import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import {
  boxScores,
  createTestDatabase,
  eventSources,
  exportDownloads,
  followedPlayers,
  games,
  incidents,
  parameterSnapshots,
  sensitivityProfiles,
  teams,
} from '@/lib/db';
import { open } from '@/lib/incidents';
import { record } from '@/lib/journal';
import {
  DATABASE_TEST_TIMEOUT_MS,
  insertHistoricalEvent,
  insertPlayer,
  insertRequest,
  MEDIA_STORM,
  profiledPlayer,
} from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs, toIsoDate } from '@/lib/time';

import { exportAll, exportJournal, exportPartial, isExportKind } from './export';

import type { Download, JournalExportRequest } from './export';
import type { Database, DatabaseError, DatabaseResult } from '@/lib/db';
import type { Result } from '@/lib/result';
import type { ProfiledPlayer } from '@/lib/testing';

// The databases behind `getDb()` and `getDirectDb()`, which each test points at its own.
const harness = vi.hoisted(() => ({
  getDb: vi.fn<() => Promise<DatabaseResult>>(),
  getDirectDb: vi.fn<() => Promise<DatabaseResult>>(),
}));

vi.mock(import('@/lib/db'), async (importOriginal) => ({
  ...(await importOriginal()),
  getDb: harness.getDb,
  getDirectDb: harness.getDirectDb,
}));

const NOW = toEpochMs(Date.UTC(2026, 10, 25, 9, 30, 12, 345));
const COMPUTED_AT = new Date(Date.UTC(2026, 10, 24, 8));
const NOT_CONFIGURED = { ok: false, error: { kind: 'database-not-configured' } } as const;
const CRLF = '\r\n';
// The ZIP records that an archive tool reads (PKWARE APPNOTE 4.3): their signatures, their
// fixed sizes and the offsets of their fields.
const END_SIGNATURE = 0x06_05_4b_50;
const CENTRAL_SIGNATURE = 0x02_01_4b_50;
const END_RECORD_SIZE = 22;
const CENTRAL_HEADER_SIZE = 46;
const LOCAL_HEADER_SIZE = 30;
const TWO_DIGITS = 2;

type Entry = readonly [name: string, text: string];
type Cell = string | number | boolean | Date | null | undefined;

/** The instant of `day` November 2026 at `hour`:`minute` UTC. */
function utc(day: number, hour: number, minute: number) {
  return toEpochMs(Date.UTC(2026, 10, day, hour, minute));
}

function twoDigits(value: number | null): string {
  return String(value).padStart(TWO_DIGITS, '0');
}

/** A player's day and month of birth as `players.csv` writes it, `MM-DD`. */
function birthdayOf(
  player: Readonly<{ birthdayMonth: number | null; birthdayDay: number | null }>,
) {
  return `${twoDigits(player.birthdayMonth)}-${twoDigits(player.birthdayDay)}`;
}

/** One value as the spreadsheet exports write it: instants in ISO 8601, empty for null. */
function cell(value: Cell): string {
  return value instanceof Date ? value.toISOString() : String(value ?? '');
}

/** The download of `result`, which a test expects to have started. */
function started(result: Result<Download, DatabaseError>): Download {
  if (!result.ok) {
    throw new Error('The export did not start.');
  }
  return result.value;
}

/** The text that `stream` gives, read to its end. */
async function textOf(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

/**
 * The entries of the ZIP archive `archive`, read as an archive tool reads it: from the
 * central directory, each entry inflated and checked against its CRC and its size.
 */
function unzip(archive: Uint8Array): readonly Entry[] {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const end = archive.length - END_RECORD_SIZE;
  expect(view.getUint32(end, true)).toBe(END_SIGNATURE);
  const entries: Entry[] = [];
  let at = view.getUint32(end + 16, true);
  for (let index = 0; index < view.getUint16(end + 10, true); index += 1) {
    expect(view.getUint32(at, true)).toBe(CENTRAL_SIGNATURE);
    const nameLength = view.getUint16(at + 28, true);
    const nameAt = at + CENTRAL_HEADER_SIZE;
    const name = new TextDecoder().decode(archive.subarray(nameAt, nameAt + nameLength));
    const local = view.getUint32(at + 42, true);
    const start = local + LOCAL_HEADER_SIZE + view.getUint16(local + 26, true);
    const data = inflateRawSync(archive.subarray(start, start + view.getUint32(at + 20, true)));
    expect(data).toHaveLength(view.getUint32(at + 24, true));
    expect(crc32(data)).toBe(view.getUint32(at + 16, true));
    entries.push([name, new TextDecoder().decode(data)]);
    at = nameAt + nameLength;
  }
  return entries;
}

/** The download of a spreadsheet export, and its lines, its header first. */
async function csvOf(kind: 'players' | 'events' | 'cases' | 'profiles') {
  const download = started(await exportPartial(kind));
  const text = await textOf(download.body);
  return { ...download, ends: text.endsWith(CRLF), lines: text.trimEnd().split(CRLF) };
}

async function csvLines(kind: 'players' | 'events' | 'cases' | 'profiles'): Promise<string[]> {
  const { lines } = await csvOf(kind);
  return lines;
}

/** The download of a journal export, and its text. */
async function journalOf(request: JournalExportRequest) {
  const download = started(await exportJournal(request));
  return { ...download, text: await textOf(download.body) };
}

describe('the exports', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  type Case = ProfiledPlayer['cases'][number];
  let db: Database;

  beforeEach(async () => {
    const created = await createTestDatabase();
    onTestFinished(created.close);
    onTestFinished(installFakeClock(fixedClock(NOW)));
    db = created.db;
    harness.getDb.mockReset().mockResolvedValue({ ok: true, db });
    harness.getDirectDb.mockReset().mockResolvedValue({ ok: true, db });
  });

  /** A profile of the media storm for `playerId` in `view`, with seven valid cases. */
  async function insertProfile(playerId: string, view: 'all_cases' | 'historical_only') {
    const [snapshot] = await db
      .insert(parameterSnapshots)
      .values({ values: {}, valuesHash: `snapshot-of-${view}` })
      .returning();
    const counts = { eventCount: 7, caseCount: 7, validCount: 7, historicalValidCount: 7 };
    const none = { groupedEventCount: 0, awaitingCount: 0, excludedCount: 0 };
    await db.insert(sensitivityProfiles).values({
      ...counts,
      ...none,
      playerId,
      eventTypeId: MEDIA_STORM,
      view,
      manuallyExcludedCount: 0,
      notMeasurableCount: 0,
      coOccurringCount: 0,
      provisionalGapCount: 0,
      trackedValidCount: 0,
      tallyReasons: {},
      exitCounts: {},
      lowResearchConfidenceCount: 0,
      meanGap: 0.42,
      gapDispersion: 0.3,
      rangeLow: -0.1,
      rangeHigh: 0.9,
      aboveZeroCount: 5,
      belowZeroCount: 2,
      verdictLevel: 'inconclusive',
      isFragile: false,
      profileConfidence: 'low',
      controlCaseCount: 0,
      controlVerdictLevel: 'inconclusive',
      dependsOnManualExclusions: false,
      validCaseThreshold: 5,
      parameterSnapshotId: snapshot?.id ?? 0,
      computedAt: COMPUTED_AT,
    });
  }

  /** The day and the abbreviation of the opponent of the game that `measured` measured. */
  async function gameOf(measured: Case): Promise<readonly [string, string]> {
    const gameId = measured.measuredGameId ?? 0;
    const [row] = await db
      .select({
        day: games.gameDayOn,
        team: boxScores.teamId,
        home: games.homeTeamId,
        away: games.awayTeamId,
      })
      .from(boxScores)
      .innerJoin(games, eq(games.id, boxScores.gameId))
      .where(and(eq(boxScores.playerId, measured.playerId), eq(boxScores.gameId, gameId)));
    if (row === undefined) {
      throw new Error('The measured game has no box score of the player.');
    }
    const opponentId = row.team === row.home ? row.away : row.home;
    const [team] = await db.select().from(teams).where(eq(teams.id, opponentId));
    return [row.day, team?.abbreviation ?? ''];
  }

  /** The cells that the row of `measured` in `cases.csv` holds. */
  async function expectedCase(profiled: ProfiledPlayer, measured: Case): Promise<string[]> {
    const caseEvents = profiled.events.filter((event) => event.caseId === measured.id);
    const [day, opponent] = await gameOf(measured);
    const cells: readonly Cell[] = [
      measured.id,
      measured.playerId,
      profiled.player.displayName,
      measured.eventTypeId,
      measured.origin,
      measured.status,
      measured.statusReason,
      caseEvents.map((event) => String(event.id)).join(' '),
      measured.referenceInstantAt,
      day,
      opponent,
      measured.measuredMinutes,
      measured.performanceIndex,
      measured.baselineSeason,
      measured.baselinePhase,
      measured.baselineGameCount,
      measured.baselineMean,
      measured.baselineStandardDeviation,
      measured.baselineStatus,
      measured.normalizedGap,
      measured.gapStatus,
      null,
    ];
    return cells.map((value) => cell(value));
  }

  it('[TRV-52] [TRV-53] downloads the full export as one ZIP archive named by its instant, which any archive tool opens', async () => {
    await profiledPlayer(db);

    const download = started(await exportAll());

    expect([download.fileName, download.contentType]).toStrictEqual([
      'egoscope-export-20261125T093012Z.zip',
      'application/zip',
    ]);
    const files = unzip(new Uint8Array(await new Response(download.body).arrayBuffer()));
    expect([files[0]?.[0], files.at(-1)?.[0]]).toStrictEqual(['readme.txt', 'manifest.json']);
    const players = new Map(files).get('followed_players.jsonl') ?? '';
    expect(players.trimEnd().split('\n')).toHaveLength(1);
    expect(JSON.parse(files.at(-1)?.[1] ?? '{}')).toHaveProperty(
      'exported_at',
      '2026-11-25T09:30:12.345Z',
    );
  });

  it('[TRV-52] [CL-TRV-22] reads the archive in one read-only repeatable-read snapshot of the direct connection, streamed, then records the full export, which closes the export reminder', async () => {
    await db.transaction(async (tx) => open(tx, { kind: 'export_reminder' }));
    const snapshots = vi.spyOn(db, 'transaction');

    const download = started(await exportAll());
    expect(download.body).toBeInstanceOf(ReadableStream);
    await textOf(download.body);

    expect(harness.getDirectDb).toHaveBeenCalledOnce();
    expect(snapshots).toHaveBeenNthCalledWith(1, expect.any(Function), {
      isolationLevel: 'repeatable read',
      accessMode: 'read only',
    });
    const downloads = db
      .select({ kind: exportDownloads.kind, at: exportDownloads.downloadedAt })
      .from(exportDownloads);
    await expect(downloads).resolves.toStrictEqual([{ kind: 'full', at: new Date(NOW) }]);
    const reminder = db.select({ status: incidents.status }).from(incidents);
    await expect(reminder).resolves.toStrictEqual([{ status: 'closed' }]);
  });

  it('[TRV-52] [CL-TRV-22] records a spreadsheet export once downloaded, which leaves the export reminder open', async () => {
    await db.transaction(async (tx) => open(tx, { kind: 'export_reminder' }));

    await csvLines('profiles');

    const downloads = db.select({ kind: exportDownloads.kind }).from(exportDownloads);
    await expect(downloads).resolves.toStrictEqual([{ kind: 'profiles' }]);
    const reminder = db.select({ status: incidents.status }).from(incidents);
    await expect(reminder).resolves.toStrictEqual([{ status: 'open' }]);
  });

  it('[TRV-52] records nothing when the reader stops before the end, and cuts the file short when its download cannot be recorded', async () => {
    await profiledPlayer(db);
    const reader = started(await exportAll()).body.getReader();
    await reader.read();
    await reader.cancel();
    harness.getDb.mockResolvedValue(NOT_CONFIGURED);

    const unrecorded = started(await exportPartial('cases'));

    await expect(textOf(unrecorded.body)).rejects.toStrictEqual(NOT_CONFIGURED.error);
    await expect(db.select().from(exportDownloads)).resolves.toStrictEqual([]);
  });

  it('[TRV-52] [TRV-49] starts no export while the database is not configured', async () => {
    harness.getDirectDb.mockResolvedValue(NOT_CONFIGURED);
    const day = toIsoDate('2026-11-18');

    await expect(exportAll()).resolves.toStrictEqual(NOT_CONFIGURED);
    await expect(exportPartial('players')).resolves.toStrictEqual(NOT_CONFIGURED);
    const journal = exportJournal({ from: day, to: day, withTechnicalDetails: false });
    await expect(journal).resolves.toStrictEqual(NOT_CONFIGURED);
  });

  it('[TRV-52] names the full export and the four spreadsheet exports, and nothing else', () => {
    const kinds = ['full', 'players', 'events', 'cases', 'profiles', 'journal', 'toString'];

    expect(kinds.filter((kind) => isExportKind(kind))).toStrictEqual(kinds.slice(0, 5));
  });

  it('[TRV-52] [CA-TRV-17] exports the cases as a spreadsheet file with one row per case, its events, its measured game and its opponent', async () => {
    const profiled = await profiledPlayer(db);

    const csv = await csvOf('cases');

    expect([csv.fileName, csv.contentType, csv.ends]).toStrictEqual([
      'cases.csv',
      'text/csv; charset=utf-8',
      true,
    ]);
    const [header, ...rows] = csv.lines;
    expect(header).toBe(
      'case_id,player_id,display_name,event_type_id,origin,status,status_reason,player_event_ids,reference_instant_at,measured_game_day,opponent,measured_minutes,performance_index,baseline_season,baseline_phase,baseline_game_count,baseline_mean,baseline_standard_deviation,baseline_status,normalized_gap,gap_status,triggered_criteria',
    );
    const expected = await Promise.all(
      profiled.cases.map(async (measured) => expectedCase(profiled, measured)),
    );
    expect(rows.map((row) => row.split(','))).toStrictEqual(expected);
  });

  it('[TRV-52] exports the players with their team, birthday, backtest status and total of valid cases of the default view', async () => {
    const { player } = await profiledPlayer(db);
    const [team] = await db
      .insert(teams)
      .values({ abbreviation: 'QVH', name: 'Quietvale Herons' })
      .returning();
    await db
      .update(followedPlayers)
      .set({ currentTeamId: team?.id ?? null })
      .where(eq(followedPlayers.id, player.id));
    const waiting = await insertPlayer(db, { source: 'p02' });
    await insertRequest(db, { playerId: waiting.id });
    const unasked = await insertPlayer(db, { source: 'p03', overrides: { currentTeamId: null } });
    await insertProfile(player.id, 'all_cases');
    await insertProfile(player.id, 'historical_only');

    const [header, ...rows] = await csvLines('players');

    expect(header).toBe(
      'player_id,display_name,current_team,status,birthday,backtest_status,valid_case_count,added_at',
    );
    const split = rows.map((row) => row.split(','));
    const cells = new Map(split.map((row) => [row[0], row]));
    expect(new Map(split.map((row) => [row[0], row.slice(5, 7)]))).toStrictEqual(
      new Map([
        [player.id, ['imported', '7']],
        [waiting.id, ['request_to_do', '0']],
        [unasked.id, ['never_requested', '0']],
      ]),
    );
    expect(cells.get(player.id)).toStrictEqual([
      player.id,
      player.displayName,
      'QVH',
      player.status,
      birthdayOf(player),
      'imported',
      '7',
      player.addedAt.toISOString(),
    ]);
    expect(cells.get(unasked.id)?.slice(2, 5)).toStrictEqual([
      '',
      unasked.status,
      unasked.birthdayMonth === null ? '' : birthdayOf(unasked),
    ]);
  });

  it('[TRV-52] exports the events with their sources space-separated, quoting a text as RFC 4180 does', async () => {
    const { player, imported } = await profiledPlayer(db);
    const event = await insertHistoricalEvent(db, {
      playerId: player.id,
      originImportId: imported.id,
      overrides: { description: 'He said "no", then\nleft' },
    });
    await db.insert(eventSources).values(
      [2, 1].map((position) => ({
        playerEventId: event.id,
        position,
        url: `https://news${String(position)}.example/story`,
        cleanedUrl: `https://news${String(position)}.example/story`,
        publicationDateOn: '2024-11-20',
      })),
    );

    const lines = await csvLines('events');

    expect(lines[0]).toBe(
      'player_event_id,player_id,display_name,event_type_id,sheet_version_number,origin,detected_status,reference_date,reference_at,reference_date_precision,description,injury_return,game_stakes,research_confidence,detection_confidence,precedence,source_urls,case_id',
    );
    // The header, the seven events of the profiled player, then the new one, whose quoted
    // line break stays inside its row.
    expect(lines).toHaveLength(1 + 7 + 1);
    const cells: readonly Cell[] = [
      event.id,
      player.id,
      player.displayName,
      event.eventTypeId,
      event.sheetVersionNumber,
      'historical',
      null,
      event.referenceDateOn,
      null,
      event.referenceDatePrecision,
      '"He said ""no"", then\nleft"',
      event.injuryReturn,
      event.gameStakes,
      event.researchConfidence,
      null,
      event.precedence,
      'https://news1.example/story https://news2.example/story',
      null,
    ];
    expect(lines.at(-1)).toBe(cells.map((value) => cell(value)).join(','));
  });

  it('[TRV-52] exports the profiles, one row per profile', async () => {
    const { player } = await profiledPlayer(db);
    await insertProfile(player.id, 'all_cases');

    const [header, ...rows] = await csvLines('profiles');

    expect(header).toBe(
      'player_id,display_name,event_type_id,view,valid_count,mean_gap,range_low,range_high,verdict_level,verdict_direction,is_fragile,profile_confidence,computed_at',
    );
    expect(rows).toStrictEqual([
      `${player.id},${player.displayName},${MEDIA_STORM},all_cases,7,0.42,-0.1,0.9,inconclusive,,false,low,2026-11-24T08:00:00.000Z`,
    ]);
  });

  it("[TRV-49] [CA-TRV-35] exports the journal of the owner's days as plain text, the failure of an outside service in plain words and, on demand, its technical details", async () => {
    await db.transaction(async (tx) => {
      await record(tx, { messageKey: 'trigger_refused', occurredAt: utc(17, 22, 59) });
      await record(tx, {
        messageKey: 'service_call_failed',
        params: { service: 'stats_source' },
        occurredAt: utc(18, 12, 0),
        technicalDetails: { service: 'stats_source', httpStatus: 503 },
      });
      await record(tx, { messageKey: 'trigger_refused', occurredAt: utc(19, 23, 0) });
    });
    const days = { from: toIsoDate('2026-11-18'), to: toIsoDate('2026-11-19') };

    const plain = await journalOf({ ...days, withTechnicalDetails: false });
    const detailed = await journalOf({ ...days, withTechnicalDetails: true });

    expect([plain.fileName, plain.contentType]).toStrictEqual([
      'egoscope-journal-2026-11-18-2026-11-19.txt',
      'text/plain; charset=utf-8',
    ]);
    const title =
      'Activity journal from Wednesday 18 November 2026, 00:00 Paris time to Friday 20 November 2026, 00:00 Paris time';
    const failure = [
      'Wednesday 18 November 2026, 13:00 Paris time · Warning · Service failure',
      'A call to the stats source failed. The work that needs it is kept and tried again later; nothing is lost. What to do: nothing if it happens once; if it lasts, an incident opens and says what to do.',
    ].join('\n');
    expect(plain.text).toBe(`${title}\n\n${failure}\n`);
    expect(detailed.text).toBe(
      `${title}\n\n${failure}\n  service: stats_source\n  httpStatus: 503\n`,
    );
  });
});
