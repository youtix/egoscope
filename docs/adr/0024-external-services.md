# 0024. External services

- Status: Accepted
- Date: 2026-11-11
- Decided by: the orchestrator, under record [0011](0011-choosing-the-remaining-services.md); hosting and database were the owner's choice ([0002](0002-free-hosting-on-vercel-and-neon-with-an-external-trigger.md)), here verified

## Context

- Record 0002: Vercel Hobby and Neon Postgres, everything free, no paid tier and no payment card; all scheduled work through an external trigger protected by the TRV-65 secret. Record 0011: every other service chosen by TRV-11 and TRV-12, fewest accounts first — free without a payment card, automated access permitted, replaceable, with a service sheet and its terms checked on the day; a service that fails the check is replaced by the closest free equivalent, with the reason recorded. Record 0018: backups in a private space on the owner's GitHub account, or the host's free file storage if that checks out better. D-30: Telegram.
- The service sheets in `docs/services/` hold the TRV-09 items for each role. Every condition was read on 2026-11-11 on the providers' official pages, without signing in or creating an account. The statistics source is [0023](0023-statistics-source-sportsdataverse-releases.md).

## Decision

| Role | Service | Account |
| --- | --- | --- |
| Hosting | Vercel Hobby, functions in Frankfurt (`fra1`), the Node.js runtime ([0026](0026-runtime-node-in-production-bun-for-tooling.md)), the free `vercel.app` address | Vercel, new, GitHub sign-in |
| Database | Neon Free, one project in AWS Frankfurt, compute fixed at 0.25 CU, account created at Neon directly | Neon, new, GitHub sign-in |
| External trigger | Primary: a Cloudflare Worker with a Cron Trigger every 5 minutes, on Workers Free. Backstop: a Vercel Schedules static schedule every 15 minutes, on Hobby (public beta). Both call the same secret-protected tick. | Cloudflare, new, shared with the model; the Vercel account |
| Detection model (Lot 2) | Primary: Cloudflare Workers AI, model `@cf/zai-org/glm-4.7-flash`, on its free daily allocation. Optional fallback: Groq Free, model `openai/gpt-oss-120b`, used only when its key is set. | The Cloudflare account; Groq only if the owner sets its key |
| Notifications (Lot 2) | The Telegram Bot API: one bot created with BotFather, updates through a webhook | The owner's existing Telegram account |
| Backup storage | The assets of one draft release in a separate private repository of the owner's GitHub account, reached with one fine-grained token limited to that repository | The owner's existing GitHub account |

The fallback model is the orchestrator's decision: a second provider is used only when its key is set, so the application works fully with one account fewer.

## Why each passes the owner's rule

Free, no payment card, automated access permitted, replaceable:

- **Vercel Hobby**: $0 and permanent; a Hobby account cannot buy extra usage, and a card is asked only to upgrade to Pro, so a limit stops a feature instead of billing. Hobby is meant for personal, non-commercial use; functions that query databases and APIs are fair use, and nothing forbids an outside scheduler calling a route. Any Next.js host with an outside scheduler replaces it; no data lives on Vercel.
- **Neon Free**: $0, no card, no time limit. A database queried by an application is the product's purpose. It is replaced by any Postgres over TLS, by export and restore. An AWS region is required: free projects in the deprecated Azure regions are deleted after 90 idle days. Its compute allowance is the one tight limit ([0025](0025-database-compute-budget-shapes-the-scheduler.md)).
- **Cloudflare Workers Free**: the default plan, no card, permanent; Cron Triggers are documented for calling third-party APIs; any scheduler that can send a header replaces it, cron-job.org first.
- **Vercel Schedules**: a first-party Hobby feature, at no cost and with no new account; it keeps the application alive if the primary stops.
- **Cloudflare Workers AI**: a free allocation of 10,000 neurons a day, renewed daily; the REST API is the product. A typical day uses about 29 % of it, 150 realistic calls about 78 %. A spare model on the same account replaces the primary model.
- **Groq Free**: no card unless upgrading; strict structured outputs. Its daily token allowance is too small for a primary, and its agreement says its services are not for consumer use, which leaves an ambiguity for a personal project: two reasons to keep it an optional fallback.
- **Telegram**: named by the specs (D-30); the bot platform is free; a bot that writes only to its owner's chat fits its terms.
- **GitHub release assets**: GitHub Free, already the owner's, includes unlimited private repositories, with no limit on the total size or bandwidth of releases. An asset deleted through the interface is gone from listings and addresses, which the adapter verifies (CL-TRV-04); a draft release is used because the assets of a published release could no longer be deleted if immutable releases were switched on, a setting left off. A private Vercel Blob store replaces it.

