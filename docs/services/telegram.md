# Notifications: Telegram Bot API

| Item         | Value                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------ |
| Role         | Sends the owner's notifications and receives the one-time linking code (D-30, TRV-18)      |
| Decision     | A bot created with BotFather, messages through the Bot API, updates through a webhook      |
| Status       | Named by the specifications; not up for replacement                                        |
| API version  | Bot API 10.4, dated 2026-11-09 ([changelog](https://core.telegram.org/bots/api-changelog)) |
| Date checked | 2026-11-11                                                                                 |

## Role

From lot 2, every notification of document 11 leaves through the application's own bot to one
private chat, the owner's (TEL-01, DSN-31). The bot also receives updates for one purpose: the
owner taps "Start" on a deep link that carries a one-time code, and the application links that chat
(TEL-29). Messages from any other chat get no reply and are logged (TEL-31, TRV-67). Telegram
carries copies only: everything notified stays in the application (TEL-02).

## Plan and cost

Free: the Bot Platform is free for both users and developers ([Bots](https://core.telegram.org/bots)).
There is no paid plan to avoid, except paid broadcasts, which must stay off (below). No card.

## Account needed

No new account. The owner already uses Telegram; the bot is created from that account with
BotFather, which is free:

1. Send `/newbot` to @BotFather; choose a display name and a username of 5 to 32 Latin letters,
   digits or underscores ending in `bot`, which cannot be changed later
   ([BotFather](https://core.telegram.org/bots/features#botfather)).
2. Copy the token BotFather returns; it controls the bot.
3. Send `/setjoingroups` and disable it, so the bot cannot be added to groups (TRV-75 step 14).
4. If the token leaks, `/token` generates a new one
   ([BotFather](https://core.telegram.org/bots/features#botfather)); TRV-75 expects the old one to
   stop working, which a `getMe` call with the old token confirms.

## Limits

| Limit                     | Value                                                                                    | Source                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Messages in one chat      | Avoid more than 1 per second; bursts end in `429` errors                                 | [Bots FAQ](https://core.telegram.org/bots/faq), "My bot is hitting limits"                                             |
| Messages in a group       | 20 per minute (not used)                                                                 | [Bots FAQ](https://core.telegram.org/bots/faq)                                                                         |
| Broadcast                 | About 30 messages per second, free; more only with paid broadcasts                       | [Bots FAQ](https://core.telegram.org/bots/faq)                                                                         |
| Message text              | 1 to 4,096 characters after entities are parsed                                          | [sendMessage](https://core.telegram.org/bots/api#sendmessage)                                                          |
| Deleting a message        | Only if sent less than 48 hours ago; bots can delete their own messages in private chats | [deleteMessage](https://core.telegram.org/bots/api#deletemessage)                                                      |
| Pending updates           | Kept on Telegram's servers for at most 24 hours                                          | [Getting updates](https://core.telegram.org/bots/api#getting-updates)                                                  |
| Webhook ports             | 443, 80, 88 or 8443; IPv4 only                                                           | [setWebhook](https://core.telegram.org/bots/api#setwebhook), [Webhooks guide](https://core.telegram.org/bots/webhooks) |
| Webhook secret            | 1 to 256 characters from `A-Z`, `a-z`, `0-9`, `_` and `-`                                | [setWebhook](https://core.telegram.org/bots/api#setwebhook)                                                            |
| Deep-link start parameter | Up to 64 characters from `A-Z`, `a-z`, `0-9`, `_` and `-`; base64url recommended         | [Deep linking](https://core.telegram.org/bots/features#deep-linking)                                                   |
| Starting a conversation   | Bots cannot start one; the user must message the bot first                               | [Bots](https://core.telegram.org/bots)                                                                                 |

## Our expected use and the margin

| Resource         | Expected use                                                        | Limit                              | Margin                    |
| ---------------- | ------------------------------------------------------------------- | ---------------------------------- | ------------------------- |
| Messages         | A few a day, never more than the daily cap of 20 (TEL-22, H-TEL-03) | About 86,400 a day at 1 per second | >99%                      |
| Burst            | One grouped message per pass (TEL-19); at most a few in a row       | 1 per second                       | Pace sends 1 second apart |
| Message length   | A few lines (TEL-08); a long grouped message is shortened (TEL-19)  | 4,096 characters                   | Large                     |
| Incoming updates | The linking `/start`, a test message, rare stray messages           | No published cap                   | n/a                       |
| Linking code     | 32 random bytes as base64url: 43 characters                         | 64 characters                      | 21 characters             |

## Terms on personal use and automated access

The [Bot Platform Developer Terms of Service](https://telegram.org/tos/bot-developers) apply on top of
Telegram's terms and privacy policy (section 1). A bot is automated by nature, and a personal bot that
writes only to its owner fits them. The points that bind this application:

- **No spam**: "Your TPA must not harass or spam users with unsolicited messages" (section 5.2).
  The bot writes only to the chat that started it with a valid code.
- **No circumventing rate limits** and no service that strays from the platform's intended use,
  cloud storage being the example given (section 5.2), which also rules Telegram out for backups.
- **Privacy**: a bot must have a privacy policy; Telegram's standard policy for bots applies by
  default when the bot provides none (section 4). Data collected must be limited to what is
  essential and deleted when no longer needed (sections 4.2 and 4.3), which document 13 already
  requires.
- **Credentials**: the bot token must be kept secret (section 4.5).
- **Persistence**: Telegram may delete chats, messages and files, and a bot may be terminated if the
  account that owns it is deleted (section 6.3). Notifications are copies (TEL-02), so nothing is
  lost.

## Inactivity policy

- **The owner's account**: if the owner does not come online for 18 months, by default, the account
  and its cloud data are deleted; the period can be changed in Settings
  ([Telegram FAQ](https://telegram.org/faq), "How does account self-destruction work?"). Opening
  Telegram once in that period prevents it; reading notifications does.
- **The bot**: Telegram reserves the right to recall usernames of unused bots
  ([Telegram FAQ](https://telegram.org/faq), "What do I do if my username is taken?"). A bot that
  sends messages regularly is in use.

## Data we send

The notification texts of document 11: player names, type names (never a type marked "sujet intime",
DSN-35), outlets, dates and times, profile figures and links back to the application. Never an
article excerpt, a description or a quotation (TEL-06). Telegram stores the chat in its cloud. The
application stores the linked chat ID, the sent message IDs (needed to delete them, TEL-38) and the
message log of TEL-34.

## Availability in France

Available; Telegram's terms for users in the European Union apply, and Telegram names an EU legal
representative under the Digital Services Act ([Telegram EU DSA](https://telegram.org/tos/eu-dsa)).
No restriction on France was found.

## How it is called

Plain HTTPS: `https://api.telegram.org/bot<token>/<method>` with JSON bodies; no SDK needed. The
token sits in the request path, the only way the Bot API accepts it, so the request URL counts as a
secret: it is never logged, journaled or written into technical details, and an error or a response
that carries it is passed through `env.redact` before it goes anywhere (TRV-64; module map §7).

- **Sending**: `sendMessage` with `chat_id`, `text`, `parse_mode: "HTML"` and
  `link_preview_options: { is_disabled: true }`. In HTML mode every `<`, `>` and `&` outside a tag
  must be escaped ([Formatting options](https://core.telegram.org/bots/api#formatting-options)).
  Telegram apps ask for confirmation before opening an inline link and show its full URL; a bare
  URL avoids that prompt. Never set `allow_paid_broadcast`.
- **Receiving: webhook (recommended)**. A serverless application has no process to poll with, and
  the owner's tap must be confirmed within the 15-minute code validity (TEL-29). The application
  calls `setWebhook` once, during the installation check (TRV-47), with:
  - `url`: `https://<project>.vercel.app/api/telegram/webhook`, the production domain, with no
    redirect;
  - `secret_token`: the value of `TELEGRAM_WEBHOOK_SECRET`, which Telegram returns in the header
    `X-Telegram-Bot-Api-Secret-Token` of every call ([setWebhook](https://core.telegram.org/bots/api#setwebhook));
  - `allowed_updates: ["message", "my_chat_member"]` and `drop_pending_updates: true`;
  - `max_connections: 1`, so that Telegram delivers one update at a time, in order; its default is
    40 simultaneous connections ([setWebhook](https://core.telegram.org/bots/api#setwebhook),
    parameter `max_connections`, 1 to 100). The application stores the last `update_id` it has
    handled and when, so parallel deliveries could make a lower update arrive after a higher one and
    be dropped as a redelivery, a `/start` code with it (record 0024, amendments of 2026-11-13 and
    2026-11-18). Telegram numbers a bot's updates sequentially, but after at least a week without
    any update it picks the next identifier at random ([Update](https://core.telegram.org/bots/api#update),
    field `update_id`), so a lower identifier then starts a new sequence.

  The handler compares the header in constant time and rejects a mismatch with `401`; answers `200`
  quickly to every genuine update, since any other status makes Telegram retry; deduplicates on
  `update_id`, an update at or below the stored `last_update_id` being a redelivery that is ignored
  while the last update handled is less than 24 hours old — Telegram keeps an undelivered update at
  most 24 hours, so no redelivery comes later, and its week without updates is counted from an
  update the application may have handled up to 24 hours after Telegram created it — and, once the
  last update handled is 24 hours old or more, the start of a new sequence that is handled and becomes
  the stored one; in polling mode, `getUpdates` is called without an offset in that case, since an
  offset above the new identifiers would confirm and drop them;
  accepts only `message.chat.type == "private"`; links the chat on a valid, unused, unexpired
  `/start <code>`; and counts everything else without replying and without opening the database,
  telling a valid code or the linked chat from a stranger by the keyed inbound filter of the module
  map (§1.9), the database pass then journaling each such update (TEL-31, CL-TRV-21).
  `getWebhookInfo` reports the last delivery error, which the installation check displays.

- **Receiving: polling (fallback)**. `getUpdates` cannot be used while a webhook is set, and updates
  wait at most 24 hours ([Getting updates](https://core.telegram.org/bots/api#getting-updates)). If the
  webhook cannot be used, the application deletes it and polls instead. **Linking relies on the
  webhook**: a tick cannot be counted on to poll within the code's 15-minute validity, since with only
  the fallback trigger up to about 30 minutes can pass between ticks ([scheduler.md](scheduler.md)).
  In polling mode, the owner's "I tapped Start" action in the linking screen therefore polls at once,
  while the code is still valid. Otherwise polling only catches up later: at a tick's probe while a
  link code is pending, or at the end of a database pass, which comes at least hourly. Messages from
  other chats are still logged (TEL-31), since Telegram keeps updates for 24 hours.
- **Deleting after a withdrawal** (TEL-38, H-TEL-04, CL-TEL-09): the application asks Telegram once
  to delete each sent message about the event, one `deleteMessage` call per message, whatever its
  age and even in a chat no longer linked
  ([deleteMessage](https://core.telegram.org/bots/api#deletemessage)). Its answer is per message —
  deleted, refused (a message older than 48 hours) or not found, which a second attempt counts as
  deleted (CL-TEL-09) — whereas `deleteMessages`, which takes up to 100 messages of one chat, answers
  only `true` and skips the messages it cannot find, so it could not list the refusals. The calls
  go one at a time, within the sending rate of the bot. The refusals, and the messages that could
  not be reached, are kept
  in memory only and listed once, on the screen shown right after the withdrawal, so that the owner
  can delete them himself, as the withdrawal screen announces (DSN-28); the list is never stored.
- **Retries** (TEL-35): on `429`, the response's `parameters.retry_after` gives the seconds to wait
  ([ResponseParameters](https://core.telegram.org/bots/api#responseparameters)); the application waits
  the longer of that delay and its own schedule.

### Environment variables

| Variable                  | Value                                                                            | Secret |
| ------------------------- | -------------------------------------------------------------------------------- | ------ |
| `TELEGRAM_BOT_TOKEN`      | The token from BotFather                                                         | Yes    |
| `TELEGRAM_WEBHOOK_SECRET` | 43 random base64url characters, see [accounts-and-keys.md](accounts-and-keys.md) | Yes    |

The bot's username, needed for the deep link, is read with `getMe`; the linked chat ID is data in
the database, not configuration.

## When a quota is hit

Telegram answers `429` with a `retry_after` value; the application waits that long, then resumes the
retry sequence of TEL-35 and, after the last attempt, the catch-up message of TEL-36. A blocked bot
or a deleted chat is a definitive failure: the link becomes "rompue" (TEL-37). The application's own
daily cap (TEL-22) keeps it far below Telegram's limits.

## Quota parameters to enter (TRV-03)

| Parameter                     | Value to enter |
| ----------------------------- | -------------- |
| Messages per second, one chat | 1              |

The maximum message length, 4,096 characters, is not a value to enter: it is a constant of the
transport, recorded in this sheet and fixed in the code, never a setting (CL-TEL-14; module map §6,
"Not parameters").

## Replaceable by

Nothing: Telegram is the notification channel chosen by the owner (D-30). What can be replaced is
the bot: if its token leaks or the bot is lost, create a new one with BotFather, enter the new token
and link the chat again (TEL-29, TRV-75 step 14).

## Date checked

2026-11-11.

## What was verified and how

Read on 2026-11-11, without logging in: the Bot API reference and changelog, the Bots overview,
features (BotFather, deep linking) and FAQ, the webhooks guide, the Bot Platform Developer Terms of
Service, Telegram's FAQ and its EU terms. No bot was created and no token used. Not verified: how
many times and at what intervals Telegram retries a failed webhook delivery; whether Telegram accepts
the `*.vercel.app` certificate, which its FAQ warns may be a problem for wildcard certificates (test
with `getWebhookInfo`; polling is the fallback); and the exact error returned when the owner has
blocked the bot.

## Risks

- **Messages older than 48 hours cannot be deleted by the bot**: a withdrawn event can remain in old
  messages until the owner deletes them; the withdrawal screen says so (DSN-28).
- **Webhook certificate on `*.vercel.app`**: unverified; the polling fallback, with the owner's "I
  tapped Start" action, covers the linking.
- **Owner's account self-destruct** after 18 months offline would take the bot with it.
- **Token leak**: anyone with the token controls the bot; it lives only in the Vercel environment.
