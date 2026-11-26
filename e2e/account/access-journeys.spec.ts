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
// The step of the login page that has a device erase its data (IHM-08), and the addresses of
// the login page once a device has been told how its session ended, which anyone can write.
const ERASE_STEP = '/log-in/erase';
const TOLD_PASSWORD_CHANGED = '/log-in?next=%2F&ended=password_changed';
const TOLD_EXPIRED = '/log-in?next=%2F%3Fsection%3Dtoday&ended=expired';

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

/** How many times `asked` holds the step of the login page that erases the device's data. */
function erasures(asked: readonly string[]): number {
  return asked.filter((address) => new URL(address).pathname === ERASE_STEP).length;
}

/** The token of the session cookie that `page`'s browser holds, if any. */
async function tokenOf(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const session = cookies.find(({ name }) => name === '__Host-egoscope-session');
  return session?.value.split('.', 1)[0] ?? '';
}

test.describe('the account journeys', () => {
  test('[TRV-57] [IHM-06] [CA-TRV-30] [CA-IHM-19] [IHM-08] [IHM-10] [IHM-11] [TRV-62] [CL-IHM-10] [CL-TRV-05] opens on the initial password only "Choose your password", then the screen asked for, and has the other devices erase their data, even one that opens the address of the ending or sends a login form left open', async ({
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
    const tabletContext = await browser.newContext(baseURL === undefined ? {} : { baseURL });
    const tablet = await tabletContext.newPage();
    await accessibility.watch(tablet);
    const tabletAsked = addressesOf(tablet);
    const asked = [addressesOf(page), addressesOf(phone), tabletAsked];

    await phone.goto('/');
    await expect(phone).toHaveURL('/log-in?next=%2F');
    await logIn(phone, TEST_ACCOUNT_INITIAL);
    await expect(phone).toHaveURL('/choose-password?next=%2F');
    await phone.evaluate((draft) => {
      localStorage.setItem('draft', draft);
    }, DRAFT);
    const phoneToken = await tokenOf(phone);
    await tablet.goto('/');
    await logIn(tablet, TEST_ACCOUNT_INITIAL);
    await expect(tablet).toHaveURL('/choose-password?next=%2F');
    await tablet.evaluate((draft) => {
      localStorage.setItem('draft', draft);
    }, DRAFT);
    const tabletToken = await tokenOf(tablet);
    // The laptop: a login form left open while it had no session, then a login in another tab.
    const laptopContext = await browser.newContext(baseURL === undefined ? {} : { baseURL });
    const oldForm = await laptopContext.newPage();
    await accessibility.watch(oldForm);
    const laptop = await laptopContext.newPage();
    await accessibility.watch(laptop);
    const oldFormAsked = addressesOf(oldForm);
    asked.push(oldFormAsked, addressesOf(laptop));
    await oldForm.goto('/log-in?next=%2F');
    await expect(oldForm).toHaveURL('/log-in?next=%2F');
    await expect(oldForm.getByLabel('Password')).toBeVisible();
    await laptop.goto('/');
    await logIn(laptop, TEST_ACCOUNT_INITIAL);
    await expect(laptop).toHaveURL('/choose-password?next=%2F');
    await laptop.evaluate((draft) => {
      localStorage.setItem('draft', draft);
    }, DRAFT);
    const laptopToken = await tokenOf(laptop);

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

    await tablet.goto(TOLD_PASSWORD_CHANGED);
    await expect(tablet).toHaveURL(TOLD_PASSWORD_CHANGED);
    await expect(tablet.getByRole('status').filter({ hasText: 'Password changed' })).toBeVisible();
    expect(await tablet.evaluate(() => localStorage.length)).toBe(0);
    expect(await tokenOf(tablet)).toBe('');
    expect(erasures(tabletAsked)).toBe(1);
    await logIn(tablet, OWNER_CHOICE);
    await expect(tablet).toHaveURL('/');
    expect(erasures(tabletAsked)).toBe(1);
    await tabletContext.close();

    await logIn(oldForm, OWNER_CHOICE);
    await expect(oldForm).toHaveURL(TOLD_PASSWORD_CHANGED);
    await expect(oldForm.getByRole('status').filter({ hasText: 'Password changed' })).toBeVisible();
    expect(await oldForm.evaluate(() => localStorage.length)).toBe(0);
    expect(await tokenOf(oldForm)).toBe('');
    expect(erasures(oldFormAsked)).toBe(1);
    await logIn(oldForm, OWNER_CHOICE);
    await expect(oldForm).toHaveURL('/');
    expect(erasures(oldFormAsked)).toBe(1);
    await laptopContext.close();

    const addresses = asked.flat().join('\n');
    for (const secret of [
      TEST_ACCOUNT_INITIAL,
      OWNER_CHOICE,
      TOO_SHORT,
      phoneToken,
      pageToken,
      tabletToken,
      laptopToken,
    ]) {
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

  test('[IHM-11] [TRV-62] [IHM-08] leads a device whose session expired to the login page, keeps its data and its cookie, stays there when it opens that page again, and returns it to the screen it asked for', async ({
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
    const token = await tokenOf(page);

    await clock(request, { advanceMs: IDLE_LIMIT_MS });
    await page.goto('/log-in?next=%2F%3Fsection%3Dtoday');

    await expect(page).toHaveURL(TOLD_EXPIRED);
    await expect(page.getByRole('status').filter({ hasText: 'Session expired' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('draft'))).toBe(DRAFT);
    expect(token).not.toBe('');
    expect(await tokenOf(page)).toBe(token);

    const asked = addressesOf(page);
    await page.reload();
    await expect(page).toHaveURL(TOLD_EXPIRED);
    await expect(page.getByLabel('Password')).toBeVisible();
    expect(erasures(asked)).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem('draft'))).toBe(DRAFT);
    await logIn(page, OWNER_CHOICE);
    await expect(page).toHaveURL('/?section=today');
  });
});
