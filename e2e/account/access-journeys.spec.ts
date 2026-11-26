// The journeys that change the account of their own server (playwright.config.ts, the
// account project): its first login and the choice of its password, a lockout, an
// expired session. They run in this order, one after another, each going on from the
// account that the one before left.
import { devices } from '@playwright/test';

import { TEST_ACCOUNT_INITIAL } from '../fixtures/hermetic-server';
import { expect, test } from '../fixtures/test';

import type { APIRequestContext, Page } from '@playwright/test';

// The password that the owner chooses at the first login, and two that the app refuses.
const OWNER_CHOICE = 'chosen-at-the-first-login-of-the-owner';
const TOO_SHORT = 'eleven-char';
const WRONG = 'a-guess-of-a-stranger';
// Monday 7 January 2030, 10:00 Paris time, when the server and the browser stand
// still for the lockout; and the next day, 10:00, for the expiry.
const MONDAY = '2030-01-07T09:00:00Z';
const TUESDAY = '2030-01-08T09:00:00Z';
const LOCKOUT_MS = 15 * 60_000;
const WRONG_ATTEMPTS = 5;
const IDLE_LIMIT_MS = 31 * 24 * 3_600_000;
// A draft that a device keeps between two sessions (IHM-11).
const DRAFT = 'A pasted research text, not sent yet';
const PHONE = { ...devices['Pixel 7'], colorScheme: 'dark' } as const;

/** Sets the server's clock with `command`: `{ at }`, `{ advanceMs }` or `{ release }`. */
async function clock(request: APIRequestContext, command: Readonly<Record<string, unknown>>) {
  const answer = await request.post('/api/test/clock', { data: command });
  expect(answer.status(), 'The clock control refused the command').toBe(200);
}

/** Logs in from the login page that `page` shows, by typing `password` and pressing Enter. */
async function logIn(page: Page, password: string): Promise<void> {
  await page.getByLabel('Password').fill(password);
  await page.getByLabel('Password').press('Enter');
}

/**
 * Types a wrong password `times` times on the login page that `page` shows, each
 * attempt answered, its error summary focused, before the next.
 */
async function wrongTimes(page: Page, times: number): Promise<void> {
  const summary = page.getByRole('alert', { name: 'You are not logged in' });
  await logIn(page, WRONG);
  await expect(summary).toBeFocused();
  await expect(summary).toContainText('This password is wrong: type it again.');
  return times > 1 ? wrongTimes(page, times - 1) : undefined;
}

/** The addresses that `page` asks for, every redirect included, kept as it goes. */
function addressesOf(page: Page): readonly string[] {
  const asked: string[] = [];
  page.on('request', (sent) => {
    asked.push(sent.url());
  });
  return asked;
}

/** The token of the session cookie that `page`'s browser holds, if any. */
async function tokenOf(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const session = cookies.find(({ name }) => name === '__Host-egoscope-session');
  return session?.value.split('.', 1)[0] ?? '';
}

