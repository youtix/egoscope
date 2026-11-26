import 'server-only';

import { crc32 } from 'node:zlib';

import type { EpochMs } from '@/lib/time';

/** Bytes over a plain `ArrayBuffer`, which `CompressionStream` takes. */
type Bytes = Uint8Array<ArrayBuffer>;

/** One file of a ZIP archive: its name inside the archive, and its content in parts. */
export type ZipEntry = Readonly<{
  name: string;
  chunks: AsyncIterable<Bytes> | Iterable<Bytes>;
}>;

// The record signatures and fields of the ZIP format (PKWARE APPNOTE, sections 4.3 and 4.4).
const LOCAL_FILE_HEADER = 0x04_03_4b_50;
const DATA_DESCRIPTOR = 0x08_07_4b_50;
const CENTRAL_FILE_HEADER = 0x02_01_4b_50;
const END_OF_CENTRAL_DIRECTORY = 0x06_05_4b_50;
// Version 2.0: deflate, the oldest version every reader opens.
const VERSION = 20;
// Bit 3: the sizes and the CRC follow the data; bit 11: the names are UTF-8.
const FLAGS = 0x08_08;
const DEFLATE = 8;
const DOS_EPOCH_YEAR = 1980;
// Where each field sits in the MS-DOS time (hour, minute, two-second step) and date
// (years since 1980, month, day).
const HOUR_SHIFT = 11;
const MINUTE_SHIFT = 5;
const SECOND_SHIFT = 1;
const YEAR_SHIFT = 9;
const MONTH_SHIFT = 5;
// The kinds of field: a two-byte and a four-byte number, and the four-byte CRC-32.
const SHORT = 'short';
const LONG = 'long';
const CHECKSUM = 'checksum';
const TWO_BYTES = 2;
const FOUR_BYTES = 4;
const WIDTHS = { [SHORT]: TWO_BYTES, [LONG]: FOUR_BYTES, [CHECKSUM]: FOUR_BYTES } as const;
// The largest value each kind holds. A CRC-32 may take any value of its four bytes; a size,
// an offset or a count stays below the all-ones value, which the format keeps as its marker
// for "see the ZIP64 field", and the format written has no ZIP64 records.
const SHORT_MAXIMUM = 0xff_fe;
const LONG_MAXIMUM = 0xff_ff_ff_fe;
const CHECKSUM_MAXIMUM = 0xff_ff_ff_ff;
const MAXIMUMS = {
  [SHORT]: SHORT_MAXIMUM,
  [LONG]: LONG_MAXIMUM,
  [CHECKSUM]: CHECKSUM_MAXIMUM,
} as const;

type Field = readonly [kind: keyof typeof WIDTHS, value: number];

/** What the central directory says of an entry once its data is written. */
type Written = Readonly<{
  name: Uint8Array;
  crc: number;
  compressedSize: number;
  size: number;
  offset: number;
}>;

const encoder = new TextEncoder();

/**
 * The little-endian bytes of `fields`, then `tail`. A value that its field cannot hold ends
 * the archive with an error instead of wrapping into a corrupt file.
 */
function bytes(fields: readonly Field[], tail: Uint8Array = new Uint8Array()): Uint8Array {
  const width = fields.reduce((sum, [kind]) => sum + WIDTHS[kind], 0);
  const out = new Uint8Array(width + tail.length);
  const view = new DataView(out.buffer);
  let at = 0;
  for (const [kind, value] of fields) {
    if (value > MAXIMUMS[kind]) {
      throw new Error(
        `A ZIP field of ${String(WIDTHS[kind])} bytes holds at most ${String(MAXIMUMS[kind])}, not ${String(value)}: the archive has no ZIP64 records, so its sizes and offsets stay below 4 GiB, and its counts and name lengths below 65535.`,
      );
    }
    if (kind === SHORT) {
      view.setUint16(at, value, true);
    } else {
      view.setUint32(at, value, true);
    }
    at += WIDTHS[kind];
  }
  out.set(tail, width);
  return out;
}

/** The MS-DOS time and date of `instant`, in UTC, that every entry carries. */
function dosStamp(instant: EpochMs): readonly [time: number, date: number] {
  const at = new Date(instant);
  const time =
    (at.getUTCHours() << HOUR_SHIFT) |
    (at.getUTCMinutes() << MINUTE_SHIFT) |
    (at.getUTCSeconds() >> SECOND_SHIFT);
  const date =
    ((at.getUTCFullYear() - DOS_EPOCH_YEAR) << YEAR_SHIFT) |
    ((at.getUTCMonth() + 1) << MONTH_SHIFT) |
    at.getUTCDate();
  return [time, date];
}

