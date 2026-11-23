// The units of the registry's values, and the bounds that several families share
// (module map §6, CL-TRV-16).

/** The unit a number is written with: " day" and " days", "%", or nothing. */
export type Unit = Readonly<{ one: string; many: string }>;

/** A unit named by a noun after a space: "1 day", "30 days". */
export const noun = (one: string, many: string): Unit => ({ one: ` ${one}`, many: ` ${many}` });

/** A unit named by a symbol, written as it is: "%", " MB". */
const symbol = (text: string): Unit => ({ one: text, many: text });

/** No unit: the number alone. */
export const NO_UNIT: Unit = symbol('');

export const DAYS = noun('day', 'days');
export const HOURS = noun('hour', 'hours');
export const MINUTES = noun('minute', 'minutes');
export const SECONDS = noun('second', 'seconds');
export const GAMES = noun('game', 'games');
export const ATTEMPTS = noun('attempt', 'attempts');
export const POINTS = noun('point', 'points');
export const SOURCES = noun('source', 'sources');
export const CHARACTERS = noun('character', 'characters');
export const CASES = noun('case', 'cases');
export const VALID_CASES = noun('valid case', 'valid cases');
export const REQUESTS = noun('request', 'requests');
export const MESSAGES = noun('message', 'messages');
export const PERCENT = symbol('%');
export const MEGABYTES = symbol(' MB');

/** The games of a regular season, the most a count of games may reach. */
export const SEASON_GAMES = 82;
/** The whole of a share in percent, and the top of a 0–100 scale. */
export const WHOLE = 100;
export const DAYS_PER_WEEK = 7;
export const DAYS_PER_MONTH = 30;
export const DAYS_PER_QUARTER = 90;
export const DAYS_PER_YEAR = 365;
export const HOURS_PER_DAY = 24;
export const MINUTES_PER_HOUR = 60;
export const MINUTES_PER_DAY = 1440;
/** The step of a delay in hours, a quarter of an hour. */
export const QUARTER_HOUR = 0.25;
/** The step of a threshold on the scale of normalized gaps, and its bounds (CL-TRV-16). */
const HUNDREDTH = 0.01;
const LARGEST_GAP = 5;
export const GAP_BOUNDS = { min: 0, max: LARGEST_GAP, step: HUNDREDTH };
