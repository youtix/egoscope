# Hosting: Vercel Hobby

| Item         | Value                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------- |
| Role         | Runs the whole Next.js application (interface, server code, tick endpoint, Telegram hook) |
| Decision     | Vercel Hobby, functions in Frankfurt (`fra1`), Node.js runtime (not Bun)                  |
| Status       | Pre-selected by the owner; verified, passes every rule                                    |
| Date checked | 2026-11-11                                                                                |

## Role

Vercel hosts the installable web application (TRV-13, TRV-21): it builds the Next.js project from
the public GitHub repository, serves the interface over HTTPS at the free address
`https://<project>.vercel.app` (TRV-01, TRV-59), and runs the server code as Vercel Functions:
pages, server actions, the secret-protected tick endpoint that the scheduler calls (TRV-65, see
[scheduler.md](scheduler.md)) and the Telegram webhook (see [telegram.md](telegram.md)). Secrets
live in the project's environment variables, never in the code (TRV-64). Two smaller Vercel
features are also used: the Runtime Cache, which lets idle ticks avoid waking the database (see
[database.md](database.md)), and Vercel Schedules, the scheduler's fallback.

## Plan and cost

- **Plan**: Hobby, $0 per month, which Vercel describes as its free plan for developers' personal
  projects ([Hobby plan](https://vercel.com/docs/plans/hobby), updated 2026-09-14).
- **No payment card**: a Hobby account cannot buy additional usage
  ([pricing FAQ](https://vercel.com/pricing), "Can I buy additional usage?"); card details are asked
  only when upgrading to Pro ([Hobby plan, Upgrading to Pro](https://vercel.com/docs/plans/hobby)).
  So going over a limit never produces a bill: the feature stops instead.
- **Not a trial**: Hobby has no end date. Vercel's 14-day Pro trial is a different offer and must
  not be started.

## Account needed

A Vercel account on the Hobby plan, created with "Continue with GitHub" so that no new password is
needed. The project imports the owner's repository. Hobby projects can only connect to repositories
owned by a personal account, not by a GitHub organization, which is the case here
([Limits](https://vercel.com/docs/limits), "Connecting a project to a Git repository").

## Limits

| Limit                     | Hobby value                                               | Source                                                                                                    |
| ------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Function invocations      | 1,000,000 per month                                       | [Hobby plan](https://vercel.com/docs/plans/hobby)                                                         |
| Active CPU                | 4 CPU-hours per month                                     | [Hobby plan](https://vercel.com/docs/plans/hobby)                                                         |
| Provisioned memory        | 360 GB-hours per month                                    | [Hobby plan](https://vercel.com/docs/plans/hobby)                                                         |
| Fast Data Transfer        | 100 GB per month                                          | [Hobby plan](https://vercel.com/docs/plans/hobby)                                                         |
| Fast Origin Transfer      | 10 GB per month                                           | [Hobby plan](https://vercel.com/docs/plans/hobby)                                                         |
| CDN requests              | 1,000,000 per month                                       | [Hobby plan](https://vercel.com/docs/plans/hobby)                                                         |
| Function maximum duration | 300 s (default and maximum)                               | [Functions limitations](https://vercel.com/docs/functions/limitations), updated 2026-08-24                |
| Function memory and CPU   | 2 GB and 1 vCPU, fixed                                    | [Functions limitations](https://vercel.com/docs/functions/limitations)                                    |
| Request or response body  | 4.5 MB; streamed responses are exempt                     | [Functions limitations](https://vercel.com/docs/functions/limitations)                                    |
| Function bundle           | 250 MB uncompressed                                       | [Functions limitations](https://vercel.com/docs/functions/limitations)                                    |
| File descriptors          | 1,024, shared across concurrent executions                | [Functions limitations](https://vercel.com/docs/functions/limitations)                                    |
| Function regions          | One region (default `iad1`, changeable)                   | [Configuring regions](https://vercel.com/docs/functions/configuring-functions/region), updated 2026-08-11 |
| Deployments               | 100 per day                                               | [Limits](https://vercel.com/docs/limits)                                                                  |
| Build time                | 45 minutes per deployment                                 | [Limits](https://vercel.com/docs/limits)                                                                  |
| Concurrent deployments    | 1                                                         | [Limits](https://vercel.com/docs/limits)                                                                  |
| Runtime logs kept         | 1 hour                                                    | [Limits](https://vercel.com/docs/limits)                                                                  |
| Environment variables     | 64 KB in total per deployment                             | [Limits](https://vercel.com/docs/limits)                                                                  |
| Runtime Cache             | 1,000,000 reads and 200,000 writes per month              | [Runtime Cache](https://vercel.com/docs/runtime-cache), updated 2026-08-28                                |
| Runtime Cache item        | 2 MB; unit of 8 KB; entries can be evicted (LRU)          | [Runtime Cache](https://vercel.com/docs/runtime-cache)                                                    |
| Cron Jobs (legacy)        | 100 per project, at most once a day, within ±59 min       | [Cron Jobs usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing), updated 2026-07-15    |
| Schedules (public beta)   | Every 15 min at most, 15-min jitter, 5,000 runs per month | [Schedules limits](https://vercel.com/docs/schedules/limits)                                              |

## Our expected use and the margin

Estimates for one user, ticks every 5 minutes from the primary scheduler and every 15 minutes from
the fallback. The application measures the real figures during the first weeks (TRV-08).

| Resource             | Expected use per month                                                                                                                        | Allowance | Margin    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------- |
| Function invocations | About 12,000 ticks + a few thousand page and API requests: about 20,000                                                                       | 1,000,000 | ~98%      |
| Active CPU           | Waiting for the database or the model does not count; estimated well under 1 CPU-hour                                                         | 4 CPU-h   | >75%      |
| Provisioned memory   | 2 GB × wall time; idle ticks of a fraction of a second, two detection runs of a few minutes a day, statistics, interface: about 20 to 40 GB-h | 360 GB-h  | ~90%      |
| Function duration    | Every task works in resumable chunks of less than 300 s (TRV-30)                                                                              | 300 s     | by design |
| Data transfer        | One user's pages and a weekly backup upload of at most 50 MB                                                                                  | 100 GB    | >99%      |
| Runtime Cache        | About 12,000 reads and 12,000 writes: one of each per tick (wake plan, last tick), plus wake-plan updates                                     | 1M / 200K | >90%      |
| Deployments          | A few per week                                                                                                                                | 100 a day | >95%      |

The wall-time figure assumes a detection run does not sleep inside a function while waiting for a
model's rate limit: a chunk stops and the next tick resumes it.

## Terms on personal use and automated access

- **Personal use is the intended use.** The Terms of Service limit Hobby to "your personal or
  non-commercial use" ([Terms of Service](https://vercel.com/legal/terms), section 4, "Hobby Plan",
  last updated 2026-10-19). The fair use guidelines define commercial use as deployments run for
  financial gain (payments, advertising, paid work); this application has none
  ([Fair use guidelines](https://vercel.com/docs/limits/fair-use-guidelines), updated 2026-09-14).
- **Automated access.** Functions that query databases or APIs are listed as fair use; scheduled
  calls are first-party features (Cron Jobs, Schedules) and nothing forbids an outside scheduler
  calling a route ([Fair use guidelines](https://vercel.com/docs/limits/fair-use-guidelines)).
- **Scraping is excluded**: the fair use guidelines list scrapers as never fair use, and the
  [Acceptable Use Policy](https://vercel.com/legal/acceptable-use-policy), section 2, forbids
  scraping. Reading a handful of public syndication feeds twice a day is what feeds are published
  for, and the application never fetches article pages (COL-26), so it is not scraping; the
  interpretation is Vercel's, so it is recorded as a risk below.
- **Model training.** On Hobby, Vercel may use the customer's content to train AI models and share
  it with third parties for that purpose, unless the owner opts out in the team settings
  ([Terms of Service](https://vercel.com/legal/terms), section 3). The owner must opt out (see
  [accounts-and-keys.md](accounts-and-keys.md)).
- **Discretion.** Vercel may change or discontinue Hobby, and may disable, remove or shut down Hobby
  projects with or without notice ([Terms of Service](https://vercel.com/legal/terms), section 4).

## Inactivity policy

The Terms of Service reserve the right to terminate accounts inactive for an extended period, with
no duration given, and content may be permanently deleted on termination
([Terms of Service](https://vercel.com/legal/terms), section 19.1, "Term"). Normal use keeps the
account active: ticks every 5 minutes, regular visits and deployments. The application's data does
not live on Vercel (it is in Neon) and backups are on GitHub, so even a lost Vercel account loses no
data (TRV-11, TRV-14).

## Data we send

- The code, already public on GitHub.
- The environment variables: database connection strings, service keys, the Telegram token, the
  tick secret, the backup token and key, the initial password (TRV-64).
- All HTTP traffic of the application, including the owner's data as it is rendered or submitted.
- Runtime logs, kept 1 hour, which by rule contain no secret and no sensitive content (TRV-44).
- Runtime Cache entries: only the tick's wake plan (instants and task names, no personal data).

## Availability in France

Available. Function regions include Paris (`cdg1`, AWS `eu-west-3`) and Frankfurt (`fra1`, AWS
`eu-central-1`) ([Regions](https://vercel.com/docs/regions), updated 2026-08-11). Run the functions
in **`fra1`**: Neon has no Paris region and its Frankfurt region is `aws-eu-central-1` (see
[database.md](database.md)), and Vercel advises running functions next to the database
([Configuring regions](https://vercel.com/docs/functions/configuring-functions/region)). The setting
goes in `vercel.json` as `"regions": ["fra1"]`.

## How it is called

- **Deployment**: Git integration; every push to the default branch deploys to production.
- **Runtime: Node.js, not Bun.** The Bun runtime is marked Beta on all plans, and its current line
  `1.4.x` is a complete rewrite of Bun with breaking changes
  ([Bun runtime](https://vercel.com/docs/functions/runtimes/bun), updated 2026-08-24). The owner's
  rule is Bun in production only if stable, so production runs on Node.js. Vercel offers Node.js
  26.x (default), 24.x and 22.x and follows `engines.node` in `package.json`
  ([Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)). The
  toolchain pins Node.js 22, which Vercel deploys as the latest 22.x. Node.js 22 reaches end of life
  on 2027-04-30 and 24 on 2028-04-30 ([Node.js release schedule](https://github.com/nodejs/Release)).
  Vercel disabled Node.js 20 for new deployments on 2026-10-01, five months after its end of life
  ([Node.js 20 deprecation](https://vercel.com/changelog/node-js-20-is-being-deprecated)): plan the
  move to 24.x before April 2027. Bun stays the package manager and script runner.
- **Fluid compute helpers** from `@vercel/functions`: `attachDatabasePool` for the database pool
  (see [database.md](database.md)), `getCache` for the Runtime Cache, and `waitUntil` (or Next.js
  `after()`) to finish a chunk after answering the tick quickly.
- **Use the production domain** for everything that calls the application from outside (scheduler,
  Telegram webhook). Standard Protection, available on every plan, protects every domain except
  production domains, so generated deployment URLs require a Vercel login
  ([Deployment Protection](https://vercel.com/docs/deployment-protection), updated 2026-09-15). Keep
  Standard Protection on: previews stay private, production stays reachable.
- **Large downloads are streamed.** The 4.5 MB limit does not apply to streamed responses, so the
  full export (TRV-52) and any backup download must be streamed.
- **No preview database.** Set the database variables for the Production environment only, so a
  preview deployment can never write to the single production database (TRV-78).
- **Wake-up delay on a visit (TRV-13).** Vercel does not put the application to sleep; functions
  start on demand. The database compute does sleep: Neon reactivates it within a few hundred
  milliseconds, a little more after 7 idle days
  ([Compute lifecycle](https://neon.com/docs/introduction/compute-lifecycle)). Vercel publishes no
  cold-start figure, so the total delay is not verified; the application measures it in its first
  weeks (TRV-08) and the documentation states the measured value.

### Environment variables

All are set in Vercel, Project Settings, Environment Variables, for Production only. The full list
with where each value comes from is in [accounts-and-keys.md](accounts-and-keys.md).

| Variable                                                                   | Used by                                  |
| -------------------------------------------------------------------------- | ---------------------------------------- |
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED`                                    | [database.md](database.md)               |
| `CRON_SECRET`                                                              | [scheduler.md](scheduler.md)             |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_API_TOKEN`, `GROQ_API_KEY`         | [detection-model.md](detection-model.md) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`                            | [telegram.md](telegram.md)               |
| `BACKUP_GITHUB_REPOSITORY`, `BACKUP_GITHUB_TOKEN`, `BACKUP_ENCRYPTION_KEY` | [backup-storage.md](backup-storage.md)   |
| `APP_BASE_URL`, `INITIAL_PASSWORD`, `FINGERPRINT_KEY`                      | The application itself                   |

## When a quota is hit

- **Monthly allowances** (invocations, CPU, memory, transfer): the feature becomes unusable until
  30 days have passed, with no charge ([Hobby plan](https://vercel.com/docs/plans/hobby), "Hobby
  billing cycle"); the Terms also allow immediate termination for exceeding limits
  ([Terms of Service](https://vercel.com/legal/terms), section 19.1). The application cannot report
  its own outage (TRV-32): the status screen shows the age of the last successful run at the next
  visit.
- **Duration**: a function still running at 300 s ends with `504 FUNCTION_INVOCATION_TIMEOUT`; the
  next tick resumes the chunk without loss or duplicate (TRV-30).
- **Body size**: a request or a non-streamed response over 4.5 MB fails with
  `413 FUNCTION_PAYLOAD_TOO_LARGE`.
- **Runtime Cache**: over its allowance it is paused for the rest of the period
  ([Runtime Cache](https://vercel.com/docs/runtime-cache)); idle ticks then fall back to the bounded
  database check described in [scheduler.md](scheduler.md).
- **Schedules**: above 5,000 runs a month, scheduled runs are skipped until the next period
  ([Schedules limits](https://vercel.com/docs/schedules/limits)).

## Quota parameters to enter (TRV-03)

| Parameter                  | Value to enter                |
| -------------------------- | ----------------------------- |
| Function invocations       | 1,000,000 per month           |
| Active CPU                 | 4 hours per month             |
| Provisioned memory         | 360 GB-hours per month        |
| Function maximum duration  | 300 seconds                   |
| Runtime Cache reads/writes | 1,000,000 / 200,000 per month |

Vercel's usage is visible in the dashboard; the application can count its own invocations and
durations, not Vercel's metering, so these are mainly shown for reference on the status screen.

## Replaceable by

Any host that runs a Next.js server application with HTTPS, environment variables and an outside
scheduler. The Vercel-specific helpers (`@vercel/functions`, Runtime Cache, Schedules) sit behind
the application's own interfaces with a plain fallback, so another host only changes the
deployment, not the features. Procedure (TRV-77): export, deploy the same commit on the new host,
copy the environment variables, point the scheduler and the Telegram webhook at the new address, run
the installation check (TRV-47). Cloudflare Workers is not a drop-in replacement on its free plan:
it allows 10 ms of CPU per request ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)),
too little for server rendering. No alternative host was evaluated in depth, since Vercel passes.

## Date checked

2026-11-11.

## What was verified and how

Every value above comes from the official pages linked in this sheet, read on 2026-11-11 without
logging in: Hobby plan, pricing, limits, function limitations, Bun runtime, Node.js versions, regions,
deployment protection, Runtime Cache, Cron Jobs, Schedules, fair use guidelines and Terms of Service.
Node.js end-of-life dates come from the Node.js release schedule. No account was created. Not
verified: a published cold-start time for Vercel Functions, and the exact name of the model-training
opt-out setting in the dashboard.

## Risks

- **Hobby is discretionary**: Vercel may change its limits, end the plan, or shut a Hobby project
  down without notice. Mitigation: the data is elsewhere and the replacement path is documented.
- **Model training on Hobby content** unless the owner opts out.
- **Fair use wording on scrapers**: the feed collection reads public syndication feeds only, but the
  final judgment is Vercel's.
- **Runtime logs last 1 hour**: diagnosis relies on the application's own journal (TRV-41).
- **Node.js 22 end of life on 2027-04-30**: upgrade to 24.x before Vercel blocks new deployments.
- **Outbound IPs are not fixed on Hobby**: static egress addresses are a Pro and Enterprise feature
  ([Static IPs](https://vercel.com/docs/connectivity/static-ips)), so any service limiting by IP
  address sees requests from addresses shared with other Vercel customers.
