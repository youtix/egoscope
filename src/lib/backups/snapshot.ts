import 'server-only';

import { logger } from '@/lib/log';
import { ok } from '@/lib/result';

import type { Database, DatabaseError, Transaction } from '@/lib/db';
import type { Result } from '@/lib/result';

/** What a snapshot stream writes, and what runs, if anything, once it is all written. */
type SnapshotWork = Readonly<{
  produce: (tx: Transaction) => AsyncIterable<Uint8Array>;
  completed?: () => Promise<Result<unknown, DatabaseError>>;
}>;

// One snapshot, so that every file of an export describes the same instant (TRV-52).
const SNAPSHOT = { isolationLevel: 'repeatable read', accessMode: 'read only' } as const;

/**
 * The parts that `work.produce` writes in one read-only, repeatable-read transaction of
 * `db`, as a stream that its reader pulls: the file is never held whole, since only an
 * unstreamed response meets the host's 4.5 MB limit (TRV-52). Once the last part is read
 * and the snapshot over, `work.completed` runs before the stream closes; a failure on the
 * way, or a reader who stops, ends the stream short and rolls the snapshot back.
 */
export function snapshotStream(db: Database, work: SnapshotWork): ReadableStream<Uint8Array> {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const run = async () => {
    try {
      await db.transaction(async (tx) => {
        for await (const part of work.produce(tx)) {
          await writer.write(part);
        }
      }, SNAPSHOT);
      const completed = work.completed === undefined ? ok(undefined) : await work.completed();
      if (completed.ok) {
        await writer.close();
      } else {
        logger.error('A download could not be recorded.', { cause: completed.error.kind });
        await writer.abort(completed.error);
      }
    } catch (error) {
      logger.warn('An export ended before its last part.', { error });
      await writer.abort(error);
    }
  };
  void run();
  return readable;
}
