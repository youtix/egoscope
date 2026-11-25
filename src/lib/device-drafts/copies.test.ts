import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { dropExpiredCopies, hasUnsentDeviceDrafts } from './copies';
import { draftKey } from './draft-target';
import { listCopies, putContact, putCopy } from './store';

import type { DraftTarget } from './draft-target';
import type { DeviceCopy } from './store';
import type { FixedClock } from '@/lib/time';

const NOW = toEpochMs(Date.UTC(2026, 10, 20, 9));
const DAY_MS = 86_400_000;
// The default of display.draftRetentionDays.
const RETENTION_DAYS = 7;
const IMPORT: DraftTarget = { kind: 'research_result', requestId: 1 };
const OTHER_IMPORT: DraftTarget = { kind: 'research_result', requestId: 2 };
const GENERAL: DraftTarget = { kind: 'exploration_response', eventTypeId: null };

/** A copy of `target` whose last change was `ageMs` before now. */
function copyOf(target: DraftTarget, isSent: boolean, ageMs = 0): DeviceCopy {
  return {
    key: draftKey(target),
    target,
    text: `Pasted for ${draftKey(target)}.`,
    updatedAt: toEpochMs(NOW - ageMs),
    sent: isSent,
    withdrawnEventCount: 0,
    status: 'kept',
  };
}

describe('the device copies left once the expired ones are gone', () => {
  let clock: FixedClock;

  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    clock = fixedClock(NOW);
    const restoreClock = installFakeClock(clock);
    return () => {
      restoreClock();
      vi.unstubAllGlobals();
    };
  });

  it('[CL-IHM-10] tells whether the device holds a draft not yet sent to the server', async () => {
    expect(await hasUnsentDeviceDrafts()).toBe(false);

    await putCopy(copyOf(IMPORT, true));

    expect(await hasUnsentDeviceDrafts()).toBe(false);

    await putCopy(copyOf(GENERAL, false));

    expect(await hasUnsentDeviceDrafts()).toBe(true);
  });

  it('[CL-IHM-10] [CL-IHM-11] counts no expired copy for the logout warning, and deletes it', async () => {
    await putContact({ withdrawnEventCount: 0, retentionDays: RETENTION_DAYS });
    await putCopy(copyOf(IMPORT, false, 30 * DAY_MS));

    expect(await hasUnsentDeviceDrafts()).toBe(false);
    expect(await listCopies()).toStrictEqual([]);
  });

  it('[CL-IHM-11] [CL-DSN-22] deletes every copy at its expiry, whatever its screen, and keeps the others', async () => {
    await putContact({ withdrawnEventCount: 0, retentionDays: RETENTION_DAYS });
    await putCopy(copyOf(IMPORT, true, RETENTION_DAYS * DAY_MS));
    await putCopy(copyOf(OTHER_IMPORT, false, RETENTION_DAYS * DAY_MS - 1));
    await putCopy(copyOf(GENERAL, false, RETENTION_DAYS * DAY_MS + 1));

    expect(await dropExpiredCopies()).toStrictEqual([
      copyOf(OTHER_IMPORT, false, RETENTION_DAYS * DAY_MS - 1),
    ]);

    clock.advance(1);

    expect(await dropExpiredCopies()).toStrictEqual([]);
    expect(await listCopies()).toStrictEqual([]);
  });

  it('[CL-IHM-11] keeps every copy on a device that never received the retention', async () => {
    await putCopy(copyOf(IMPORT, false, 30 * DAY_MS));

    expect(await dropExpiredCopies()).toStrictEqual([copyOf(IMPORT, false, 30 * DAY_MS)]);
    expect(await hasUnsentDeviceDrafts()).toBe(true);
  });
});
