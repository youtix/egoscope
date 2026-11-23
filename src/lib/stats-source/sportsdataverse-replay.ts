// A local replay of the SportsDataverse release, for the tests of its adapter
// (sportsdataverse.ts), which never reach the network: it serves the recorded,
// anonymized files of data/fixtures/stats-source/recorded/ as the release does, each
// documented address answering a redirect to the asset host, which answers the file
// with its ETag and Last-Modified, or 304 for the version sent (statistics service
// sheet; evaluation, section 6). It records every request, and meets on demand the
// faults and the corrections of a real release.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

import type { IncomingMessage, Server, ServerResponse } from 'node:http';

/** The chunks of a body, which may wait between two of them. */
type Chunks = Iterable<Buffer> | AsyncIterable<Buffer>;

/** A body the replay writes chunk by chunk. */
type GeneratedBody = () => Chunks;

/**
 * A fault that the next request of a file meets: an outage or a quota answer at its
 * documented address; at the asset host, an answer that never comes, a changed
 * layout, or a file without its version.
 */
export type ReplayFault =
  | Readonly<{ kind: 'outage' | 'slow' | 'schema_changed' | 'no_version' }>
  | Readonly<{ kind: 'quota'; status: number; headers: Readonly<Record<string, string>> }>;

/** A request that the replay received: its path, the version it sent and its user agent. */
type ReplayRequest = Readonly<{
  path: string;
  ifNoneMatch: string | null;
  userAgent: string | null;
}>;

/** The Last-Modified of every recorded file: the time the recording was refreshed. */
const RECORDED_LAST_MODIFIED = 'Sun, 22 Nov 2026 12:34:02 GMT';

/** The release tag of each recorded file, by the start of its name (statistics service sheet). */
const TAGS: readonly (readonly [string, string])[] = [
  ['nba_schedule_', 'espn_nba_schedules'],
  ['player_box_', 'espn_nba_player_boxscores'],
  ['timestamp.json', 'espn_nba_player_boxscores'],
  ['player_core_', 'espn_nba_player_core'],
  ['nba_player_crosswalk_', 'nba_crosswalk'],
];
const RECORDED = path.join(import.meta.dirname, '../../../data/fixtures/stats-source/recorded');
const DOWNLOAD = '/download/';
const ASSET = '/asset/';
const CHUNK_BYTES = 65_536;
const OK = 200;
const FOUND = 302;
const NOT_MODIFIED = 304;
const NOT_FOUND = 404;
const SERVER_ERROR = 500;

/** The recorded files under their release addresses, `tag/name`; the folder's README is none. */
function recordedFiles(): ReadonlyMap<string, Buffer> {
  return new Map(
    readdirSync(RECORDED).flatMap((fixture) => {
      const name = fixture.replaceAll('-', '_');
      const tag = TAGS.find(([start]) => name.startsWith(start))?.[1];
      return tag === undefined
        ? []
        : [[`${tag}/${name}`, readFileSync(path.join(RECORDED, fixture))] as const];
    }),
  );
}

/**
 * The chunks of a stored body.
 * @yields {Buffer} Each chunk in turn.
 */
function* chunksOf(body: Buffer): Iterable<Buffer> {
  for (let start = 0; start < body.length; start += CHUNK_BYTES) {
    yield body.subarray(start, start + CHUNK_BYTES);
  }
}

/** Waits until `response` drains or closes, then drops both listeners, so that none piles up. */
async function drainedOrClosed(response: ServerResponse): Promise<void> {
  await new Promise<void>((resolve) => {
    const done = (): void => {
      response.off('drain', done);
      response.off('close', done);
      resolve();
    };
    response.once('drain', done);
    response.once('close', done);
  });
}

/** Writes `chunks` to `response`, waiting whenever the client is behind, until it is done or gone. */
async function writeAll(response: ServerResponse, chunks: Chunks): Promise<void> {
  for await (const chunk of chunks) {
    if (!response.write(chunk)) {
      await drainedOrClosed(response);
    }
    if (response.destroyed) {
      return;
    }
  }
  response.end();
}

/** The file with every column of its header renamed, as a changed layout gives it. */
function withRenamedColumns(body: Buffer): Buffer {
  const text = body.toString('utf8');
  const end = text.indexOf('\n');
  const header = text
    .slice(0, end)
    .split(',')
    .map((column) => `renamed_${column}`);
  return Buffer.from(`${header.join(',')}${text.slice(end)}`, 'utf8');
}

/** The version of a body: a hash of a stored one, a constant for a generated one. */
const versionOf = (body: Buffer | GeneratedBody): string =>
  Buffer.isBuffer(body) ? `"${createHash('sha256').update(body).digest('hex')}"` : '"generated"';

/** The body that a fault leaves of `stored`: every column renamed for a changed layout. */
const bodyOf = (
  stored: Buffer | GeneratedBody,
  fault: ReplayFault | undefined,
): Buffer | GeneratedBody =>
  fault?.kind === 'schema_changed' && Buffer.isBuffer(stored) ? withRenamedColumns(stored) : stored;

