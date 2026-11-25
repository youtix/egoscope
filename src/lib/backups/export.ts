import 'server-only';

import {
  cases,
  caseTriggeredCriteria,
  events,
  eventSources,
  followedPlayers,
  games,
  getDirectDb,
  sensitivityProfiles,
  teams,
} from '@/lib/db';
import { exportText } from '@/lib/journal';
import { getParam } from '@/lib/params';
import { ok } from '@/lib/result';
import { endOfLocalDay, now, startOfLocalDay } from '@/lib/time';

import { archiveEntries } from './archive';
import {
  birthday,
  caseOpponent,
  partialPages,
  playerBacktestStatus,
  recordDownload,
  spaceSeparated,
  validCaseCount,
} from './queries';
import { snapshotStream } from './snapshot';
import { zip } from './zip';

import type { CsvColumns, ExportKind, PartialExportKind } from './queries';
import type { DatabaseError, Transaction } from '@/lib/db';
import type { Result } from '@/lib/result';
import type { EpochMs, IsoDate } from '@/lib/time';

/** A file to download: its name, its media type, and its content, streamed as it is read. */
export type Download = Readonly<{
  fileName: string;
  contentType: string;
  body: ReadableStream<Uint8Array>;
}>;

/** The days of the journal to export, in the owner's zone, both included. */
export type JournalExportRequest = Readonly<{
  from: IsoDate;
  to: IsoDate;
  withTechnicalDetails: boolean;
}>;

