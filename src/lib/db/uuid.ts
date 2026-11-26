// The shape of a uuid as Postgres writes it: five hyphen-separated groups of hex digits. The
// version digit is not checked, since Postgres accepts any.
const UUID_PATTERN = /^[\da-f]{8,9}-[\da-f]{4,5}-[\da-f]{3,4}-[\da-f]{4,5}-[\da-f]{12}$/iu;

/**
 * Whether `text` is a value that Postgres accepts for a `uuid` column, so that a query can skip a
 * malformed one instead of letting Postgres throw when it compares the text with the column. A
 * followed player's identifier is a random uuid (CL-JOU-09), so a text that is none names no
 * player, whether it comes from an address or from a correction (DET-47).
 */
export function isUuid(text: string): boolean {
  return UUID_PATTERN.test(text);
}
