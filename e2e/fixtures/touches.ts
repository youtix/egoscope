/**
 * Touches of a page that a test makes one step at a time: a finger that goes down
 * on a point, then lifts. Playwright's `touchscreen.tap` sends both steps to
 * Chromium at once and waits for both answers, and Chromium may never answer them
 * when the page leaves as it dispatches the touch, which stalls the test until it
 * times out. Here a step is over once Chromium answered it or once the document that
 * it touched is gone, and a test sends a step only once the one before is over. The
 * watch of accessibility.ts runs each step as raw input of the test, as it runs the
 * keys, clicks and taps of the page.
 */
import type { CDPSession, JSHandle, Page } from '@playwright/test';

/** The command that touches the page, or lifts the finger off it. */
const TOUCH = 'Input.dispatchTouchEvent';

/** What the watch of a page runs raw input of the test inside. */
type RawInput = <Result>(input: () => Promise<Result>) => Promise<Result>;

/** A point of the page's viewport, in CSS pixels. */
type Point = Readonly<{ x: number; y: number }>;

// The raw input of the watch of each watched page, and the session through which
// the test touches each page: the end of a touch goes where its start went.
const watched = new WeakMap<Page, RawInput>();
const sessions = new WeakMap<Page, Promise<CDPSession>>();

/** Has the touches of `page` run inside `raw`, the raw input of its watch, from now on. */
export function watchTouches(page: Page, raw: RawInput): void {
  watched.set(page, raw);
}

/** The session through which the test touches `page`. */
async function sessionOf(page: Page): Promise<CDPSession> {
  const known = sessions.get(page);
  if (known !== undefined) {
    return known;
  }
  const session = page.context().newCDPSession(page);
  sessions.set(page, session);
  return session;
}

/**
 * Settles once `touched` leaves: its window hears pagehide, or the call fails since
 * the document is gone already.
 */
async function departureOf(touched: JSHandle<Document>): Promise<void> {
  try {
    await touched.evaluate(
      async (read) =>
        new Promise((resolve) => {
          read.defaultView?.addEventListener('pagehide', resolve, { once: true });
        }),
    );
  } catch {
    // The document left before the call reached it, or as it ran.
  }
}

/**
 * Sends one step of a touch of `page` through `send`, inside the raw input of its
 * watch, and returns once Chromium answered it or the document that it touched is
 * gone, whichever comes first.
 */
async function step(page: Page, send: (session: CDPSession) => Promise<unknown>): Promise<void> {
  const around = watched.get(page);
  if (around === undefined) {
    throw new Error('Watch the page before touching it: pass it to accessibility.watch.');
  }
  const session = await sessionOf(page);
  await around(async () => {
    const touched = await page.evaluateHandle(() => globalThis.document);
    try {
      await Promise.race([departureOf(touched), send(session)]);
    } finally {
      await touched.dispose();
    }
  });
}

/** Puts a finger down on `point` of `page`, which fires touchstart there. */
export async function touchDown(page: Page, { x, y }: Point): Promise<void> {
  await step(page, async (session) =>
    session.send(TOUCH, { type: 'touchStart', touchPoints: [{ x, y }] }),
  );
}

/** Lifts the finger that `touchDown` put down on `page`, which fires touchend there. */
export async function touchUp(page: Page): Promise<void> {
  await step(page, async (session) => session.send(TOUCH, { type: 'touchEnd', touchPoints: [] }));
}
