// The row and insert types of the tables of the follow list (module map, section
// 2.4), as Drizzle derives them from the schema of `@/lib/db`.
import type {
  followedPlayers,
  playerNameVariants,
  playerStatusChanges,
  playerTeamChanges,
} from '@/lib/db';

export type FollowedPlayerRow = typeof followedPlayers.$inferSelect;
export type NewFollowedPlayerRow = typeof followedPlayers.$inferInsert;
export type PlayerNameVariantRow = typeof playerNameVariants.$inferSelect;
export type NewPlayerNameVariantRow = typeof playerNameVariants.$inferInsert;
export type PlayerStatusChangeRow = typeof playerStatusChanges.$inferSelect;
export type NewPlayerStatusChangeRow = typeof playerStatusChanges.$inferInsert;
export type PlayerTeamChangeRow = typeof playerTeamChanges.$inferSelect;
export type NewPlayerTeamChangeRow = typeof playerTeamChanges.$inferInsert;
