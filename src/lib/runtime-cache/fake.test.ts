import { describe, expect, it, onTestFinished } from 'vitest';

import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { RUNTIME_CACHE_CONTRACT } from './contract';
import { createFakeRuntimeCache } from './fake';

const KEY = 'wake:plan';
const OTHER_KEY = 'tick:last';
const HOUR_SECONDS = 3600;
// The unit in which the host meters reads and writes (hosting sheet).
const UNIT_BYTES = 8192;
const UNAVAILABLE = { ok: false, error: { kind: 'unavailable' } };

describe('[TRV-12] the fake Runtime Cache holds to the contract of every adapter', () => {
  it.each(RUNTIME_CACHE_CONTRACT)('$title', async ({ run, expected }) => {
    const fake = createFakeRuntimeCache();

    const result = await run({
      cache: fake,
      breakCache: () => {
        fake.setAvailable(false);
      },
    });

    expect(result).toStrictEqual(expected);
  });
});

describe('createFakeRuntimeCache', () => {
  it('[TRV-31] keeps an entry for its time to live, to the millisecond, and forgets it then', async () => {
    const clock = fixedClock(toEpochMs(Date.UTC(2026, 10, 21, 9)));
    onTestFinished(installFakeClock(clock));
    const fake = createFakeRuntimeCache();
    await fake.set(KEY, 'plan', 60);

    clock.advance(59_999);
    const before = await fake.get(KEY);
    clock.advance(1);
    const after = await fake.get(KEY);

    expect([before, after]).toStrictEqual([
      { ok: true, value: 'plan' },
      { ok: true, value: null },
    ]);
  });

  it('[TRV-31] drops an evicted entry and keeps the others', async () => {
    const fake = createFakeRuntimeCache();
    await fake.set(KEY, 'plan', HOUR_SECONDS);
    await fake.set(OTHER_KEY, 'ticks', HOUR_SECONDS);

    fake.evict(KEY);

    expect([await fake.get(KEY), await fake.get(OTHER_KEY)]).toStrictEqual([
      { ok: true, value: null },
      { ok: true, value: 'ticks' },
    ]);
  });

  it('[TRV-31] loses every entry at once', async () => {
    const fake = createFakeRuntimeCache();
    await fake.set(KEY, 'plan', HOUR_SECONDS);
    await fake.set(OTHER_KEY, 'ticks', HOUR_SECONDS);

    fake.loseAll();

    expect([await fake.get(KEY), await fake.get(OTHER_KEY)]).toStrictEqual([
      { ok: true, value: null },
      { ok: true, value: null },
    ]);
  });

  it('[TRV-31] fails while unavailable, keeps what it held, and works again once available', async () => {
    const fake = createFakeRuntimeCache();
    await fake.set(KEY, 'plan', HOUR_SECONDS);

    fake.setAvailable(false);
    const refused = [await fake.set(KEY, 'other plan', HOUR_SECONDS), await fake.delete(KEY)];
    fake.setAvailable(true);

    expect(refused).toStrictEqual([UNAVAILABLE, UNAVAILABLE]);
    expect(await fake.get(KEY)).toStrictEqual({ ok: true, value: 'plan' });
  });

  it('[TRV-31] refuses writes and deletes while unwritable, still reading, and writes again once writable', async () => {
    const fake = createFakeRuntimeCache();
    await fake.set(KEY, 'plan', HOUR_SECONDS);

    fake.setWritable(false);
    const refused = [await fake.set(KEY, 'other plan', HOUR_SECONDS), await fake.delete(KEY)];
    const read = await fake.get(KEY);
    fake.setWritable(true);
    await fake.set(KEY, 'other plan', HOUR_SECONDS);

    expect(refused).toStrictEqual([UNAVAILABLE, UNAVAILABLE]);
    expect(read).toStrictEqual({ ok: true, value: 'plan' });
    expect(await fake.get(KEY)).toStrictEqual({ ok: true, value: 'other plan' });
  });

  it('[TRV-31] loses the next write to a key to a racing writer, and takes the writes after it', async () => {
    const fake = createFakeRuntimeCache();
    await fake.set(KEY, 'first', HOUR_SECONDS);

    fake.raceNextWrite(KEY);
    const lost = await fake.set(KEY, 'second', HOUR_SECONDS);
    const afterRace = await fake.get(KEY);
    await fake.set(KEY, 'third', HOUR_SECONDS);

    expect(lost).toStrictEqual({ ok: true });
    expect(afterRace).toStrictEqual({ ok: true, value: 'first' });
    expect(await fake.get(KEY)).toStrictEqual({ ok: true, value: 'third' });
  });

  it('keeps a value as JSON, out of reach of a later change to the object that was written', async () => {
    const fake = createFakeRuntimeCache();
    const value = { entries: ['purge'] };
    await fake.set(KEY, value, HOUR_SECONDS);

    value.entries.push('backup');

    expect(await fake.get(KEY)).toStrictEqual({ ok: true, value: { entries: ['purge'] } });
  });

  it('[TRV-04] counts the writes and deletes that it took, by key and in all, and none it refused', async () => {
    const fake = createFakeRuntimeCache();
    await fake.set(KEY, 'plan', HOUR_SECONDS);
    await fake.set(KEY, 'plan', HOUR_SECONDS);
    await fake.delete(OTHER_KEY);
    await fake.get(KEY);
    fake.setAvailable(false);
    await fake.set(KEY, 'plan', HOUR_SECONDS);

    expect([fake.writeCount(KEY), fake.writeCount(OTHER_KEY), fake.writeCount()]).toStrictEqual([
      2, 1, 3,
    ]);
  });

  it('[TRV-04] counts each write in units of 8 KB of its value as JSON in UTF-8, rounded up, and a delete as one', async () => {
    const fake = createFakeRuntimeCache();
    // A value of 8,192 bytes as JSON: 8,190 characters between its quotes.
    await fake.set(KEY, 'v'.repeat(UNIT_BYTES - 2), HOUR_SECONDS);
    // One byte more: two units.
    await fake.set(KEY, 'v'.repeat(UNIT_BYTES - 1), HOUR_SECONDS);
    // 4,096 characters of three bytes each in UTF-8, 12,290 bytes with the quotes: two units.
    await fake.set(OTHER_KEY, '€'.repeat(UNIT_BYTES / 2), HOUR_SECONDS);
    await fake.set(OTHER_KEY, null, HOUR_SECONDS);
    await fake.delete(OTHER_KEY);

    expect([fake.writeUnits(KEY), fake.writeUnits(OTHER_KEY), fake.writeUnits()]).toStrictEqual([
      3, 4, 7,
    ]);
  });

  it('[TRV-04] counts each read in units of the value it finds, and one for a read that finds nothing', async () => {
    const clock = fixedClock(toEpochMs(Date.UTC(2026, 10, 21, 9)));
    onTestFinished(installFakeClock(clock));
    const fake = createFakeRuntimeCache();
    await fake.set(KEY, 'v'.repeat(2 * UNIT_BYTES), 60);

    await fake.get(KEY);
    await fake.get(OTHER_KEY);
    clock.advance(60_000);
    await fake.get(KEY);

    expect([fake.readUnits(KEY), fake.readUnits(OTHER_KEY), fake.readUnits()]).toStrictEqual([
      4, 1, 5,
    ]);
  });

  it('[TRV-04] counts the units of a write lost to a racing writer, which the cache took, and none of what it refused', async () => {
    const fake = createFakeRuntimeCache();
    fake.raceNextWrite(KEY);
    await fake.set(KEY, 'v'.repeat(UNIT_BYTES), HOUR_SECONDS);
    fake.setWritable(false);
    await fake.set(KEY, 'plan', HOUR_SECONDS);
    await fake.delete(KEY);
    fake.setAvailable(false);
    await fake.get(KEY);

    expect([fake.writeUnits(), fake.readUnits()]).toStrictEqual([2, 0]);
  });
});
