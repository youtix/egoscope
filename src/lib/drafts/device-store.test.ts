import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { toEpochMs } from '@/lib/time';

import {
  clearDeviceDrafts,
  deleteCopy,
  listCopies,
  putContact,
  putCopy,
  readContact,
  readCopy,
} from './device-store';
import { draftKey } from './draft-target';

import type { DeviceCopy } from './device-store';
import type { DraftTarget } from './draft-target';

const IMPORT: DraftTarget = { kind: 'research_result', requestId: 1 };
const GENERAL: DraftTarget = { kind: 'exploration_response', eventTypeId: null };

function copyOf(target: DraftTarget, isSent: boolean): DeviceCopy {
  return {
    key: draftKey(target),
    target,
    text: 'Pasted text.',
    updatedAt: toEpochMs(Date.UTC(2026, 10, 20)),
    sent: isSent,
    withdrawnEventCount: 0,
    status: 'kept',
  };
}

describe('the device copies of drafts', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    return () => {
      vi.unstubAllGlobals();
    };
  });

  it('[IHM-42] keeps a copy across openings of the database, as a reload does', async () => {
    await putCopy(copyOf(IMPORT, false));

    expect(await readCopy(draftKey(IMPORT))).toStrictEqual(copyOf(IMPORT, false));
    expect(await readCopy(draftKey(GENERAL))).toBeUndefined();

    await putCopy(copyOf(IMPORT, true));
    await putCopy(copyOf(GENERAL, true));
    await deleteCopy(draftKey(GENERAL));

    expect(await listCopies()).toStrictEqual([copyOf(IMPORT, true)]);
  });

  it('[DSN-33] [CL-IHM-10] erases every device copy and the last contact at logout', async () => {
    await putCopy(copyOf(IMPORT, false));
    await putContact({ withdrawnEventCount: 3, retentionDays: 7 });

    expect(await readContact()).toStrictEqual({ withdrawnEventCount: 3, retentionDays: 7 });

    await clearDeviceDrafts();

    expect(await listCopies()).toStrictEqual([]);
    expect(await readContact()).toBeUndefined();
  });

  it('[IHM-42] fails, without a copy, when the browser refuses the database', async () => {
    const newer = indexedDB.open('egoscope-drafts', 2);
    await new Promise((resolve) => {
      newer.addEventListener('success', () => {
        newer.result.close();
        resolve(undefined);
      });
    });

    await expect(readCopy(draftKey(IMPORT))).rejects.toMatchObject({ name: 'VersionError' });
  });
});
