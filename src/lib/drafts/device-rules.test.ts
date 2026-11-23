import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';

import { copyFate, hasExpired } from './device-rules';
import { draftKey } from './draft-target';

import type { DraftCheck } from './contract';
import type { DeviceCopy } from './device-store';
import type { DraftTarget } from './draft-target';

const TYPED_AT = toEpochMs(Date.UTC(2026, 10, 20, 9));
const DAY_MS = 86_400_000;
const AT = toEpochMs(TYPED_AT + DAY_MS);
const IMPORT: DraftTarget = { kind: 'research_result', requestId: 1 };
const EXPLORATION: DraftTarget = { kind: 'exploration_response', eventTypeId: null };

function copyOf(
  target: DraftTarget,
  isSent: boolean,
  withdrawnEventCount: number | null,
): DeviceCopy {
  return {
    key: draftKey(target),
    target,
    text: 'Pasted text.',
    updatedAt: TYPED_AT,
    sent: isSent,
    withdrawnEventCount,
    status: 'kept',
  };
}

function checkOf(
  withdrawnEventCount: number,
  status?: Readonly<{ exists: boolean; requestImported: boolean }>,
): DraftCheck {
  return {
    withdrawnEventCount,
    retentionDays: 7,
    copies: status === undefined ? [] : [{ target: IMPORT, ...status }],
  };
}

describe('the fate of a device copy at a contact', () => {
  it('[CL-DSN-22] keeps a sent copy whose server copy exists', () => {
    expect(
      copyFate(copyOf(IMPORT, true, 2), checkOf(5, { exists: true, requestImported: false }), AT),
    ).toBe('keep');
    // A copy the answer does not cover was not asked about: it stays until the next contact.
    expect(copyFate(copyOf(IMPORT, true, 2), checkOf(5), AT)).toBe('keep');
  });

  it('[CL-DSN-22] marks a sent copy "Request already imported" when its request was imported and the counter has not grown', () => {
    const gone = { exists: false, requestImported: true };

    expect(copyFate(copyOf(IMPORT, true, 2), checkOf(2, gone), AT)).toBe('mark_imported');
    expect(copyFate(copyOf(IMPORT, true, 2), checkOf(3, gone), AT)).toBe('drop');
  });

  it('[CL-DSN-22] drops a sent copy whose server copy is gone otherwise, whatever ended it', () => {
    expect(
      copyFate(copyOf(IMPORT, true, 2), checkOf(2, { exists: false, requestImported: false }), AT),
    ).toBe('drop');
  });

  it('[CL-DSN-22] discards an import copy never sent when the counter has grown, or was never received and some event was withdrawn, and sends it otherwise', () => {
    expect(copyFate(copyOf(IMPORT, false, 2), checkOf(3), AT)).toBe('discard_unsent');
    expect(copyFate(copyOf(IMPORT, false, null), checkOf(1), AT)).toBe('discard_unsent');
    expect(copyFate(copyOf(IMPORT, false, null), checkOf(0), AT)).toBe('send');
    expect(copyFate(copyOf(IMPORT, false, 3), checkOf(3), AT)).toBe('send');
  });

  it('[CL-DSN-22] sends an exploration copy never sent whatever the counter', () => {
    const recordedCounts = fc.option(fc.nat({ max: 50 }), { nil: null });
    const answeredCounts = fc.nat({ max: 50 });

    fc.assert(
      fc.property(recordedCounts, answeredCounts, (recorded, answered) => {
        expect(copyFate(copyOf(EXPLORATION, false, recorded), checkOf(answered), AT)).toBe('send');
      }),
    );
  });

  it('[CL-IHM-11] drops a copy at its expiry, sent or not, and keeps it before', () => {
    const expiry = toEpochMs(TYPED_AT + 7 * DAY_MS);

    expect(copyFate(copyOf(IMPORT, false, 3), checkOf(3), expiry)).toBe('drop');
    expect(
      copyFate(
        copyOf(IMPORT, true, 3),
        checkOf(3, { exists: true, requestImported: false }),
        expiry,
      ),
    ).toBe('drop');
    expect(copyFate(copyOf(IMPORT, false, 3), checkOf(3), toEpochMs(expiry - 1))).toBe('send');
    expect(hasExpired(copyOf(IMPORT, false, 3), null, expiry)).toBe(false);
  });
});
