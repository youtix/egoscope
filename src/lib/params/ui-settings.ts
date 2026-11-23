import 'server-only';

import { eq } from 'drizzle-orm';

import { uiState, updateVersioned } from '@/lib/db';
import { changedElsewhere, err, ok } from '@/lib/result';
import { toEpochMs } from '@/lib/time';

import type { Executor } from './accessors';
import type { Transaction } from '@/lib/db';
import type { ChangedElsewhere, Result } from '@/lib/result';
import type { EpochMs } from '@/lib/time';

/**
 * The interface settings that are not parameters, kept by the application for every
 * device (IHM-40, IHM-53, CL-IHM-13): the getting-started guide hidden, the instant the
 * first profile was viewed, the instant the in-progress banner was hidden. A declined
 * time-zone offer is not among them: it stays on the device that declined it (CL-IHM-05).
 */
export type UiSettings = Readonly<{
  onboardingGuideHidden: boolean;
  firstProfileViewedAt: EpochMs | null;
  inProgressBannerHiddenAt: EpochMs | null;
}>;

/** The name of one interface setting. */
export type UiSettingKey = keyof UiSettings;

/** An interface setting as it now stands, with the version a screen sends back (CL-IHM-18). */
export type UiSetting<K extends UiSettingKey> = Readonly<{ value: UiSettings[K]; version: number }>;

type UiStateRow = typeof uiState.$inferSelect;

// The single row of `ui_state`, and the version that stands for no save yet.
const ROW_ID = 1;
const NEVER_SAVED = 0;
const OF_ROW = eq(uiState.id, ROW_ID);

const DEFAULTS: UiSettings = {
  onboardingGuideHidden: false,
  firstProfileViewedAt: null,
  inProgressBannerHiddenAt: null,
};

const instantOf = (date: Date | null): EpochMs | null =>
  date === null ? null : toEpochMs(date.getTime());

const dateOf = (instant: EpochMs | null): Date | null =>
  instant === null ? null : new Date(instant);

/** The columns that each setting writes. */
const COLUMNS: {
  readonly [K in UiSettingKey]: (value: UiSettings[K]) => Partial<typeof uiState.$inferInsert>;
} = {
  onboardingGuideHidden: (value) => ({ onboardingGuideHidden: value }),
  firstProfileViewedAt: (value) => ({ firstProfileViewedAt: dateOf(value) }),
  inProgressBannerHiddenAt: (value) => ({ inProgressBannerHiddenAt: dateOf(value) }),
};

const settingsOf = (row: UiStateRow): UiSettings => ({
  onboardingGuideHidden: row.onboardingGuideHidden,
  firstProfileViewedAt: instantOf(row.firstProfileViewedAt),
  inProgressBannerHiddenAt: instantOf(row.inProgressBannerHiddenAt),
});

/**
 * The interface setting `key` as it now stands, with its version (IHM-40, IHM-53,
 * CL-IHM-13, CL-IHM-18): its default, at version 0, until a first save.
 */
export async function getUiSetting<K extends UiSettingKey>(
  db: Executor,
  key: K,
): Promise<UiSetting<K>> {
  const [row] = await db.select().from(uiState).where(OF_ROW);
  return row === undefined
    ? { value: DEFAULTS[key], version: NEVER_SAVED }
    : { value: settingsOf(row)[key], version: row.rowVersion };
}

/** A save of an interface setting: its key, its new value, and the version the screen showed. */
export type UiSettingChange<K extends UiSettingKey> = Readonly<{
  key: K;
  value: UiSettings[K];
  expectedVersion: number;
}>;

/**
 * Saves `change.value` as the interface setting `change.key`, in the caller's
 * transaction `tx`, when its version is still `change.expectedVersion`, the one the
 * screen showed, for every device (IHM-40, IHM-53, CL-IHM-13): a save sent with a stale
 * version is refused with the setting as it now stands (CL-IHM-18). Returns the version
 * now.
 */
export async function setUiSetting<K extends UiSettingKey>(
  tx: Transaction,
  change: UiSettingChange<K>,
): Promise<Result<Readonly<{ version: number }>, ChangedElsewhere<UiSetting<K>>>> {
  // The row of no save yet, so that one versioned update serves every save.
  await tx.insert(uiState).values({ id: ROW_ID, rowVersion: NEVER_SAVED }).onConflictDoNothing();
  const updated = await updateVersioned(tx, uiState, {
    where: OF_ROW,
    expectedVersion: change.expectedVersion,
    set: COLUMNS[change.key](change.value),
  });
  return updated.ok
    ? ok({ version: updated.value.rowVersion })
    : err(changedElsewhere(await getUiSetting(tx, change.key)));
}