const CSV_TYPE = 'text/csv; charset=utf-8';
const CRLF = '\r\n';
const NEEDS_QUOTES = /[",\r\n]/u;
// The length of `YYYY-MM-DDTHH:MM:SS`, an ISO 8601 instant cut to the second.
const ISO_SECONDS_LENGTH = 19;

const encoder = new TextEncoder();

// players.csv, one row per followed player (operations.md §5.3).
const PLAYER_COLUMNS: CsvColumns = [
  ['player_id', followedPlayers.id],
  ['display_name', followedPlayers.displayName],
  ['current_team', teams.abbreviation],
  ['status', followedPlayers.status],
  ['birthday', birthday],
  ['backtest_status', playerBacktestStatus],
  ['valid_case_count', validCaseCount],
  ['added_at', followedPlayers.addedAt],
];

// events.csv, one row per event (operations.md §5.3).
const EVENT_COLUMNS: CsvColumns = [
  ['player_event_id', events.id],
  ['player_id', events.playerId],
  ['display_name', followedPlayers.displayName],
  ['event_type_id', events.eventTypeId],
  ['sheet_version_number', events.sheetVersionNumber],
  ['origin', events.origin],
  ['detected_status', events.detectedStatus],
  ['reference_date', events.referenceDateOn],
  ['reference_at', events.referenceAt],
  ['reference_date_precision', events.referenceDatePrecision],
  ['description', events.description],
  ['injury_return', events.injuryReturn],
  ['game_stakes', events.gameStakes],
  ['research_confidence', events.researchConfidence],
  ['detection_confidence', events.detectionConfidence],
  ['precedence', events.precedence],
  [
    'source_urls',
    spaceSeparated(
      eventSources.url,
      [eventSources.playerEventId, events.id],
      eventSources.position,
    ),
  ],
  ['case_id', events.caseId],
];

// cases.csv, one row per case (operations.md §5.3, CA-TRV-17).
const CASE_COLUMNS: CsvColumns = [
  ['case_id', cases.id],
  ['player_id', cases.playerId],
  ['display_name', followedPlayers.displayName],
  ['event_type_id', cases.eventTypeId],
  ['origin', cases.origin],
  ['status', cases.status],
  ['status_reason', cases.statusReason],
  ['player_event_ids', spaceSeparated(events.id, [events.caseId, cases.id], events.id)],
  ['reference_instant_at', cases.referenceInstantAt],
  ['measured_game_day', games.gameDayOn],
  ['opponent', caseOpponent],
  ['measured_minutes', cases.measuredMinutes],
  ['performance_index', cases.performanceIndex],
  ['baseline_season', cases.baselineSeason],
  ['baseline_phase', cases.baselinePhase],
  ['baseline_game_count', cases.baselineGameCount],
  ['baseline_mean', cases.baselineMean],
  ['baseline_standard_deviation', cases.baselineStandardDeviation],
  ['baseline_status', cases.baselineStatus],
  ['normalized_gap', cases.normalizedGap],
  ['gap_status', cases.gapStatus],
  [
    'triggered_criteria',
    spaceSeparated(
      caseTriggeredCriteria.criterion,
      [caseTriggeredCriteria.caseId, cases.id],
      caseTriggeredCriteria.id,
    ),
  ],
  // Lot 2 slot: the columns of a tracked case, empty for any other, read from the
  // tracking tables: recorded_in_time, forecast_source, forecast_level,
  // forecast_direction, forecast_announced_gap, forecast_late, category (SUI-06, SUI-10,
  // SUI-22, TRV-52). The alerts-tracking-telegram area fills it.
];

// profiles.csv, one row per profile (operations.md §5.3).
const PROFILE_COLUMNS: CsvColumns = [
  ['player_id', sensitivityProfiles.playerId],
  ['display_name', followedPlayers.displayName],
  ['event_type_id', sensitivityProfiles.eventTypeId],
  ['view', sensitivityProfiles.view],
  ['valid_count', sensitivityProfiles.validCount],
  ['mean_gap', sensitivityProfiles.meanGap],
  ['range_low', sensitivityProfiles.rangeLow],
  ['range_high', sensitivityProfiles.rangeHigh],
  ['verdict_level', sensitivityProfiles.verdictLevel],
  ['verdict_direction', sensitivityProfiles.verdictDirection],
  ['is_fragile', sensitivityProfiles.isFragile],
  ['profile_confidence', sensitivityProfiles.profileConfidence],
  ['computed_at', sensitivityProfiles.computedAt],
];

const CSV_COLUMNS: Readonly<Record<PartialExportKind, CsvColumns>> = {
  players: PLAYER_COLUMNS,
  events: EVENT_COLUMNS,
  cases: CASE_COLUMNS,
  profiles: PROFILE_COLUMNS,
};

/** One value as a CSV field (RFC 4180): instants in ISO 8601 UTC, numbers with a decimal point. */
function field(value: unknown): string {
  let text = '';
  if (value instanceof Date) {
    text = value.toISOString();
  } else if (typeof value === 'string') {
    text = value;
  } else if (typeof value === 'number' || typeof value === 'boolean') {
    text = String(value);
  }
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * The CSV file of `kind`, read in `tx`: the header, then the rows a page at a time.
 * @yields {Uint8Array} The header line, then the lines of each page.
 */
async function* csvParts(tx: Transaction, kind: PartialExportKind): AsyncGenerator<Uint8Array> {
  const columns = CSV_COLUMNS[kind];
  const headers = columns.map(([header]) => header);
  yield encoder.encode(`${headers.join(',')}${CRLF}`);
  for await (const page of partialPages(tx, kind, columns)) {
    const lines = page.map((row) => headers.map((header) => field(row[header])).join(','));
    yield encoder.encode(lines.map((line) => `${line}${CRLF}`).join(''));
  }
}

/** `instant` as the archive's name writes it: `YYYYMMDDTHHMMSSZ`. */
function compactInstant(instant: EpochMs): string {
  const seconds = new Date(instant).toISOString().slice(0, ISO_SECONDS_LENGTH);
  return `${seconds.replaceAll(/[-:]/gu, '')}Z`;
}

/**
 * The full export, which can rebuild the application (TRV-52, TRV-53): the archive of
 * `archiveEntries` as one ZIP file named `egoscope-export-<YYYYMMDDTHHMMSSZ>.zip`, read
 * through the direct connection in one snapshot and streamed. Once downloaded to its
 * end, it is recorded and closes the export reminder (TRV-54, CL-TRV-22).
 */
export async function exportAll(): Promise<Result<Download, DatabaseError>> {
  const direct = await getDirectDb();
  if (!direct.ok) {
    return direct;
  }
  const exportedAt = now();
  return ok({
    fileName: `egoscope-export-${compactInstant(exportedAt)}.zip`,
    contentType: 'application/zip',
    body: snapshotStream(direct.db, {
      produce: (tx) => zip(archiveEntries(tx, exportedAt), exportedAt),
      completed: async () => recordDownload('full'),
    }),
  });
}

/**
 * A spreadsheet export (TRV-52, CA-TRV-17): `players.csv`, `events.csv`, `cases.csv` or
 * `profiles.csv`, one row per player, event, case or profile, in UTF-8 with a header row,
 * comma separators and RFC 4180 quoting, values as their codes (operations.md §5.3),
 * read through the direct connection and streamed. Once downloaded to its end it is
 * recorded, and leaves the export reminder as it is (CL-TRV-22).
 */
export async function exportPartial(
  kind: PartialExportKind,
): Promise<Result<Download, DatabaseError>> {
  const direct = await getDirectDb();
  if (!direct.ok) {
    return direct;
  }
  return ok({
    fileName: `${kind}.csv`,
    contentType: CSV_TYPE,
    body: snapshotStream(direct.db, {
      produce: (tx) => csvParts(tx, kind),
      completed: async () => recordDownload(kind),
    }),
  });
}

/**
 * The journal text of `request`'s days in the owner's zone, read in `tx`.
 * @yields {Uint8Array} The title, then each entry's block.
 */
async function* journalParts(
  tx: Transaction,
  request: JournalExportRequest,
): AsyncGenerator<Uint8Array> {
  const timeZone = await getParam(tx, 'display.timeZone');
  const period = {
    from: startOfLocalDay(request.from, timeZone),
    to: endOfLocalDay(request.to, timeZone),
  };
  const { withTechnicalDetails } = request;
  const parts = exportText(tx, { timeZone, period, withTechnicalDetails });
  for await (const part of parts) {
    yield encoder.encode(part);
  }
}

/**
 * The activity journal of the days `request.from` to `request.to`, in the owner's zone,
 * as a plain UTF-8 text file for the person who helps the owner (TRV-49, CA-TRV-35): each
 * entry's instant with its zone, level, category and message in plain words, then, when
 * asked for, its allowlisted technical details, which hold no secret (TRV-44, TRV-64).
 * Read through the direct connection and streamed; it is not an export of `ExportKind`.
 */
export async function exportJournal(
  request: JournalExportRequest,
): Promise<Result<Download, DatabaseError>> {
  const direct = await getDirectDb();
  if (!direct.ok) {
    return direct;
  }
  return ok({
    fileName: `egoscope-journal-${request.from}-${request.to}.txt`,
    contentType: 'text/plain; charset=utf-8',
    body: snapshotStream(direct.db, { produce: (tx) => journalParts(tx, request) }),
  });
}

/** Whether `kind`, read from a request, names an export of `ExportKind` (TRV-52). */
export function isExportKind(kind: string): kind is ExportKind {
  return kind === 'full' || Object.hasOwn(CSV_COLUMNS, kind);
}
