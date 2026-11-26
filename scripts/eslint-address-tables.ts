/**
 * The address tables of the link check, for which eslint.config.ts turns
 * `sonarjs/no-hardcoded-ip` off, and eslint-address-tables.test.ts probes both sides of
 * that line. The rule refuses every IP literal, so that no address of a host is written
 * into the code; these two files list the addresses and blocks that the link check
 * judges, which it never contacts (coordinator decision). Every other file keeps the
 * rule, the other files of the link check and their tests included.
 */

/** The files whose IP literals are data that the link check judges and never contacts. */
export const ADDRESS_TABLES: readonly string[] = [
  'src/lib/link-check/address-rules.ts',
  'src/lib/link-check/address-rules.test.ts',
];
