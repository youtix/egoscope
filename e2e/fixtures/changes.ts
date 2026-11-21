/**
 * The mark of a change that the watch of accessibility.ts keeps in the window of
 * each document: what sets it, inside the page, and the property that holds it.
 * CLAUDE.md, "The accessibility watch", lists the signals of a change.
 */

/**
 * The property of a document's window that marks the document, and no other, as
 * changed since the watch last checked it: unset until a check begins on the
 * document, a new one included, then false until the document changes again.
 */
export const CHANGED = '__egoscopeAccessibilityChanged';
// The events that change what a page shows while its DOM stays as it was: a form
// control's value, the top layer as a popover or a dialog opens or closes (the
// first of its two toggle events fires at once), and a move of the focus.
const CHANGE_EVENTS = ['input', 'change', 'beforetoggle', 'toggle', 'focusin', 'focusout'];

/** What the script that marks a document as changed needs: the mark, and the events it hears. */
type Marking = Readonly<{ key: string; events: readonly string[] }>;

/** What the watch gives markChanges: its mark, and the events of a change. */
export const MARKING: Marking = { key: CHANGED, events: CHANGE_EVENTS };

/**
 * Marks the document, once a check has begun on it, as changed at each change to
 * its DOM, at each event that `events` names and at each new address of its own,
 * a new fragment included, until a check clears the mark. Runs in the page: in
 * every new document, before the document's own scripts, and in the document that
 * a page shows when its watch begins.
 */
export function markChanges({ key, events }: Marking): void {
  const mark = (): void => {
    if (Reflect.get(globalThis, key) === false) {
      Reflect.set(globalThis, key, true);
    }
  };
  new MutationObserver(mark).observe(document, {
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  });
  for (const type of events) {
    document.addEventListener(type, mark, { capture: true });
  }
  globalThis.navigation.addEventListener('currententrychange', ({ from }) => {
    if (from.url !== globalThis.location.href) {
      mark();
    }
  });
}
