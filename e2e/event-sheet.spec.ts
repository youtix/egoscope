import { expect, test } from './fixtures/test';

// The first invented player, whom the profiled-player scenario follows with seven media
// storms, each in a measured case.
const PLAYER_ID = '0f6c2a4e-8b1d-4c3f-9a7e-5d2b1c0e9f01';
const PLAYER = 'Ansel Varga';

test.describe('the event page', () => {
  test.beforeEach(async ({ request }) => {
    const answer = await request.post('/api/test/seed', {
      data: { scenarios: ['profiled-player'] },
    });
    expect(answer.status(), 'The seed control refused the scenario').toBe(200);
  });

  test('[IHM-67] [CA-VUE-04] [IHM-22] opens a profiled player’s event from his page and shows its block, naming him alone', async ({
    page,
  }) => {
    await page.goto(`/players/${PLAYER_ID}`);
    await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();
    const listed = page.getByRole('listitem').filter({ hasText: 'Reference date' });
    await expect(listed).toHaveCount(7);

    await listed.first().getByRole('link', { name: 'Media storm' }).click();

    await expect(page).toHaveURL(/\/events\/\d+$/u);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Event page');
    await expect(page.getByText('Times in Paris time')).toBeVisible();
    await expect(page.getByRole('link', { name: PLAYER })).toHaveAttribute(
      'href',
      `/players/${PLAYER_ID}`,
    );
    await expect(page.getByRole('link', { name: 'Media storm' })).toHaveAttribute(
      'href',
      '/types/media-storm',
    );
    await expect(page.getByRole('link', { name: 'Measured' })).toHaveAttribute(
      'href',
      /^\/cases\/\d+$/u,
    );
    await expect(page.getByRole('link', { name: 'Withdraw and erase this event' })).toBeVisible();
  });
});
