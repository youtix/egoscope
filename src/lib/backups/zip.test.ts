import { Readable } from 'node:stream';
import { crc32 } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';

import { zip } from './zip';

import type { ZipEntry } from './zip';

const MODIFIED_AT = toEpochMs(Date.UTC(2026, 10, 25, 9, 30, 12));
// The all-ones values of a four-byte and of a two-byte field, which the format keeps as its
// marker for "see the ZIP64 field".
const FOUR_BYTE_MARKER = 0xff_ff_ff_ff;
const TWO_BYTE_MARKER = 0xff_ff;
// The signatures of the records read here, and the offsets of their fields (PKWARE APPNOTE
// 4.3.7, 4.3.9 and 4.3.12).
const LOCAL_SIGNATURE = 0x04_03_4b_50;
const DESCRIPTOR_SIGNATURE = 0x08_07_4b_50;
const CENTRAL_SIGNATURE = 0x02_01_4b_50;
const LOCAL_NAME_LENGTH_AT = 26;
const DESCRIPTOR_CRC_AT = 4;
const DESCRIPTOR_SIZE_AT = 12;
const CENTRAL_CRC_AT = 16;
const CENTRAL_SIZE_AT = 24;
// Four bytes of 0xFF, whose CRC-32 is 0xFFFFFFFF.
const ALL_ONES = new Uint8Array([0xff, 0xff, 0xff, 0xff]);

/** The error that ends an archive whose field of `width` bytes would hold `value`. */
function tooLarge(width: number, maximum: number, value: number): Error {
  return new Error(
    `A ZIP field of ${String(width)} bytes holds at most ${String(maximum)}, not ${String(value)}: the archive has no ZIP64 records, so it stays under 4 GiB and 65535 entries.`,
  );
}

/** A chunk of four bytes whose own `length`, which `zip()` counts as its size, is `length`. */
function claiming(length: number): Uint8Array<ArrayBuffer> {
  const chunk = new Uint8Array([1, 2, 3, 4]);
  Object.defineProperty(chunk, 'length', { value: length });
  return chunk;
}

/** An entry without content whose name is `length` bytes long. */
function named(length: number): ZipEntry {
  return { name: 'a'.repeat(length), chunks: [] };
}

/** The archive of `entries`, written to its end: the first part that each signature starts. */
async function archiveOf(...entries: readonly ZipEntry[]): Promise<ReadonlyMap<number, DataView>> {
  const records = new Map<number, DataView>();
  const parts = zip(Readable.from(entries), MODIFIED_AT);
  for await (const part of parts) {
    const view = new DataView(part.buffer, part.byteOffset, part.byteLength);
    const signature = view.byteLength >= 4 ? view.getUint32(0, true) : 0;
    if (!records.has(signature)) {
      records.set(signature, view);
    }
  }
  return records;
}

/** The record of `records` that starts with `signature`, as a little-endian view. */
function record(records: ReadonlyMap<number, DataView>, signature: number): DataView {
  const found = records.get(signature);
  if (found === undefined) {
    throw new Error('The archive holds no such record.');
  }
  return found;
}

describe('the ZIP writer', () => {
  it('[TRV-52] ends the archive with an error when an entry reaches 0xFFFFFFFF bytes, which the format reads as its ZIP64 marker', async () => {
    const entry = { name: 'rows.jsonl', chunks: [claiming(FOUR_BYTE_MARKER)] };

    await expect(archiveOf(entry)).rejects.toThrow(
      tooLarge(4, FOUR_BYTE_MARKER - 1, FOUR_BYTE_MARKER),
    );
  });

  it('[TRV-52] still writes an entry of 0xFFFFFFFE bytes, in its data descriptor and in the central directory', async () => {
    const entry = { name: 'rows.jsonl', chunks: [claiming(FOUR_BYTE_MARKER - 1)] };

    const records = await archiveOf(entry);

    expect([
      record(records, DESCRIPTOR_SIGNATURE).getUint32(DESCRIPTOR_SIZE_AT, true),
      record(records, CENTRAL_SIGNATURE).getUint32(CENTRAL_SIZE_AT, true),
    ]).toStrictEqual([FOUR_BYTE_MARKER - 1, FOUR_BYTE_MARKER - 1]);
  });

  it('[TRV-52] ends the archive with an error when a two-byte field reaches 0xFFFF, and still writes 0xFFFE', async () => {
    await expect(archiveOf(named(TWO_BYTE_MARKER))).rejects.toThrow(
      tooLarge(2, TWO_BYTE_MARKER - 1, TWO_BYTE_MARKER),
    );
    const records = await archiveOf(named(TWO_BYTE_MARKER - 1));
    const local = record(records, LOCAL_SIGNATURE);
    expect(local.getUint16(LOCAL_NAME_LENGTH_AT, true)).toBe(TWO_BYTE_MARKER - 1);
  });

  it('[TRV-52] writes a CRC-32 of 0xFFFFFFFF, a value like any other for the checksum', async () => {
    expect(crc32(ALL_ONES)).toBe(FOUR_BYTE_MARKER);

    const records = await archiveOf({ name: 'ones.bin', chunks: [ALL_ONES] });

    expect([
      record(records, DESCRIPTOR_SIGNATURE).getUint32(DESCRIPTOR_CRC_AT, true),
      record(records, CENTRAL_SIGNATURE).getUint32(CENTRAL_CRC_AT, true),
    ]).toStrictEqual([FOUR_BYTE_MARKER, FOUR_BYTE_MARKER]);
  });
});