/** The headers of a file answered whole: its version, unless the fault drops it, and its Last-Modified, unless omitted. */
function headersOf(
  version: string,
  fault: ReplayFault | undefined,
  hasLastModified: boolean,
): Readonly<Record<string, string>> {
  const etag = fault?.kind === 'no_version' ? {} : { etag: version };
  const lastModified = hasLastModified ? { 'last-modified': RECORDED_LAST_MODIFIED } : {};
  return { ...etag, ...lastModified, 'content-type': 'text/csv' };
}

/** The local release and its controls. */
export class Replay {
  readonly #published: Map<string, Buffer | GeneratedBody>;
  readonly #faults = new Map<string, ReplayFault>();
  readonly #server: Server;
  #port = 0;
  #hasLastModified = true;
  readonly requests: ReplayRequest[] = [];

  /** A release of `files`, each under its release address `tag/name`, not listening yet. */
  constructor(files: ReadonlyMap<string, Buffer>) {
    this.#published = new Map(files);
    this.#server = createServer((request, response) => {
      this.#answer(request, response);
    });
  }

  /** Records a request and answers it at the address it names. */
  #answer(request: IncomingMessage, response: ServerResponse): void {
    const address = request.url ?? '';
    this.requests.push({
      path: address,
      ifNoneMatch: request.headers['if-none-match'] ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    });
    if (address.startsWith(DOWNLOAD)) {
      this.#answerDownload(address.slice(DOWNLOAD.length), response);
    } else {
      void this.#answerAsset(address.slice(ASSET.length), request, response);
    }
  }

  /** The fault that the next request of `file` meets, used up by this one. */
  #faultOf(file: string): ReplayFault | undefined {
    const fault = this.#faults.get(file);
    this.#faults.delete(file);
    return fault;
  }

  /** Answers the documented address of a file: a redirect to the asset host, 404, or its fault there. */
  #answerDownload(file: string, response: ServerResponse): void {
    const fault = this.#faults.get(file);
    if (fault?.kind === 'outage') {
      this.#faults.delete(file);
      response.writeHead(SERVER_ERROR).end();
    } else if (fault?.kind === 'quota') {
      this.#faults.delete(file);
      response.writeHead(fault.status, fault.headers).end();
    } else if (this.#published.has(file)) {
      response.writeHead(FOUND, { location: `${ASSET}${file}` }).end();
    } else {
      response.writeHead(NOT_FOUND).end();
    }
  }

  /**
   * The published file that `file` names, with its body: both taken from the release
   * rather than looked up by the request's own text, so that no body that a request
   * names is called unchecked.
   */
  #publishedFile(file: string): readonly [string, Buffer | GeneratedBody] | undefined {
    return [...this.#published].find(([name]) => name === file);
  }

  /** Answers the asset host's address of a file: the file, 304 for its version, or its fault. */
  async #answerAsset(
    file: string,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const published = this.#publishedFile(file);
    if (published === undefined) {
      response.writeHead(NOT_FOUND).end();
      return;
    }
    const [name, stored] = published;
    const fault = this.#faultOf(name);
    if (fault?.kind === 'slow') {
      // A slow answer never comes: the client gives up at its deadline.
      return;
    }
    const body = bodyOf(stored, fault);
    const version = versionOf(body);
    if (request.headers['if-none-match'] === version) {
      response.writeHead(NOT_MODIFIED, { etag: version }).end();
      return;
    }
    response.writeHead(OK, headersOf(version, fault, this.#hasLastModified));
    await writeAll(response, typeof body === 'function' ? body() : chunksOf(body));
  }

  /** The address under which the files are published, as STATS_SOURCE_BASE_URL gives it. */
  get baseUrl(): string {
    return `http://127.0.0.1:${String(this.#port)}/download`;
  }

  /** Starts answering, on a port that the system picks. */
  async listen(): Promise<void> {
    await new Promise<void>((resolve) => this.#server.listen(0, '127.0.0.1', resolve));
    const address = this.#server.address();
    this.#port = typeof address === 'object' && address !== null ? address.port : 0;
  }

  /** Publishes `file` (`tag/name`) with `body`: a correction, for a file already out. */
  publish(file: string, body: string | Buffer | GeneratedBody): void {
    this.#published.set(file, typeof body === 'string' ? Buffer.from(body, 'utf8') : body);
  }

  /** Withdraws `file`, which then answers 404 at its documented address. */
  withdraw(file: string): void {
    this.#published.delete(file);
  }

  /** Makes the next request of `file` meet `fault`. */
  inject(file: string, fault: ReplayFault): void {
    this.#faults.set(file, fault);
  }

  /** Answers every file without its Last-Modified header from now on. */
  omitLastModified(): void {
    this.#hasLastModified = false;
  }

  /** The stored content of `file`, as text. */
  text(file: string): string {
    const body = this.#published.get(file);
    return Buffer.isBuffer(body) ? body.toString('utf8') : '';
  }

  /** Stops answering, and drops every connection still open. */
  async close(): Promise<void> {
    this.#server.closeAllConnections();
    await new Promise((resolve) => this.#server.close(resolve));
  }
}

/** A local release of `files`, the recorded ones unless others are given, already listening. */
export async function startReplay(
  files: ReadonlyMap<string, Buffer> = recordedFiles(),
): Promise<Replay> {
  const replay = new Replay(files);
  await replay.listen();
  return replay;
}
