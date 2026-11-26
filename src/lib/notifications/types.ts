// The row and insert types of the tables of the Telegram notifications (module map, section
// 2.5), as Drizzle derives them from the schema of `@/lib/db`.
import type {
  notificationDailyCounts,
  notificationMessageEvents,
  notificationMessageFacts,
  notificationMessages,
  telegramLinkCodes,
  telegramLinks,
} from '@/lib/db';

export type TelegramLinkRow = typeof telegramLinks.$inferSelect;
export type NewTelegramLinkRow = typeof telegramLinks.$inferInsert;
export type TelegramLinkCodeRow = typeof telegramLinkCodes.$inferSelect;
export type NewTelegramLinkCodeRow = typeof telegramLinkCodes.$inferInsert;
export type NotificationMessageRow = typeof notificationMessages.$inferSelect;
export type NewNotificationMessageRow = typeof notificationMessages.$inferInsert;
export type NotificationMessageFactRow = typeof notificationMessageFacts.$inferSelect;
export type NewNotificationMessageFactRow = typeof notificationMessageFacts.$inferInsert;
export type NotificationMessageEventRow = typeof notificationMessageEvents.$inferSelect;
export type NewNotificationMessageEventRow = typeof notificationMessageEvents.$inferInsert;
export type NotificationDailyCountRow = typeof notificationDailyCounts.$inferSelect;
export type NewNotificationDailyCountRow = typeof notificationDailyCounts.$inferInsert;
