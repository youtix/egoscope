import { expect, test } from './fixtures/test';

import type { APIRequestContext } from '@playwright/test';

// The scenario of the statistics and sensitivity world that writes a case of every
// status, among them a historical case excluded for the high stakes of its game.
const EVERY_STATUS = 'player-with-cases-of-every-status';
// How many case numbers the search reads: the world writes eleven cases, and the other
// specs of the lot may write theirs first on the same server.
const CASES_SEARCHED = 60;
// The largest integer identifier, which no case of a fresh server reaches (CL-IHM-19).
const LARGEST_IDENTIFIER = 2_147_483_647;
const GAP_DEFINITION =
  "How far the measured game's performance index is from the season mean, in season standard deviations.";

/**
 * The number of the seeded case excluded for the high stakes of its game, read from the
 * case pages themselves, since no control of the hermetic server gives the identifiers
 * that a scenario wrote.
 */
async function excludedCaseNumber(request: APIRequestContext): Promise<number> {
  const numbers = Array.from({ length: CASES_SEARCHED }, (_, index) => index + 1);
  const pages = await Promise.all(
    numbers.map(async (number) => {
      const response = await request.get(`/cases/${String(number)}`);
      return response.text();
    }),
  );
  const found = numbers.find(
    (_, index) =>
      pages[index]?.includes('Excluded (doubtful case)') === true &&
      pages[index].includes('Game stakes: High'),
  );
  if (found === undefined) {
    throw new Error('The seeded world holds no case excluded for its game stakes.');
  }
  return found;
}

test.describe('the case detail', () => {
  test('[IHM-25] [IHM-46] [IHM-52] [SEN-18] [CL-SEN-11] shows a seeded excluded case with its origin, its gap, its context and its criterion', async ({
    page,
  }) => {
    const seeded = await page.request.post('/api/test/seed', {
      data: { scenarios: [EVERY_STATUS] },
    });
    expect(seeded.ok()).toBe(true);
    const caseNumber = await excludedCaseNumber(page.request);

    await page.goto(`/cases/${String(caseNumber)}`);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Case detail');
    await expect(page.getByText('Times in Paris time')).toBeVisible();
    await expect(page.getByText('Historical', { exact: true })).toBeVisible();
    await expect(page.getByText('Excluded (doubtful case)')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Criteria met' })).toBeVisible();
    await expect(page.getByText('Game stakes: High')).toBeVisible();
    await expect(page.getByText('Research', { exact: true }).first()).toBeVisible();
    await expect(
      page.getByText(
        'The stats source does not report ejections, so an ejection is flagged only if you notice it.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open the event' })).toBeVisible();

    await page.getByRole('button', { name: 'Gap' }).click();

    await expect(page.getByText(GAP_DEFINITION)).toBeVisible();
  });

  test('[CL-IHM-19] says that an item no longer exists for a case number that names no case', async ({
    page,
  }) => {
    await page.goto(`/cases/${String(LARGEST_IDENTIFIER)}`);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('This item no longer exists');
    await expect(page.getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/');
  });
});
