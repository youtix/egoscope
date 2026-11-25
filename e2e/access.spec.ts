import { expect, test } from './fixtures/test';

// The headers that every answer of the app carries (TRV-58, TRV-59, CL-TRV-13).
const SECURITY_HEADERS = {
  'content-security-policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-robots-tag': 'noindex, nofollow',
};

test.describe('the access to the app without a session', () => {
  test.use({ signedIn: false });

  test('[TRV-58] [CA-TRV-19] [IHM-05] [IHM-06] sends a device without a session from any screen to the login page, which asks for the password alone', async ({
    page,
  }) => {
    await page.goto('/rankings?season=2026');

    await expect(page).toHaveURL('/log-in?next=%2Frankings%3Fseason%3D2026');
    await expect(page.getByRole('heading', { level: 1, name: 'Log in' })).toBeVisible();
    await expect(page.getByLabel('Password')).toHaveAttribute('autocomplete', 'current-password');
    await expect(page.getByRole('button', { name: 'Show the password' })).toBeVisible();
  });

  test('[CL-TRV-13] [TRV-58] [CA-TRV-19] refuses every data request without a session', async ({
    request,
  }) => {
    const answers = await Promise.all(
      ['/api/health', '/api/exports/full'].map(async (path) =>
        request.get(path, { maxRedirects: 0 }),
      ),
    );

    expect(answers.map((answer) => answer.status())).toStrictEqual([401, 401]);
  });

  test('[TRV-58] [CL-TRV-13] asks search engines to index nothing', async ({ request }) => {
    const robots = await request.get('/robots.txt');

    expect(await robots.text()).toBe('User-Agent: *\nDisallow: /\n\n');
    expect(robots.headers()['x-robots-tag']).toBe('noindex, nofollow');
  });

  test('[TRV-58] [TRV-59] gives every answer the security headers, a redirect and a refusal included', async ({
    request,
  }) => {
    const answers = await Promise.all(
      ['/log-in', '/rankings', '/api/health'].map(async (path) =>
        request.get(path, { maxRedirects: 0 }),
      ),
    );

    expect(answers.map((answer) => answer.status())).toStrictEqual([200, 307, 401]);
    expect(answers.map((answer) => answer.headers())).toMatchObject([
      SECURITY_HEADERS,
      SECURITY_HEADERS,
      SECURITY_HEADERS,
    ]);
  });
});

test.describe('the login page of a device whose session is open', () => {
  test('[IHM-11] sends it on to the screen it asked for', async ({ page }) => {
    await page.goto('/log-in?next=%2F%3Fsection%3Dtoday');

    await expect(page).toHaveURL('/?section=today');
  });

  test.describe('with a next that leaves the app', () => {
    for (const next of ['https://other.example/', '//other.example/', '/log-in']) {
      test(`[IHM-10] [IHM-11] sends it Home rather than to ${next}`, async ({ page }) => {
        await page.goto(`/log-in?${new URLSearchParams({ next }).toString()}`);

        await expect(page).toHaveURL('/');
      });
    }
  });
});
