import { expect, test } from './fixtures/test';

// The reminder of IHM-55 that no backtest can be requested without a validated type (BKT-02).
const NO_REQUEST_POSSIBLE =
  'To request a backtest, first validate an event type that research can look for. Types derived from the calendar need no backtest.';
// The one-sentence definition of the dating rule (glossary section 7.7).
const DATING_RULE_DEFINITION =
  'The part of a type sheet that says how an event of the type gets its reference date, and whether its events are known in advance.';
const CANDIDATE_TYPE_COUNT = 9;

test.describe('Types', () => {
  // The first start: the reference data alone, the nine candidate types, before any scenario.
  test.beforeEach(async ({ request }) => {
    const answer = await request.post('/api/test/seed', { data: { scenarios: [] } });
    expect(answer.ok()).toBe(true);
  });

  test('[CA-TAX-03] [IHM-55] lists the nine candidate types as proposals of origin scoping on a first start, with no validated type', async ({
    page,
  }) => {
    await page.goto('/types');

    await expect(page.getByRole('heading', { level: 1, name: 'Types' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'no validated type' })).toBeVisible();
    await expect(page.getByText(NO_REQUEST_POSSIBLE)).toBeVisible();
    const proposed = page.getByRole('region', { name: 'Proposed' });
    await expect(proposed.getByText('9 types')).toBeVisible();
    await expect(proposed.getByRole('listitem')).toHaveCount(CANDIDATE_TYPE_COUNT);
    await expect(proposed.getByRole('definition').filter({ hasText: 'Scoping' })).toHaveCount(
      CANDIDATE_TYPE_COUNT,
    );
    await expect(
      page.getByRole('region', { name: 'Validated' }).getByText('0 types'),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Merge' })).toHaveCount(0);
  });

  test('[IHM-31] [CL-TAX-20] marks the two calendar-derived types and opens the definition of their dating rule', async ({
    page,
  }) => {
    await page.goto('/types');

    await expect(
      page.getByRole('definition').filter({ hasText: 'derived from the calendar' }),
    ).toHaveCount(2);
    await page.getByRole('button', { name: 'Dating rule' }).click();

    await expect(page.getByText(DATING_RULE_DEFINITION)).toBeVisible();
  });

  test('[IHM-31] opens the sheet of a type from its name', async ({ page }) => {
    await page.goto('/types');

    await page.getByRole('link', { name: 'Media storm' }).click();

    await expect(page).toHaveURL(/\/types\/media-storm$/u);
    await expect(page.getByRole('heading', { level: 1, name: 'Type sheet' })).toBeVisible();
  });

  test('[IHM-31] opens the exploration from "Explore new types"', async ({ page }) => {
    await page.goto('/types');

    await page.getByRole('link', { name: 'Explore new types' }).click();

    await expect(page).toHaveURL(/\/types\/explore$/u);
    await expect(page.getByRole('heading', { level: 1, name: 'Explore new types' })).toBeVisible();
  });
});
