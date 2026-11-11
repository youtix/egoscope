# External services

This folder records which external service fills each role of the application, why, what its free
tier allows against our expected use, and how to replace it. It settles Q-02 for every role except
the statistics source, which has its own research and sheet. Each sheet holds what TRV-09 requires:
role, free offer, limits, the date the conditions were checked and where to check them again, what
the application does when a limit is reached, and how to replace the service.

All conditions were read on **2026-11-11** on the providers' official pages, without signing in,
creating an account or using any credential. Free tiers change without notice (TRV-10): check every
sheet again before each deployment, and whenever a service refuses an operation below its declared
limit (TRV-06).

## Services at a glance

| Role                                      | Service and plan                                                     | Key limits against our expected use (margin)                                                                                                                                         | Account                      | Replaceable by                                      | Sheet                                        |
| ----------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- | --------------------------------------------------- | -------------------------------------------- |
| Hosting                                   | Vercel Hobby; functions in `fra1`; Node.js 22 runtime                | 1,000,000 invocations a month vs about 20,000 (98%); 360 GB-hours of memory vs 20 to 40 (89% or more); 300 s per function, so work runs in chunks                                    | Vercel, new (GitHub sign-in) | Any Next.js host with an outside scheduler          | [hosting.md](hosting.md)                     |
| Database                                  | Neon Free; AWS Frankfurt; compute fixed at 0.25 CU                   | 1 GB vs about 100 MB (90%); 100 CU-hours a month vs about 18 to 30 in Lot 1 and 20 to 45 in Lot 2 (55% or more), because idle ticks never wake it; 5 GB transfer vs under 1 GB (80%) | Neon, new (GitHub sign-in)   | Any Postgres over TLS, by export and restore        | [database.md](database.md)                   |
| Scheduler, primary                        | Cloudflare Workers Free, one Cron Trigger every 5 minutes            | 100,000 requests a day vs 288 (99%); 1 of 5 cron triggers                                                                                                                            | Cloudflare, new              | cron-job.org                                        | [scheduler.md](scheduler.md)                 |
| Scheduler, fallback                       | Vercel Schedules on Hobby (public beta), every 15 minutes            | 5,000 runs a month vs at most 2,976 (40%)                                                                                                                                            | Vercel, same account         | Vercel Cron Jobs, once a day                        | [scheduler.md](scheduler.md)                 |
| Detection model                           | Cloudflare Workers AI, `@cf/zai-org/glm-4.7-flash`, alone by default | 10,000 neurons a day vs about 2,870 on a typical day (71%) and 7,810 at 150 calls (22%)                                                                                              | Cloudflare, same account     | `@cf/google/gemma-4-26b-a4b-it` on the same account | [detection-model.md](detection-model.md)     |
| Detection model, optional second provider | Groq Free, `openai/gpt-oss-120b`, only when `GROQ_API_KEY` is set    | 1,000 requests and 200,000 tokens a day; takes the overflow and the further attempts                                                                                                 | Groq, new, optional          | `openai/gpt-oss-20b` on the same account            | [detection-model.md](detection-model.md)     |
| Notifications                             | Telegram Bot API, one bot created with BotFather                     | 1 message a second per chat vs at most 20 a day (99%)                                                                                                                                | Telegram, existing           | None (D-30)                                         | [telegram.md](telegram.md)                   |
| Backups                                   | Release assets of one draft release in a private GitHub repository   | Files under 2 GiB, no total or bandwidth cap, vs 8 files of at most 50 MB                                                                                                            | GitHub, existing             | A private Vercel Blob store, Backblaze B2           | [backup-storage.md](backup-storage.md)       |
| Statistics source                         | Chosen by separate research                                          | See its sheet                                                                                                                                                                        | None                         | See its sheet                                       | [statistics-source.md](statistics-source.md) |
| Press feeds                               | Chosen by the owner inside the application (TRV-17)                  | Read twice a day                                                                                                                                                                     | None                         | Any public feed                                     | Document 03                                  |
| Application address                       | The free `https://<project>.vercel.app` (TRV-01)                     | No domain is bought                                                                                                                                                                  | Vercel                       | The next host's free address                        | [hosting.md](hosting.md)                     |

## Accounts

- **New and required**: Vercel, Neon, Cloudflare. Vercel and Neon accept a GitHub sign-in, so they
  add no password; Cloudflare carries two roles (scheduler and model).
- **New and optional**: Groq, the second detection provider; without `GROQ_API_KEY` the detection
  runs on Workers AI alone.
- **Existing**: GitHub (code and backups) and Telegram (the bot is created from the owner's account,
  not a new account).
- **None for the statistics source**: its files are public downloads
  ([statistics-source.md](statistics-source.md)).
- **None of them needs a payment card**, and none is a trial.

The step-by-step list of accounts, tokens, permissions and environment variables is in
[accounts-and-keys.md](accounts-and-keys.md).

## Rules every service was checked against

Set by the owner and by TRV-11: a permanent free tier with no payment card and no trial; volumes
covered with margin; usable from TypeScript; terms compatible with personal, non-commercial use and
with automated access; no deletion of data or account for inactivity, or normal use prevents it;
replaceable behind an interface; fewest accounts first; usable from France, regional terms included.

