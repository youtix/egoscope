// The locale only shapes how a date format prints, never the zone it resolves.
const ANY_LOCALE = 'en-US';

/**
 * The time zone of the device the code runs on, such as `Europe/Paris`, for
 * client code only: the app offers once to adopt it when it differs from the
 * owner's zone (IHM-14, CL-IHM-05). Server code never calls it, since the
 * server's zone is not the owner's, which the `display.timeZone` setting holds;
 * lint refuses it in a server-only module.
 */
export function deviceTimeZone(): string {
  return new Intl.DateTimeFormat(ANY_LOCALE).resolvedOptions().timeZone;
}
