/**
 * Who began the departure of a document that raw input of the test acted on
 * before any check: the test, or the app. The watch of accessibility.ts reports
 * such a document, left unchecked, only when the test left it; CLAUDE.md, "The
 * accessibility watch", says when that is.
 */
import type { Page } from '@playwright/test';

/**
 * The property of a document's window that holds the stamp that the watch gave
 * the document, before raw input of the test acted on it, so that the document
 * can name itself as it leaves.
 */
export const STAMP = '__egoscopeAccessibilityStamp';
// The function of the page through which a document gives the watch its stamp as
// a departure that raw input of the test began begins.
const BINDING = '__egoscopeAccessibilityLeftByInput';
// The events of raw keyboard, mouse and touch input, and those that the browser
// fires in response to them, a handler of which can leave the page at once.
const INPUT_EVENTS = [
  'keydown',
  'keypress',
  'keyup',
  'pointerdown',
  'pointerup',
  'mousedown',
  'mouseup',
  'click',
  'dblclick',
  'auxclick',
  'contextmenu',
  'touchstart',
  'touchend',
  'beforeinput',
  'input',
  'change',
  'submit',
];

/** What the script that tells the watch of the test's departures needs. */
type Telling = Readonly<{ stamp: string; binding: string; events: readonly string[] }>;

/**
 * Gives the watch, through `binding`, the stamp of the document as a departure
 * of it begins that raw input of the test began: one that begins while the
 * browser itself dispatches one of `events`, in a handler of the event; one that
 * the browser begins in response to the input, which it marks as the user's, as it
 * follows a link at once or submits a form a task later; or that of a form that a
 * handler of the input submitted, a task later. A move within the document and a
 * download leave it in place. Runs in the page: in every new document, before its
 * own scripts, and in the one that the page shows when its watch begins.
 */
function tellDepartures({ stamp, binding, events }: Telling): void {
  // The events that the browser may still be dispatching (each new one drops those
  // that it has finished), and those that it began to dispatch by itself, while no
  // script ran.
  let dispatched: readonly Event[] = [];
  const byBrowser = new WeakSet<Event>();
  // The forms, and their submitters, that a handler of the input submitted.
  const submitted = new WeakSet<EventTarget>();
  const isInputDispatched = (): boolean =>
    dispatched.some((event) => event.eventPhase !== Event.NONE && byBrowser.has(event));
  const note = (event: Event): void => {
    if (event instanceof SubmitEvent && isInputDispatched()) {
      for (const target of [event.target, event.submitter]) {
        if (target !== null) {
          submitted.add(target);
        }
      }
    }
    dispatched = [...dispatched.filter((known) => known.eventPhase !== Event.NONE), event];
    // This listener is the event's first. Its microtask runs before the next
    // listener only when no script is on the stack below the event, which is the
    // case when the browser dispatches the event by itself.
    queueMicrotask(() => {
      if (event.eventPhase !== Event.NONE) {
        byBrowser.add(event);
      }
    });
  };
  for (const type of events) {
    addEventListener(type, note, { capture: true, passive: true });
  }
  navigation.addEventListener('navigate', (event) => {
    const isDeparture = !event.destination.sameDocument && event.downloadRequest === null;
    const source = event.sourceElement;
    const isByInput =
      event.userInitiated || isInputDispatched() || (source !== null && submitted.has(source));
    const tell: unknown = Reflect.get(globalThis, binding);
    if (isDeparture && isByInput && typeof tell === 'function') {
      Reflect.apply(tell, globalThis, [Reflect.get(globalThis, stamp)]);
    }
  });
}

/**
 * Watches who leaves the documents that `page` shows, from now on. Returns the
 * stamps of the documents whose departure raw input of the test began, which
 * grows as they leave.
 */
export async function watchDepartures(page: Page): Promise<ReadonlySet<number>> {
  const leftByInput = new Set<number>();
  await page.exposeBinding(BINDING, (_source, stamp: unknown) => {
    // A document that the watch never stamped gives no number.
    if (typeof stamp === 'number') {
      leftByInput.add(stamp);
    }
  });
  const telling: Telling = { stamp: STAMP, binding: BINDING, events: INPUT_EVENTS };
  await page.addInitScript(tellDepartures, telling);
  try {
    // The document that the page shows already, a popup's for one, runs no init script.
    await page.evaluate(tellDepartures, telling);
  } catch {
    // The page closed or moved on meanwhile: its next document runs the init script.
  }
  return leftByInput;
}