## Rejected

- **Scheduler**: GitHub Actions schedules (the Actions terms forbid, on GitHub-hosted runners, activity unrelated to the repository's software, citing serverless use; runs can be delayed or dropped; schedules in public repositories stop after 60 idle days); Vercel Cron Jobs on Hobby (once a day, anywhere within the hour); Vercel Schedules as primary (every 15 minutes at most, with jitter, and beta — kept as the backstop); cron-job.org (one more account, disabled after more than 25 consecutive failures, terms that make users responsible for secrets sent in headers — the best replacement); Upstash QStash (its terms allow deleting accounts unused for two weeks); Google Apps Script (a Google account, needed for nothing else); UptimeRobot (a monitor, with no custom headers shown on the free plan).
- **Database**: creating Neon through Vercel's Marketplace (it ties the database to the host's team and blocks Neon's project transfer); Supabase (free projects pause after a week of inactivity).
- **Hosting**: Cloudflare Workers as host (10 ms of CPU per request on the free plan, too little for server rendering).
- **Detection model**: the Gemini free tier (its terms allow only paid services for API clients used in the European Economic Area, reserve the API for professional or business purposes, and show the free limits only after signing in); GitHub Models (retired on 2026-07-30); Mistral (API keys need billing); Cerebras (no permanent free tier); OpenRouter free models (50 requests a day); SambaNova (20 requests a day); OVHcloud anonymous endpoints (presented for testing, no contract, an address shared with other tenants); Hugging Face (no free credits); Cohere (trial keys, 1,000 calls a month); Z.ai (limits published only behind a login); either chosen provider alone.
- **Backup storage**: a private Vercel Blob store (1 GB shared with the project, a 30-day lockout after any limit is exceeded, the same provider as the application — the runner-up); Backblaze B2 (one more account, file versions kept by default); Cloudflare R2 (a purchase checkout before any token, with no statement that no card is needed); Telegram documents (the bot cannot delete messages older than 48 hours, and the bot terms exclude storage); Google Drive (a Google account and short-lived tokens); Supabase Storage (pauses); files committed to a repository (the history keeps every version); secret gists (readable by anyone with the address).

## Consequences

- Accounts: new — Vercel and Neon (GitHub sign-in, so no new password), Cloudflare (two roles), and Groq only if the owner wants the fallback; existing — GitHub and Telegram. No card is ever entered and no trial is started (TRV-01, TRV-02). The hand-over list of [0008](0008-autonomous-build-and-end-of-build-handover.md) is `docs/services/accounts-and-keys.md`.
- One region: the functions run in Frankfurt next to the database.
- Callers from outside — the trigger and the Telegram webhook — use the production address, since the host protects the other deployment addresses; the database variables are set for production only, so a preview can never write to the single database (TRV-78).
- Large downloads, such as the full export (TRV-52), are streamed past the host's 4.5 MB response limit.
- The owner opts out of the host's use of Hobby content for model training.
- The backstop caller is the host's own scheduler, which [0002](0002-free-hosting-on-vercel-and-neon-with-an-external-trigger.md) did not retain as the way to run tasks. It only wakes the same protected tick as the external trigger and never holds the schedule; the application keeps its own schedule, as 0002 requires.
- Detection goes through one interface over an ordered list of providers, with one JSON schema written for strict mode; every answer is validated, and the provider and model are recorded with each classification (DET-53, DET-56). Without the Groq key, the primary carries all the volume: what does not fit waits for the next daily reset (DET-08).
- Every quota is a setting (TRV-03); each sheet gives the values to enter.

## What would change it

- A service fails a rule at a re-check (TRV-10), or refuses below its declared limit (TRV-06): the replacement its sheet names, with the reason recorded (record 0011).
- Vercel Schedules leaves its beta with worse limits: cron-job.org, or Vercel Cron Jobs once a day, as the backstop.
- The model `glm-4.7-flash` is retired: the spare model on the same account.
- Gemini's European restriction is lifted: Gemini becomes a candidate for detection.
- GitHub forbids release assets as storage, or their deletion stops being real: a private Vercel Blob store.

## Amendments

### 2026-11-13 — The Telegram webhook (orchestrator)

- The webhook is registered with `max_connections` 1, and the stored update identifier only moves forward, so each update is handled once and in order.
