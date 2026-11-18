import { databaseZone } from './zones';

// The four names of POSIX rules, EST5EDT, CST6CDT, MST7MDT and PST8PDT, which the
// database made links to their cities in 2024b. Bun's data follows it, while Node.js's
// still gives them rules of their own, so only Bun's Temporal makes them one zone.
const POSIX_RULES_NAME = /^[A-Z]{3}\d[A-Z]{3}$/u;

/**
 * Says whether two names that `isTimeZone` accepts name one zone, so that the
 * app offers the owner the device's zone only when it differs from the setting
 * (IHM-14, CL-IHM-05). Temporal compares the zones: an alias and the zone it
 * links to are one, in any letter case (`Asia/Calcutta` and `Asia/Kolkata`,
 * `Etc/UTC` and `UTC`), while `Europe/Paris` and `Europe/Berlin` are two, though
 * their clocks read alike today, and so are a few zones that the database links
 * across a border, such as `Europe/Vatican` and `Europe/Rome`. A name of POSIX
 * rules such as `EST5EDT` is one zone only with itself, which keeps the answer
 * the same on Node.js and on Bun. False when either name is not a zone; it never
 * throws.
 */
export function isSameTimeZone(a: string, b: string): boolean {
  const first = databaseZone(a);
  const second = databaseZone(b);
  if (first === undefined || second === undefined) {
    return false;
  }
  const hasPosixRules = [first, second].some((zoned) => POSIX_RULES_NAME.test(zoned.timeZoneId));
  return hasPosixRules ? first.timeZoneId === second.timeZoneId : first.equals(second);
}
