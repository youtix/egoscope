// The expected failures of the Telegram port, which every adapter maps the Bot API's
// answers to (module map §5; telegram sheet, "How it is called").

/**
 * Why a call failed:
 * - temporary, which the caller retries (TEL-35): `rate_limited`, Telegram asking to slow
 *   down, with the delay its `retry_after` gives; `unreachable`, no answer or a server
 *   error; `timeout`, a call past its deadline or stopped by its signal;
 * - permanent, which break the link (TEL-37): `blocked`, the person blocked the bot;
 *   `chat_not_found`, a chat that is gone or never wrote to the bot; `bot_deactivated`;
 *   `unauthorized`, a token that Telegram refuses;
 * - `too_long`: a text over MESSAGE_MAX_LENGTH characters once its tags are read (CL-TEL-14);
 * - `delete_refused`: a message sent 48 hours ago or more, which Telegram no longer
 *   deletes (TEL-38, CL-TEL-09);
 * - `webhook_conflict`: `getUpdates` while a webhook is set.
 */
export type TelegramError =
  | Readonly<{ kind: 'rate_limited'; retryAfterMs: number }>
  | Readonly<{ kind: 'unreachable' }>
  | Readonly<{ kind: 'timeout' }>
  | Readonly<{ kind: 'blocked' }>
  | Readonly<{ kind: 'chat_not_found' }>
  | Readonly<{ kind: 'bot_deactivated' }>
  | Readonly<{ kind: 'unauthorized' }>
  | Readonly<{ kind: 'too_long' }>
  | Readonly<{ kind: 'delete_refused' }>
  | Readonly<{ kind: 'webhook_conflict' }>;

/** The kind of a Telegram failure. */
export type TelegramErrorKind = TelegramError['kind'];