/** The fields that the local and the central header of an entry share, after the version. */
function common(stamp: readonly [number, number], entry: Omit<Written, 'offset' | 'name'>) {
  return [
    [SHORT, FLAGS],
    [SHORT, DEFLATE],
    [SHORT, stamp[0]],
    [SHORT, stamp[1]],
    [CHECKSUM, entry.crc],
    [LONG, entry.compressedSize],
    [LONG, entry.size],
  ] as const satisfies readonly Field[];
}

/**
 * Reads `stream` to its end, a part at a time, and cancels it when the reader stops early.
 * @yields {Uint8Array} Each part of the stream.
 */
async function* partsOf(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  let isDone = false;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) {
        isDone = true;
        return;
      }
      yield part.value;
    }
  } finally {
    if (!isDone) {
      await reader.cancel();
    }
  }
}

/** The parts of `chunks` as a web stream, pulled one at a time; cancelling it ends them. */
function toStream(chunks: AsyncIterable<Bytes>): ReadableStream<Bytes> {
  const iterator = chunks[Symbol.asyncIterator]();
  return new ReadableStream<Bytes>(
    {
      async pull(controller) {
        const next = await iterator.next();
        if (next.done === true) {
          controller.close();
        } else {
          controller.enqueue(next.value);
        }
      },
      async cancel() {
        await iterator.return?.();
      },
    },
    { highWaterMark: 0 },
  );
}

type Sizes = Readonly<{ crc: number; size: number; compressedSize: number }>;

/**
 * Writes one entry's data, compressed, and returns what its descriptor and its record of
 * the central directory say of it.
 * @yields {Uint8Array} The compressed data, in parts.
 */
async function* entryData(entry: ZipEntry): AsyncGenerator<Uint8Array, Sizes> {
  let crc = 0;
  let size = 0;
  let compressedSize = 0;
  async function* counted(): AsyncGenerator<Bytes> {
    for await (const chunk of entry.chunks) {
      crc = crc32(chunk, crc);
      size += chunk.length;
      yield chunk;
    }
  }
  const compressed = toStream(counted()).pipeThrough(new CompressionStream('deflate-raw'));
  for await (const part of partsOf(compressed)) {
    compressedSize += part.length;
    yield part;
  }
  return { crc, size, compressedSize };
}

/** The central directory and its end record, after the entries `written` starting at `offset`. */
function directory(written: readonly Written[], stamp: readonly [number, number], offset: number) {
  const records = written.map((entry) =>
    bytes(
      [
        [LONG, CENTRAL_FILE_HEADER],
        [SHORT, VERSION],
        [SHORT, VERSION],
        ...common(stamp, entry),
        [SHORT, entry.name.length],
        [SHORT, 0],
        [SHORT, 0],
        [SHORT, 0],
        [SHORT, 0],
        [LONG, 0],
        [LONG, entry.offset],
      ],
      entry.name,
    ),
  );
  const size = records.reduce((sum, record) => sum + record.length, 0);
  const end = bytes([
    [LONG, END_OF_CENTRAL_DIRECTORY],
    [SHORT, 0],
    [SHORT, 0],
    [SHORT, written.length],
    [SHORT, written.length],
    [LONG, size],
    [LONG, offset],
    [SHORT, 0],
  ]);
  return [...records, end];
}

/**
 * A ZIP archive of `entries`, written as it goes: each entry deflated, its sizes and
 * CRC in a data descriptor after its data, then the central directory, so that any
 * archive tool opens it without the application (TRV-52, TRV-53, operations.md §5.1).
 * Every entry carries `modifiedAt`, in UTC. Each entry is read to its end before the
 * next one is asked for. The format has no ZIP64 records: an archive stays under 4 GiB.
 * @yields {Uint8Array} The archive's bytes, in order.
 */
export async function* zip(
  entries: AsyncIterable<ZipEntry>,
  modifiedAt: EpochMs,
): AsyncGenerator<Uint8Array, void, undefined> {
  const stamp = dosStamp(modifiedAt);
  const written: Written[] = [];
  let offset = 0;
  for await (const entry of entries) {
    const name = encoder.encode(entry.name);
    const empty = { crc: 0, compressedSize: 0, size: 0 };
    const header = bytes(
      [
        [LONG, LOCAL_FILE_HEADER],
        [SHORT, VERSION],
        ...common(stamp, empty),
        [SHORT, name.length],
        [SHORT, 0],
      ],
      name,
    );
    yield header;
    const sizes = yield* entryData(entry);
    const descriptor = bytes([
      [LONG, DATA_DESCRIPTOR],
      [CHECKSUM, sizes.crc],
      [LONG, sizes.compressedSize],
      [LONG, sizes.size],
    ]);
    yield descriptor;
    written.push({ name, ...sizes, offset });
    offset += header.length + sizes.compressedSize + descriptor.length;
  }
  yield* directory(written, stamp, offset);
}
