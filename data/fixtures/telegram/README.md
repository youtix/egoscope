# The answers and updates of the Telegram Bot API adapter

These files are answers and updates of the Telegram Bot API, as the Telegram sheet
(`docs/services/telegram.md`) calls it. No bot existed when they were written: they follow the
Bot API reference (the `{ ok, result }` and `{ ok, error_code, description, parameters }`
envelopes, the `User`, `Message`, `Update`, `ChatMemberUpdated` and `WebhookInfo` objects) and
the error descriptions that Telegram is commonly seen to give, which the reference does not list.
The owner's first real check compares them with a real bot's answers. Every value that names
something is invented: the bot `egoscope_replay_bot`, every chat, user, message and update id,
and the webhook address on `example.test`. No file holds a token or any other credential.

The tests of the adapter (`src/lib/telegram/bot-api.test.ts`) serve them from a fake HTTP layer
that plays one bot, so that no test reaches Telegram; it writes into each answer what the request
changed: the message ids, the chats and the webhook's settings.

- `answers.json`: the answers of success, by name: `getMe`, `sendMessage`, a plain `true`,
  `setWebhook` and `deleteWebhook`, `getWebhookInfo` with a webhook and its last delivery error and
  without one, and `getUpdates`.
- `errors.json`: the refusals, by name: a slow-down with its `retry_after` (`429`), a refused token
  (`401`), an address that names no bot (`404`), a blocked bot, a deleted account and a person who
  never started the bot (`403`), an unknown chat, a text too long, a deletion of a message that is
  gone or too old, a refused webhook and malformed markup (`400`), polling while a webhook is set
  (`409`) and a server error (`502`).
- `updates.json`: the updates, by name: a `/start` with a 43-character link code from a private
  chat and from a group, a plain text, and the bot blocked in a private chat.
