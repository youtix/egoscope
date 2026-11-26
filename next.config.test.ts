import { describe, expect, it, onTestFinished } from 'vitest';

import { createTestDatabase } from '@/lib/db';
import { listRegistry } from '@/lib/params';
import { DATABASE_TEST_TIMEOUT_MS } from '@/lib/testing';

import nextConfig from './next.config';

// A megabyte of pasted text is 1,000,000 bytes of UTF-8 (CL-IMP-27).
const BYTES_PER_MEGABYTE = 1_000_000;
// The least room that the transport needs beside the text: Next.js's guide on
// `serverActions.bodySizeLimit` puts a multipart body's own bytes at 10 to 20 KB.
const LEAST_TRANSPORT_ROOM_BYTES = 20_000;
// The upper bound in the allowed values of a decimal parameter: "0.5 to 4 MB, step 0.5".
const UPPER_BOUND = / to (?<bound>\d+(?:\.\d+)?) MB, step /u;

/** The largest value, in MB, that the registry lets the owner give `imports.maxPastedTextMegabytes`. */
async function largestPastedMegabytes(): Promise<number> {
  const database = await createTestDatabase();
  onTestFinished(database.close);
  const rows = await listRegistry(database.db, 1);
  const allowed = rows.find(({ key }) => key === 'imports.maxPastedTextMegabytes')?.allowed;
  return Number(UPPER_BOUND.exec(allowed ?? '')?.groups?.['bound']);
}

describe('the Next.js configuration', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  it('[IMP-02] [CL-IMP-27] lets a Server Action receive the largest text that the pasted-size parameter allows, with room for the transport', async () => {
    const largest = await largestPastedMegabytes();
    const limit = nextConfig.experimental?.serverActions?.bodySizeLimit;

    expect(largest).toBeGreaterThan(0);
    expect(typeof limit).toBe('number');
    expect(limit).toBeGreaterThanOrEqual(largest * BYTES_PER_MEGABYTE + LEAST_TRANSPORT_ROOM_BYTES);
  });
});
