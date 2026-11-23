import { beforeEach, describe, expect, expectTypeOf, it } from 'vitest';

import { createTestDatabase, uiState } from '@/lib/db';
import { toEpochMs } from '@/lib/time';

import { getUiSetting, setUiSetting } from './ui-settings';

import type { UiSettingKey, UiSettings } from './ui-settings';
import type { Database } from '@/lib/db';

const VIEWED_AT = toEpochMs(Date.UTC(2026, 10, 23, 9, 0));
const HIDDEN_AT = toEpochMs(Date.UTC(2026, 10, 23, 21, 30));

describe('the interface settings', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    return database.close;
  }, 60_000);

  /** Saves `value` as the interface setting `key`, in a transaction of its own. */
  async function save<K extends UiSettingKey>(key: K, value: UiSettings[K], version: number) {
    return db.transaction(async (tx) => setUiSetting(tx, { key, value, expectedVersion: version }));
  }

  /** Every interface setting as it now stands. */
  async function settings() {
    return {
      onboardingGuideHidden: await getUiSetting(db, 'onboardingGuideHidden'),
      firstProfileViewedAt: await getUiSetting(db, 'firstProfileViewedAt'),
      inProgressBannerHiddenAt: await getUiSetting(db, 'inProgressBannerHiddenAt'),
    };
  }

  it('[IHM-53] [CL-IHM-18] gives each setting its default, at version 0, until a first save', async () => {
    expect(await settings()).toStrictEqual({
      onboardingGuideHidden: { value: false, version: 0 },
      firstProfileViewedAt: { value: null, version: 0 },
      inProgressBannerHiddenAt: { value: null, version: 0 },
    });
  });

  it('[IHM-40] [IHM-53] [CL-IHM-13] keeps the guide state, the first profile viewed and the hidden banner for every device', async () => {
    const saves = [
      await save('onboardingGuideHidden', true, 0),
      await save('firstProfileViewedAt', VIEWED_AT, 1),
      await save('inProgressBannerHiddenAt', HIDDEN_AT, 2),
    ];

    expect(saves).toStrictEqual([
      { ok: true, value: { version: 1 } },
      { ok: true, value: { version: 2 } },
      { ok: true, value: { version: 3 } },
    ]);
    expect(await settings()).toStrictEqual({
      onboardingGuideHidden: { value: true, version: 3 },
      firstProfileViewedAt: { value: VIEWED_AT, version: 3 },
      inProgressBannerHiddenAt: { value: HIDDEN_AT, version: 3 },
    });
    expect(await save('inProgressBannerHiddenAt', null, 3)).toStrictEqual({
      ok: true,
      value: { version: 4 },
    });
    expect(await getUiSetting(db, 'inProgressBannerHiddenAt')).toStrictEqual({
      value: null,
      version: 4,
    });
  });

  it('[CL-IHM-18] refuses a save sent with a stale version, with the setting as it now stands', async () => {
    await save('onboardingGuideHidden', true, 0);

    expect(await save('inProgressBannerHiddenAt', HIDDEN_AT, 0)).toStrictEqual({
      ok: false,
      error: { kind: 'changed_elsewhere', current: { value: null, version: 1 } },
    });
    expect(await save('onboardingGuideHidden', false, 5)).toStrictEqual({
      ok: false,
      error: { kind: 'changed_elsewhere', current: { value: true, version: 1 } },
    });
  });

  it('[CL-IHM-05] keeps no declined time-zone offer, which stays on the device that declined it', async () => {
    await save('onboardingGuideHidden', true, 0);
    const rows = await db.select().from(uiState);

    expectTypeOf<UiSettingKey>().toEqualTypeOf<
      'onboardingGuideHidden' | 'firstProfileViewedAt' | 'inProgressBannerHiddenAt'
    >();
    expect(rows).toStrictEqual([
      {
        id: 1,
        onboardingGuideHidden: true,
        firstProfileViewedAt: null,
        inProgressBannerHiddenAt: null,
        rowVersion: 1,
      },
    ]);
  });
});
