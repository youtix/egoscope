import { expect, test } from './fixtures/test';

test.describe('the hermetic server', () => {
  test('answers on the health route, or sends a request without a session to the log-in page', async ({
    request,
  }) => {
    const response = await request.get('/api/health');

    await expect(response).toBeOK();
    expect(new URL(response.url()).pathname).toMatch(/^\/(?:api\/health|log-in)$/u);
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
