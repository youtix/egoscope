# 0002. Free hosting on Vercel Hobby and Neon, scheduled work through an external trigger

- Status: Accepted
- Date: 2026-11-11

## Context

[14 — Exigences transverses](../14-exigences-transverses.md) and the decision journal set the frame:

- D-07 bis and TRV-01: every service sits in a free offer, with no paid option, no time-limited trial and the host's free address. TRV-02 and H-TRV-01 exclude by default a service that requires a payment card, but let the owner lift the exclusion case by case after being warned of the billing risk.
- Q-02 leaves host and database unchosen. TRV-13: the host runs the JavaScript or TypeScript server part and either runs the scheduled tasks at the required frequencies or accepts that a free trigger service starts them from outside; long work may be split (TRV-30). TRV-14: a hosted relational database on a free tier (D-23), reached over an encrypted connection, with full export and restore.
- TRV-20 and D-28: one language, JavaScript or TypeScript, the choice being left to technical design.
- TRV-25 to TRV-33 fix the task calendar and its rules: settings in the owner's time zone across clock changes (TRV-27), one run at a time (TRV-28), no duplicate (TRV-29), resumable portions (TRV-30), missed-run detection (TRV-31), manual runs (TRV-33). TRV-65: an external trigger is protected by a secret, and an unauthenticated one is refused and logged.

## Decision

- Hosting on Vercel Hobby, database on Neon Postgres.
- Everything stays free: no paid tier, no payment card, and no case-by-case waiver of TRV-02.
- TypeScript throughout. Bun for install, scripts and tests. Production runs on Bun only if Vercel's Bun runtime proves stable, otherwise on Node; switching is recorded by amending this record.
- All scheduled work goes through an external trigger protected by the TRV-65 secret, as chunked, resumable jobs (TRV-30).

## Consequences

- The external trigger is a wake-up call at a fixed cadence and nothing more. The application keeps the schedule itself: from its own settings it decides which tasks are due, in the owner's time zone and across clock changes (TRV-27), detects missed runs (TRV-31) and never starts a task that is still running (TRV-28, TRV-29). Changing an hour in the settings ([0019](0019-two-daily-collection-and-detection-runs.md)) therefore never means reprogramming the trigger. The cadence must suit the configured hours and the retry delays (STA-36, TEL-35); technical design records it (TRV-25).
- Every wake-up call without the secret is refused and logged (TRV-65, CA-TRV-21). The secret lives in the deployment configuration (TRV-37, TRV-64).
- Long work — a career fetch (STA-41), collection followed by detection, a full recalculation (SEN-34), a backup — runs in portions that fit the platform's execution limit and records its progress, so the next wake-up resumes it without loss or duplicate (TRV-30, CA-TRV-09).
- Vercel and Neon each get a service sheet (TRV-09) whose terms are checked on the day; a service that fails the check is replaced under [0011](0011-choosing-the-remaining-services.md).
- TRV-75 steps 3 and 7 become: create the Vercel and Neon accounts, and the trigger account if the chosen trigger needs one; program the wake-up call with its secret.

## Alternatives considered

- Running the tasks on the host's own scheduler, the first option of TRV-13. Not retained: all scheduled work comes through the external trigger.
- Accepting a service that needs a payment card after warning the owner, as TRV-02 allows. Not retained.
- JavaScript instead of TypeScript (D-28 left the choice open). Not retained.
