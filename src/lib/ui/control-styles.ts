/**
 * The classes of a text control: a border of 3:1 contrast that thickens in the
 * danger color when the field is invalid, a target a thumb hits comfortably, and
 * text of 1rem at least, below which iOS zooms into a focused field (IHM-60,
 * IHM-61).
 */
export const CONTROL_CLASSES =
  'block w-full min-h-touch rounded-lg border-2 border-line-strong bg-surface px-3 py-2 text-base text-ink aria-invalid:border-danger';
