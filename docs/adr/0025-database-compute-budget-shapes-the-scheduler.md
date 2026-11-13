# 0025. The database's compute budget shapes the scheduler

- Status: Accepted
- Date: 2026-11-11
- Decided by: the coordinator, from the measurements of the database and scheduler sheets ([0024](0024-external-services.md))

## Context

- Record 0002: an external trigger wakes the application, which keeps its own schedule and works in resumable portions.
- Neon's free plan allows 100 compute-hours a month per project. A compute stays active until five minutes after its last query and cannot be kept from sleeping. At the fixed 0.25 CU, a query on every 5-minute tick keeps it awake all month: 182.5 CU-hours, after which Neon suspends the database until the next month (`docs/services/database.md`). Even a tick every 15 minutes would spend about 60 CU-hours before any real work.
- The trigger ([0024](0024-external-services.md)): a primary caller every 5 minutes, and a backstop every 15 minutes with a 15-minute jitter window, in beta.

## Decision

- A tick with nothing due must not open a database connection.
- The tick consults a wake plan kept outside the database — the next due instants — and reads the database at most hourly while idle.
- The tick route accepts both GET and POST.
- No design may assume a 5-minute cadence: the backstop runs every 15 minutes, with jitter.
- The architect designs the mechanism in the module map (`docs/engineering/module-map.md`); this record holds the rule and its reason, not the mechanism.

## Why

The compute allowance is the only tight resource of the free plan, and exceeding it suspends the database for the rest of the month: a scheduler that queried on every tick would stop the application. With idle ticks kept away from the database, the expected use is 11 to 48 CU-hours a month, which leaves a margin. Accepting GET and POST lets any caller that can send the secret replace the trigger; tolerating the backstop's cadence keeps the application correct when the primary is silent.

## Consequences

- Every change that moves a due instant — a setting, a new queue item, a failed send, a retry — rewrites the wake plan in the same operation, and a missing plan sends the tick to the database.
- The secret check of TRV-65 comes first, before the plan is read, for both methods.
- Time-sensitive features tolerate up to about 30 minutes between ticks: retry delays shorter than that happen at the next tick (TEL-35); a run due at 16:30 or 23:00 may start late, well inside the margin of TRV-31; the Telegram link code, valid 15 minutes (TEL-29), relies on the webhook, since the polling fallback of the Telegram sheet assumed a 5-minute tick and may not confirm in time at the backstop's cadence.
- The interface does not poll the server while it is open.
- The status screen shows which caller woke the application last, so that a silent primary shows (TRV-46).

## What would change it

- A database plan whose compute does not count idle time, or a larger free allowance: the rule could relax, but the wake plan stays the cheaper design.
- A trigger that guarantees a fine cadence: designs still keep the backstop's tolerance, as long as a 15-minute backstop exists.
