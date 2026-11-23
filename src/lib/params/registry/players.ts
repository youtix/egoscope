import { entriesOf } from '../entry';
import { integer } from '../kinds';
import { DAYS, DAYS_PER_QUARTER, GAMES, noun, SEASON_GAMES, WHOLE } from '../units';

import type { FamilyEntries } from '../entry';

// The defaults of 01 Followed players (module map §6, CL-TRV-16).
const MAX_ACTIVE = 30;
const INDICATIVE_MIN = 20;
const PROLONGED_ABSENCE_GAMES = 10;
const EXPOSURE_WINDOW_DAYS = 30;

const entry = entriesOf(1);
const ACTIVE_PLAYERS = noun('active player', 'active players');

/** The parameters of 01 Followed players (JOU-03, JOU-04, JOU-22). */
export const PLAYERS = {
  'players.maxActive': entry({
    label: 'Maximum active players',
    sentence:
      'How many followed players can be active at once; adding or reactivating one more is refused.',
    unit: 'active players',
    kind: integer(1, WHOLE, ACTIVE_PLAYERS),
    defaultValue: MAX_ACTIVE,
    requirement: 'JOU-04',
    source: 'H-JOU-01',
    boundsNote: ', at least the indicative minimum',
  }),
  'players.indicativeMin': entry({
    label: 'Indicative minimum of players',
    sentence: 'Below this number of active players, the to-do list suggests adding players.',
    unit: 'active players',
    kind: integer(0, WHOLE, ACTIVE_PLAYERS),
    defaultValue: INDICATIVE_MIN,
    requirement: 'JOU-04',
    source: 'H-JOU-01',
    boundsNote: ', at most the maximum; 0 means no reminder',
  }),
  'players.prolongedAbsenceGames': entry({
    label: 'Prolonged-absence threshold',
    sentence:
      "After this many consecutive team games missed, a player's absence counts as prolonged.",
    unit: 'consecutive team games missed',
    kind: integer(1, SEASON_GAMES, GAMES),
    defaultValue: PROLONGED_ABSENCE_GAMES,
    requirement: 'JOU-22',
    source: 'H-JOU-05',
  }),
  'players.exposureWindowDays': entry({
    label: 'Exposure indicator period',
    sentence: "The period over which a player's media exposure is counted.",
    unit: 'days',
    kind: integer(1, DAYS_PER_QUARTER, DAYS),
    defaultValue: EXPOSURE_WINDOW_DAYS,
    requirement: 'JOU-03',
    source: 'H-JOU-08',
    lot: 2,
  }),
} as const satisfies FamilyEntries<'players'>;