## Constraints the services put on the build

1. **Idle ticks must not touch the database.** A query every 5 minutes keeps Neon's compute awake
   all month, 182.5 CU-hours against an allowance of 100, after which Neon suspends the database
   until the next month. The tick decides from a wake plan in the Vercel Runtime Cache and opens the
   database only when the plan is missing, older than an hour, written by another deployment, or due
   ([database.md](database.md)).
2. **One region**: Vercel functions in `fra1` next to Neon's `aws-eu-central-1` (both Frankfurt).
3. **Node.js in production, not Bun**: Vercel's Bun runtime is still beta. The whole build uses
   Node.js 22, and a hardening task at the end moves CI and production to the newest LTS that passes
   the gate, before Node.js 22's end of life on 2027-04-30 ([hosting.md](hosting.md)).
4. **Outside callers use the production address**: Vercel's default protection blocks the other
   deployment URLs, so the tick and the Telegram webhook point at `https://<project>.vercel.app`.
5. **Large downloads are streamed**: function bodies are capped at 4.5 MB unless streamed, which
   matters for the full export (TRV-52).
6. **Detection runs a provider chain**: Workers AI alone by default, Groq appended when its key is
   set; every answer is validated, an unusable one gets one further attempt (on the next provider,
   or on the same one when it is alone), and the model of each classification is recorded
   ([detection-model.md](detection-model.md)).
7. **Every quota is a setting** (TRV-03): each sheet lists the values to enter.
8. **Opt out of Vercel's model training** on Hobby content ([hosting.md](hosting.md)).

## Alternatives considered

### Hosting

Vercel Hobby, pre-selected, passed every rule, so no other host was studied in depth. Cloudflare
Workers would not be a drop-in replacement on its free plan, which allows 10 ms of CPU per request
([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)), too little for server
rendering.

### Database

Neon Free, pre-selected, passed under the idle-tick constraint. Creating it through Vercel's
Marketplace integration was rejected: it ties the Neon organization to the Vercel team and blocks
Neon's project transfer ([Vercel-managed integration](https://neon.com/docs/guides/vercel-managed-integration)).
Supabase's free plan pauses projects after a week of inactivity ([Supabase pricing](https://supabase.com/pricing)).

### Scheduler

