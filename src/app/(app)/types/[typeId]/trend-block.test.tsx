import { render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';

import { getTrend } from '@/lib/sensitivity';
import { toEpochMs } from '@/lib/time';
import { assertNoBettingWords, definition } from '@/lib/wording';

import { TrendBlock } from './trend-block';

import type { TrendDetail } from '@/lib/sensitivity';

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock(import('@/lib/db'), async (importOriginal) => ({ ...(await importOriginal()), getDb }));
vi.mock(import('@/lib/sensitivity'), () => ({ getTrend: vi.fn() }));

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

// The connection that the block reads through.
const DB = Object.freeze({ kind: 'the connection of the request' });

const TYPE_ID = 'media-storm';

// The worked example of 08: 63 valid cases of 11 players, a possible increase.
const VALID_CASES = 63;
const DISTINCT_PLAYERS = 11;

/** A trend as `getTrend` reads it: a possible increase on 63 valid cases of 11 players, not archived. */
function trendOf(overrides: Partial<TrendDetail> = {}): TrendDetail {
  const tally = {
    eventCount: 70,
    caseCount: 70,
    groupedEventCount: 0,
    awaitingCount: 0,
    validCount: VALID_CASES,
    excludedCount: 7,
    manuallyExcludedCount: 0,
    notMeasurableCount: 0,
    coOccurringCount: 0,
    provisionalGapCount: 0,
    historicalValidCount: VALID_CASES,
    trackedValidCount: 0,
    lowResearchConfidenceCount: 0,
    aboveZeroCount: 40,
    belowZeroCount: 23,
  };
  const gaps = {
    meanGap: 0.31,
    gapDispersion: 1.12,
    retainedDispersion: 1.12,
    expectedNoise: 0.141,
    signalToNoise: 2.2,
    rangeLow: 0.03,
    rangeHigh: 0.59,
  };
  return {
    id: 1,
    eventTypeId: TYPE_ID,
    values: {
      view: 'all_cases',
      tally,
      reasons: { awaitingGame: {}, notMeasurable: {}, excluded: {} },
      exits: {},
      gaps,
      verdict: { level: 'possible', direction: 'increase' },
      isFragile: false,
      profileConfidence: 'medium',
      confidenceStepDownReasons: [],
      control: {
        caseCount: 0,
        meanGap: null,
        rangeLow: null,
        rangeHigh: null,
        verdict: { level: 'inconclusive', direction: null },
      },
      dependsOnManualExclusions: false,
      validCaseThreshold: 5,
      computedAt: toEpochMs(Date.UTC(2026, 10, 20, 8, 15)),
    },
    distinctPlayerCount: DISTINCT_PLAYERS,
    topContributorValidCount: 9,
    earlierVersionCaseCount: 0,
    notices: [],
    warnings: [],
    casesWithoutWhichVerdictChanges: [],
    lastCalculationChange: null,
    ...overrides,
  };
}

/** Renders the block of the type, whose trend is `trend`, or none. */
async function renderBlock(trend: TrendDetail | null) {
  getDb.mockResolvedValue({ ok: true, db: DB });
  vi.mocked(getTrend).mockResolvedValue(trend);
  return render(await TrendBlock({ typeId: TYPE_ID }));
}

describe('TrendBlock', () => {
  it("[IHM-31] [SEN-38] summarizes the type's trend: its verdict with its valid cases and its confidence", async () => {
    await renderBlock(trendOf());

    expect(screen.getByRole('heading', { level: 2, name: 'General trend' })).toBeVisible();
    expect(screen.getByText('possible, increase')).toBeVisible();
    expect(screen.getByText('63 valid cases')).toBeVisible();
    expect(screen.getByText('Medium')).toBeVisible();
    expect(screen.queryByText('Archived')).not.toBeInTheDocument();
  });

  it('[SEN-28] shows the distinct players of the type, read in the default view of that type', async () => {
    await renderBlock(trendOf());

    expect(screen.getByText('Players')).toBeVisible();
    expect(screen.getByText('11')).toBeVisible();
    expect(getTrend).toHaveBeenCalledExactlyOnceWith(DB, { eventTypeId: TYPE_ID });
  });

  it('[SEN-29] writes an inconclusive trend and a low confidence as the trend holds them', async () => {
    const { values } = trendOf();
    await renderBlock(
      trendOf({
        values: {
          ...values,
          verdict: { level: 'inconclusive', direction: null },
          profileConfidence: 'low',
          tally: { ...values.tally, validCount: 1 },
        },
        distinctPlayerCount: 1,
      }),
    );

    expect(screen.getByText('inconclusive')).toBeVisible();
    expect(screen.getByText('Low')).toBeVisible();
    expect(screen.getByText('1 valid case')).toBeVisible();
  });

  it('[SEN-30] accompanies the trend with the reminder that it describes all observed players', async () => {
    await renderBlock(trendOf());

    expect(
      screen.getByText('The general trend describes all observed players, not any one of them.'),
    ).toBeVisible();
  });

  it('[IHM-31] links to the trend screen of the type', async () => {
    await renderBlock(trendOf());

    expect(screen.getByRole('link', { name: 'Open the general trend' })).toHaveAttribute(
      'href',
      '/types/media-storm/trend',
    );
  });

  it('[SEN-19] [IHM-31] marks the trend of a withdrawn type as archived, in words', async () => {
    await renderBlock(trendOf({ notices: ['archived'] }));

    expect(screen.getByText('Archived')).toBeVisible();
    expect(screen.getByText('possible, increase')).toBeVisible();
  });

  it('[IHM-56] shows why a type without any case has no trend, and the backtest that fills it', async () => {
    await renderBlock(null);

    expect(screen.getByRole('heading', { level: 2, name: 'General trend' })).toBeVisible();
    expect(
      screen.getByRole('heading', { level: 3, name: 'No case for this type yet' }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "No event of this type has been found yet, so there is no case and no trend. A backtest looks for a player's past events.",
      ),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Request a backtest' })).toHaveAttribute(
      'href',
      '/backtests',
    );
    expect(screen.queryByRole('link', { name: 'Open the general trend' })).not.toBeInTheDocument();
  });

  it('[IHM-15] gives the general trend, the verdict and the profile confidence their definitions at their first label', async () => {
    await renderBlock(trendOf());

    const heading = screen.getByRole('heading', { level: 2 });
    expect(within(heading).getByRole('button', { name: 'General trend' })).toBeVisible();
    expect(screen.getByText(definition('generalTrend').text)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verdict' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Profile confidence' })).toBeVisible();
  });

  it('[IHM-31] fails, for the error screen to show, when the database cannot be reached', async () => {
    getDb.mockResolvedValue({ ok: false, error: { kind: 'database-not-configured' } });

    await expect(TrendBlock({ typeId: TYPE_ID })).rejects.toThrow(
      'The general trend cannot be read: database-not-configured.',
    );
    expect(getTrend).not.toHaveBeenCalled();
  });

  it.each([
    ['a trend', trendOf()],
    ['an archived trend', trendOf({ notices: ['archived'] })],
    ['a type without any case', null],
  ])(
    '[IHM-50] [IHM-61] shows no betting word and no accessibility violation for %s',
    async (_name, trend) => {
      const { container } = await renderBlock(trend);

      assertNoBettingWords(container.textContent);
      await expect(axe.run(container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
    },
  );
});
