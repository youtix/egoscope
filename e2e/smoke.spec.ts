import { expect, test } from './fixtures/test';

test.describe('the hermetic server', () => {
  test('[CL-TRV-13] refuses the health route to a request without a session', async ({
    request,
  }) => {
    const response = await request.get('/api/health', { maxRedirects: 0 });

    expect(response.status()).toBe(401);
  });

  test('sends the root address to the login page without a session, through pages that pass the accessibility check', async ({
    page,
  }) => {
    await page.goto('/');

    await expect(page).toHaveURL('/log-in?next=%2F');
  });

  test('runs in the hermetic mode', async ({ request }) => {
    const response = await request.get('/api/test/ping');

    await expect(response).toBeOK();
    expect(await response.json()).toStrictEqual({ hermetic: true });
  });
});