| Candidate                   | Why it lost                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub Actions `schedule`   | The Actions terms forbid, on GitHub-hosted runners, activity unrelated to producing, testing, deploying or publishing the repository's software, and cite use as part of a serverless application as a burden ([GitHub additional product terms](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features), Actions, effective 2026-08-27). Also: runs are delayed at high load and can be dropped, and schedules in public repositories are disabled after 60 days without activity ([Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)). |
| Vercel Cron Jobs on Hobby   | At most once a day, anywhere within the hour ([Cron Jobs usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Vercel Schedules as primary | Every 15 minutes at most, with a 15-minute jitter window, and still beta ([Schedules limits](https://vercel.com/docs/schedules/limits)); kept as the fallback.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| cron-job.org                | Free and capable ([FAQ](https://cron-job.org/en/faq/)), but one more account, disabled after more than 25 consecutive failures, and its terms make users responsible for not sending security-critical secrets in headers and allow accounts to be locked without notice ([Terms](https://cron-job.org/en/tos/)). Best replacement.                                                                                                                                                                                                                                                                                                                                             |
| Upstash QStash              | Free tier fits (1,000 messages a day, [pricing](https://upstash.com/pricing/qstash)), but its terms allow deleting accounts unused for 2 weeks and free resources without requests for 1 week ([terms](https://upstash.com/trust/terms.pdf), sections 4 and 5), so it cannot wait in reserve.                                                                                                                                                                                                                                                                                                                                                                                   |
| Google Apps Script triggers | Workable quotas ([quotas](https://developers.google.com/apps-script/guides/services/quotas)), but it needs a Google account, which nothing else requires.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| UptimeRobot Free            | A monitor rather than a scheduler, every 5 minutes at best, and custom headers are not shown as part of the free plan ([pricing](https://uptimerobot.com/pricing/)), so the secret would travel in the URL.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### Detection model

Cloudflare Workers AI has the cleanest terms and the largest published allocation, and covers the
realistic volume alone, but does not guarantee schema adherence. Groq guarantees the schema but its
free token allowance does not cover a typical day on its own; it is an optional second provider.

| Candidate                        | Why it lost                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google Gemini free tier          | The Additional Terms allow only paid services for API clients made available to users in the EEA, Switzerland or the UK, and reserve the API for professional or business purposes; free-tier limits are visible only after signing in ([Gemini API Additional Terms](https://aistudio.google.com/docs/terms), [rate limits](https://aistudio.google.com/docs/rate-limits)). Details in [detection-model.md](detection-model.md). |
| GitHub Models                    | Retired on 2026-07-30 ([GitHub Models](https://docs.github.com/en/github-models)).                                                                                                                                                                                                                                                                                                                                                |
| Mistral La Plateforme            | The free mode has no API access; API keys require billing activation ([Usage and limits](https://docs.mistral.ai/admin/billing-usage/usage-limits)).                                                                                                                                                                                                                                                                              |
| Cerebras                         | No permanent free tier: $5 of credits, expiring after 30 days, after adding a payment method ([Rate limits](https://inference-docs.cerebras.ai/support/rate-limits)).                                                                                                                                                                                                                                                             |
| OpenRouter `:free` models        | 50 requests a day for accounts that bought fewer than 10 credits ([Limits](https://openrouter.ai/docs/api_reference/limits)).                                                                                                                                                                                                                                                                                                     |
| SambaNova Cloud                  | 20 requests a day on the free tier ([Rate limits](https://docs.sambanova.ai/docs/en/models/rate-limits)).                                                                                                                                                                                                                                                                                                                         |
| Groq as the primary              | 200,000 tokens a day is about 32 uncached calls; it relies on prompt caching to cover a typical day; hence optional second provider only.                                                                                                                                                                                                                                                                                         |
| OVHcloud AI Endpoints, anonymous | 2 requests a minute per IP and per model with no daily cap ([capabilities](https://docs.ovhcloud.com/en/guides/public-cloud/ai-machine-learning/ai-endpoints-capabilities)), but presented for testing before production ([catalog](https://www.ovhcloud.com/en/public-cloud/ai-endpoints/catalog/)), with no contract and an IP shared with other Vercel customers.                                                              |
| Hugging Face Inference Providers | Free users get no monthly credits ([pricing](https://huggingface.co/docs/inference-providers/pricing)).                                                                                                                                                                                                                                                                                                                           |
| Cohere                           | Trial keys are limited to 1,000 calls a month ([rate limits](https://docs.cohere.com/docs/rate-limits)).                                                                                                                                                                                                                                                                                                                          |
| Z.ai                             | `GLM-4.7-Flash` and `GLM-4.5-Flash` are free ([pricing](https://docs.z.ai/guides/overview/pricing)), but the rate limits are published only behind a login, so the volume could not be checked.                                                                                                                                                                                                                                   |

### Notifications

Telegram is named by the specifications (D-30); no alternative was considered.

### Backup storage

| Candidate                       | Why it lost                                                                                                                                                                                                                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Private Vercel Blob store       | 1 GB shared with the project, a 30-day lockout after any Blob limit is exceeded, same provider as the application, and Hobby's model-training clause ([Blob usage and pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing)). Runner-up.                               |
| Backblaze B2                    | Free and card-less, but one more account ([pricing](https://www.backblaze.com/cloud-storage/pricing)).                                                                                                                                                                           |
| Cloudflare R2                   | An R2 subscription must be purchased through a checkout before any token can be created ([R2 get started](https://developers.cloudflare.com/r2/get-started/)); whether a card is needed is not stated, so it fails the safe reading of the card rule.                            |
| Telegram `sendDocument`         | The bot cannot delete messages older than 48 hours ([deleteMessage](https://core.telegram.org/bots/api#deletemessage)), and the bot terms exclude storage-like services ([Bot Platform Developer Terms](https://telegram.org/tos/bot-developers), section 5.2).                  |
| Google Drive                    | A Google account and OAuth; refresh tokens of apps in testing status expire after 7 days ([OAuth 2.0](https://developers.google.com/identity/protocols/oauth2)).                                                                                                                 |
| Supabase Storage                | Free projects pause after a week of inactivity ([Supabase pricing](https://supabase.com/pricing)).                                                                                                                                                                               |
| Files committed to a repository | Git history keeps every version; removing a file from history takes a history rewrite and GitHub Support for cached views ([Removing sensitive data](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)). |
| Secret gists                    | Not private: anyone with the URL can see them ([Creating gists](https://docs.github.com/en/get-started/writing-on-github/editing-and-sharing-content-with-gists/creating-gists)).                                                                                                |

## What failed a rule or could not be verified

- **Detection model**: Workers AI alone covers about 190 realistic calls a day (150 use 78%), but at
  the ceiling size of 8,000 tokens in and 1,000 out only about 124 fit and the rest wait for the
  renewal at 00:00 UTC and the queue's next resumption; it does not guarantee schema-valid answers, so every answer is validated. Groq, if
  added, has a consumer-use clause that leaves some ambiguity for a personal project, and publishes
  no daily reset time. Gemini is excluded for its EEA clause.
- **Scheduler fallback**: Vercel Schedules is in public beta; its Hobby limits may change.
- **Not verified**: Vercel's cold-start time and the exact name of its model-training opt-out;
  whether Neon bills its occasional availability checks; how punctual Cloudflare cron runs are and
  whether failed runs are retried; whether Groq's prompt caching works on the free plan as on paid
  ones; whether Telegram accepts the `*.vercel.app` certificate for webhooks, and its retry schedule;
  how long GitHub keeps deleted release assets in its own backups, and which permission its upload
  endpoint checks; the real quality of each model on this taxonomy (measured later, DET-56).

Each of these has a safe default in its sheet.
