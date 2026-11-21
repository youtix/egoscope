/** What became of a copy: the text is on the clipboard, or the phone refused it. */
export type CopyOutcome = 'copied' | 'refused';

/**
 * Puts `text` on the clipboard, without any selection by hand (IHM-39), unless
 * the phone refuses, or offers no clipboard to the page.
 */
export async function copyToClipboard(text: string): Promise<CopyOutcome> {
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'refused';
  }
}

/**
 * The text on the clipboard, which a paste button inserts where the phone allows
 * it (IHM-28); nothing when the phone refuses, or offers no clipboard to the page.
 */
export async function readFromClipboard(): Promise<string | undefined> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return undefined;
  }
}

/**
 * Selects the whole text of the element whose identifier is `id`, for the owner
 * to copy by a long press when the clipboard is refused (edge case « Presse-papiers
 * inaccessible »).
 */
export function selectContents(id: string): void {
  const element = document.querySelector(`#${CSS.escape(id)}`);
  if (element !== null) {
    globalThis.getSelection()?.selectAllChildren(element);
  }
}
