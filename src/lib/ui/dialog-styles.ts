/** What dims the page behind a dialog. */
export const BACKDROP_CLASSES = 'fixed inset-0 bg-scrim/50';

/**
 * A dialog's panel: a sheet along the bottom edge on a phone, where a thumb
 * reaches it, and a centered panel on a wide screen. It scrolls inside when its
 * content is taller than the screen, in portrait as in landscape (IHM-01, IHM-63).
 */
export const POPUP_CLASSES =
  'fixed inset-x-0 bottom-0 flex max-h-[90dvh] flex-col gap-4 overflow-y-auto rounded-t-2xl border border-line bg-surface p-6 text-ink shadow-lg sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-[calc(100%-2rem)] sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl';

export const TITLE_CLASSES = 'text-xl font-semibold leading-snug';

/** The row of a dialog's actions, which wrap on a narrow screen. */
export const ACTIONS_CLASSES = 'flex flex-wrap justify-end gap-3';
