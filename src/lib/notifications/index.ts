// The public API of the Telegram notifications (module map, section 2.5): the types of
// types.ts, then one slot per other file that the plan gives the module, with the operations
// it will export. A task adds its exports in its own file's slot only (section 9).

// types.ts
export type {
  NewNotificationDailyCountRow,
  NewNotificationMessageEventRow,
  NewNotificationMessageFactRow,
  NewNotificationMessageRow,
  NewTelegramLinkCodeRow,
  NewTelegramLinkRow,
  NotificationDailyCountRow,
  NotificationMessageEventRow,
  NotificationMessageFactRow,
  NotificationMessageRow,
  TelegramLinkCodeRow,
  TelegramLinkRow,
} from './types';

// linking.ts: startLinking, confirmChatLink, unlink
// inbound.ts: handleInbound, registerWebhook
// polling.ts: pollUpdates, checkLinkNow
// compose.ts: the composition of each message kind (no operation of its own exposed)
// restraint.ts: the restraint rules of the sending (no operation of its own exposed)
// dispatch.ts: dispatch
// delivery.ts: sendTest, deliver, nextDueAt, purgeExpired
// event-messages.ts: discardPendingFor, addEventToPendingMessages, onCalendarEventDropped, deleteMessagesAbout, moveCaseReferences, moveEventReferences
// queries.ts: linkStatus, botUsername, webhookStatus, messages, failedCount, countSentAbout
// erase.ts: eraseEventData, erasePlayerData
// templates.ts and reminders.ts are internal to the module: nothing of them is exported here.
