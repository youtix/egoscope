import { expect, test } from './fixtures/test';

test.describe('the hermetic server', () => {
  test('[CL-TRV-13] refuses the health route to a request without a session', async ({
    request,
  }) => {
    const response = await request.get('/api/health', { maxRedirects: 0 });

    expect(response.status()).toBe(401);
  });

  test('renders the page reached from the root address, which passes the accessibility check', async ({
    page,
  }) => {
    const response = await page.goto('/');

    expect(response?.ok()).toBe(true);
    await expect(page).toHaveTitle(/Egoscope/u);
  });

  test('runs in the hermetic mode', async ({ request }) => {
    const response = await request.get('/api/test/ping');

    await expect(response).toBeOK();
    expect(await response.json()).toStrictEqual({ hermetic: true });
  });
});
