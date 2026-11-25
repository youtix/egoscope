// What a draft's text may hold, a rule that the device and the server share (DSN-32).

// The one character that a Postgres `text` cannot hold.
const NUL = '\0';

/**
 * Says whether the server can keep `text` as a draft's server copy: a text holding a NUL
 * character, which the database cannot store, stays on the device alone (IHM-42, DSN-32).
 */
export function canStoreText(text: string): boolean {
  return !text.includes(NUL);
}
