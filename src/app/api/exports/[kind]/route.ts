import { connection } from 'next/server';

import { requireSession } from '@/lib/auth';
import { exportAll, exportJournal, exportPartial, isExportKind } from '@/lib/backups';
import { logger } from '@/lib/log';
import { compareIsoDates, parseIsoDate } from '@/lib/time';

import type { ReadyError, SessionRefusal } from '@/lib/auth';
import type { Download } from '@/lib/backups';
import type { DatabaseError } from '@/lib/db';
import type { Result } from '@/lib/result';

type Context = Readonly<{ params: Promise<{ kind: string }> }>;

const SEE_OTHER = 303;
const BAD_REQUEST = 400;
const NOT_FOUND = 404;
const SERVICE_UNAVAILABLE = 503;
const NO_STORE = { 'Cache-Control': 'no-store' };
const JOURNAL = 'journal';

/** An answer without a body. */
function status(code: number): Response {
  return new Response(null, { status: code, headers: NO_STORE });
}

/** The answer while the server cannot work, whose cause only the server log names (TRV-64). */
function unavailable(cause: string): Response {
  logger.error('An export could not start.', { cause });
  return status(SERVICE_UNAVAILABLE);
}

/** The answer to a session that `requireSession` refused: its login page, or could not check. */
function refused(error: ReadyError | SessionRefusal, request: Request): Response {
  return error.kind === 'log-in' || error.kind === 'choose-password'
    ? Response.redirect(new URL(error.redirect, request.url), SEE_OTHER)
    : unavailable(error.kind);
}

/** The journal export that `query` asks for: `from` and `to`, two days, and `details=1`. */
async function journalOf(query: URLSearchParams): Promise<Result<Download, DatabaseError> | null> {
  const from = parseIsoDate(query.get('from') ?? '');
  const to = parseIsoDate(query.get('to') ?? '');
  if (!from.ok || !to.ok || compareIsoDates(from.on, to.on) > 0) {
    return null;
  }
  return exportJournal({
    from: from.on,
    to: to.on,
    withTechnicalDetails: query.get('details') === '1',
  });
}

/** The export that `kind` and `query` ask for, or null when they name none. */
async function exportOf(kind: string, query: URLSearchParams) {
  if (kind === JOURNAL) {
    return { found: true, download: await journalOf(query) } as const;
  }
  if (!isExportKind(kind)) {
    return { found: false, download: null } as const;
  }
  return {
    found: true,
    download: await (kind === 'full' ? exportAll() : exportPartial(kind)),
  } as const;
}

/**
 * Downloads an export, for the owner's session only (TRV-56): `full`, the archive that
 * rebuilds the application, `players`, `events`, `cases` or `profiles`, a spreadsheet
 * file (TRV-52), or `journal?from=&to=`, the journal of those days in the owner's zone,
 * with `details=1` for the technical details (TRV-49, CA-TRV-35). The file streams as it
 * is read, never held whole: only an unstreamed body meets the host's 4.5 MB limit. A
 * request without a session goes to the login page, which brings it back here.
 */
export async function GET(request: Request, context: Context): Promise<Response> {
  await connection();
  const url = new URL(request.url);
  const session = await requireSession(`${url.pathname}${url.search}`);
  if (!session.ok) {
    return refused(session.error, request);
  }
  const { kind } = await context.params;
  const { found, download } = await exportOf(kind, url.searchParams);
  if (download === null) {
    return status(found ? BAD_REQUEST : NOT_FOUND);
  }
  if (!download.ok) {
    return unavailable(download.error.kind);
  }
  const { fileName, contentType, body } = download.value;
  return new Response(body, {
    headers: {
      ...NO_STORE,
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${fileName}"`,
    },
  });
}