test.describe('the account journeys', () => {
  test('[TRV-57] [IHM-06] [CA-TRV-30] [CA-IHM-19] [IHM-08] [IHM-10] [IHM-11] opens on the initial password only "Choose your password", then the screen asked for, and has the other device erase its data', async ({
    page,
    browser,
    baseURL,
    accessibility,
  }) => {
    const phoneContext = await browser.newContext({
      ...PHONE,
      ...(baseURL !== undefined && { baseURL }),
    });
    const phone = await phoneContext.newPage();
    await accessibility.watch(phone);
    const asked = [addressesOf(page), addressesOf(phone)];

    await phone.goto('/');
    await expect(phone).toHaveURL('/log-in?next=%2F');
    await logIn(phone, TEST_ACCOUNT_INITIAL);
    await expect(phone).toHaveURL('/choose-password?next=%2F');
    await phone.evaluate((draft) => {
      localStorage.setItem('draft', draft);
    }, DRAFT);
    const phoneToken = await tokenOf(phone);

    await page.goto('/');
    await logIn(page, TEST_ACCOUNT_INITIAL);
    await expect(page).toHaveURL('/choose-password?next=%2F');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Choose your password' }),
    ).toBeVisible();
    await page.getByLabel('New password').fill(TOO_SHORT);
    await page.getByRole('button', { name: 'Save the password' }).click();
    await expect(page.getByRole('alert', { name: 'Your password was not saved' })).toContainText(
      'This password is too short: use at least 12 characters.',
    );
    await page.getByLabel('New password').fill(OWNER_CHOICE);
    await page.getByRole('button', { name: 'Save the password' }).click();
    await expect(page).toHaveURL('/');
    const pageToken = await tokenOf(page);

    await phone.reload();
    await expect(phone).toHaveURL('/log-in?next=%2F&ended=password_changed');
    await expect(phone.getByRole('status').filter({ hasText: 'Password changed' })).toBeVisible();
    expect(await phone.evaluate(() => localStorage.length)).toBe(0);
    await phoneContext.close();

    const addresses = asked.flat().join('\n');
    for (const secret of [TEST_ACCOUNT_INITIAL, OWNER_CHOICE, TOO_SHORT, phoneToken, pageToken]) {
      expect(secret).not.toBe('');
      expect(addresses).not.toContain(secret);
    }
  });

  test('[TRV-61] [IHM-07] [CA-TRV-20] [CA-IHM-03] says until when logins are locked after five wrong passwords, refuses the right one meanwhile, and lets the owner in once the lockout ends', async ({
    page,
    request,
    accessibility,
  }) => {
    await clock(request, { at: MONDAY });
    await page.clock.install({ time: MONDAY });
    const earlier = await page.context().newPage();
    await accessibility.watch(earlier);
    await earlier.goto('/log-in?next=%2F');
    await page.goto('/log-in?next=%2F');
    const notice = 'Login locked until Monday 7 January 2030, 10:15 Paris time';

    await wrongTimes(page, WRONG_ATTEMPTS);
    await expect(page.getByText(notice)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log in' })).toBeDisabled();
    const sent = addressesOf(page);
    await logIn(page, OWNER_CHOICE);

    await logIn(earlier, OWNER_CHOICE);
    await expect(earlier.getByText(notice)).toBeVisible();
    await expect(earlier).toHaveURL('/log-in?next=%2F');
    expect(sent).toStrictEqual([]);

    await clock(request, { advanceMs: LOCKOUT_MS });
    await page.clock.fastForward(LOCKOUT_MS);
    await expect(page.getByRole('button', { name: 'Log in' })).toBeEnabled();
    await expect(page.getByText(notice)).toBeHidden();
    await logIn(page, OWNER_CHOICE);
    await expect(page).toHaveURL('/');
  });

  test('[IHM-11] [TRV-62] leads a device whose session expired to the login page, keeps its data, and returns it to the screen it asked for', async ({
    page,
    request,
  }) => {
    await clock(request, { at: TUESDAY });
    await page.goto('/log-in?next=%2F%3Fsection%3Dtoday');
    await logIn(page, OWNER_CHOICE);
    await expect(page).toHaveURL('/?section=today');
    await page.evaluate((draft) => {
      localStorage.setItem('draft', draft);
    }, DRAFT);

    await clock(request, { advanceMs: IDLE_LIMIT_MS });
    await page.goto('/log-in?next=%2F%3Fsection%3Dtoday');

    await expect(page).toHaveURL('/log-in?next=%2F%3Fsection%3Dtoday&ended=expired');
    await expect(page.getByRole('status').filter({ hasText: 'Session expired' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('draft'))).toBe(DRAFT);
    await logIn(page, OWNER_CHOICE);
    await expect(page).toHaveURL('/?section=today');
  });
});
