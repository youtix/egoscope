import { serverUrl } from '../fixtures/hermetic-server';
import { expect, test } from '../fixtures/test';

// A Lot 2 screen, which this server serves and the Lot 1 server does not.
const LOT_2_SCREEN = '/alerts';
const NOT_FOUND = 404;
// What the session control answers once the cookie of the session is set.
const SESSION_OPENED = 204;
// An invented chat that writes to the fake bot.
const CHAT = { id: 4242, type: 'private' } as const;

test.describe('the Lot 2 hermetic server', () => {
  test('runs in the hermetic mode', async ({ request }) => {
    const response = await request.get('/api/test/ping');

    await expect(response).toBeOK();
    expect(await response.json()).toStrictEqual({ hermetic: true });
  });

  test('[IHM-16] serves a Lot 2 screen, inside the Lot 2 navigation', async ({ page }) => {
    const response = await page.goto(LOT_2_SCREEN);

    expect(response?.ok()).toBe(true);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Alerts');
    // Signed in, the Home entry also carries the number of items to do (IHM-20).
    await expect(page.getByRole('navigation').getByRole('link')).toHaveText([
      /^Home\b/,
      'Players',
      'Alerts',
      'Types',
      'More',
    ]);
  });

  test('[IHM-16] runs beside the Lot 1 server, which answers not found for the same screen', async ({
    request,
  }) => {
    // Every screen asks for a session first: one of the Lot 1 server, which the Lot 2
    // server's own does not open.
    const session = await request.post(`${serverUrl(1)}/api/test/session`);
    const response = await request.get(`${serverUrl(1)}${LOT_2_SCREEN}`, { maxRedirects: 0 });

    expect(session.status()).toBe(SESSION_OPENED);
    expect(response.status()).toBe(NOT_FOUND);
  });

  test('scripts the Lot 2 fakes, and answers what a control reads', async ({ request }) => {
    const delivered = await request.post('/api/test/fakes', {
      data: { control: 'telegram.deliver', chat: CHAT, text: 'Hi' },
    });
    const inbox = await request.post('/api/test/fakes', {
      data: { control: 'telegram.inbox', chat: CHAT.id },
    });

    await expect(delivered).toBeOK();
    expect(await delivered.json()).toMatchObject({
      ran: 'telegram.deliver',
      answer: { message: { chat: CHAT, text: 'Hi' } },
    });
    expect(await inbox.json()).toStrictEqual({ ran: 'telegram.inbox', answer: [] });
  });
});
