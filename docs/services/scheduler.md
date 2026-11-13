# Scheduler trigger: Cloudflare Workers Cron, with Vercel Schedules as fallback

| Item         | Value                                                                                   |
| ------------ | --------------------------------------------------------------------------------------- |
| Role         | Calls the application's tick endpoint at a fixed interval (TRV-13, TRV-25, TRV-65)      |
| Primary      | A Cloudflare Worker with a Cron Trigger, every 5 minutes, on the Workers Free plan      |
| Fallback     | A Vercel Schedules static schedule, every 15 minutes, on Hobby (public beta)            |
| Rejected     | GitHub Actions (terms), Vercel Cron Jobs (once a day), cron-job.org and Upstash (below) |
| Date checked | 2026-11-11                                                                              |

## Role

The application exposes one secret-protected HTTPS endpoint, `/api/tick`, which accepts `GET` and
`POST` alike, so either caller may use either method. Something outside must call it often; the
application itself decides which tasks are due and works in resumable chunks (TRV-26 to TRV-31). By
default, in Paris time: the purge at 04:00, the backup on Monday at 05:00, the daily statistics
update from 15:00 (an hourly probe of the source that needs no database, then the update once the
source has refreshed, at 20:00 at the latest, ruling CL-TRV-23), collection and detection at 16:30
and 23:00; retries and reminders in between. The need: a call at least every 15 minutes, ideally
every 5 to 10, reliable and free.

Two callers run at the same time. The primary calls every 5 minutes; the fallback calls every 15
minutes, needs no new account, and keeps the application alive if the primary stops. The tick is
idempotent and single-flight, so a duplicate call does nothing (TRV-28, TRV-29).

**What the fallback alone means.** If only the fallback runs, up to about 30 minutes can pass between
two ticks: its schedule allows a run every 15 minutes and each run lands somewhere in a 15-minute
jitter window. Every scheduled start, Telegram retry and reminder can then be up to about 30 minutes
late, since work waits for the first tick after its due instant; no rule counts ticks, so nothing
else changes ([module map](../engineering/module-map.md), section 4.1). With the primary, the delay is
at most about 5 minutes.

## Plan and cost

- **Primary**: Cloudflare Workers Free plan, the default plan of every Cloudflare account
  ([Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)), free with no
  credit card required ([Cloudflare Workers](https://www.cloudflare.com/product/workers/)). It is
  a permanent free plan, not a trial.
- **Fallback**: Vercel Schedules, included in Hobby at no cost, in public beta since 2026-11-05
  ([announcement](https://vercel.com/changelog/vercel-schedules-is-now-in-public-beta)).

## Account needed

- **Cloudflare**: one account, email and password (turn on two-factor authentication). The same
  account also hosts the detection model ([detection-model.md](detection-model.md)), so the
  scheduler adds no account of its own.
- **Vercel**: the hosting account; nothing more.

## Limits

| Limit                               | Value                                                     | Source                                                                                  |
| ----------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Cron Triggers, Workers Free         | 5 per account                                             | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)            |
| CPU per cron invocation             | 10 ms (waiting on `fetch` does not count)                 | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)            |
| Duration of a cron invocation       | 15 minutes                                                | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)            |
| Subrequests per invocation          | 50                                                        | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)            |
| Requests, Workers Free              | 100,000 per day                                           | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)          |
| Cron time zone and changes          | UTC only; a change takes up to 15 minutes to propagate    | [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) |
| Vercel Schedules frequency on Hobby | Every 15 minutes at most; 15-minute jitter window, always | [Schedules limits](https://vercel.com/docs/schedules/limits)                            |
| Vercel Schedules runs on Hobby      | 5,000 per billing period, manual runs included            | [Schedules limits](https://vercel.com/docs/schedules/limits)                            |
| Vercel static schedules             | 100 per deployment                                        | [Schedules limits](https://vercel.com/docs/schedules/limits)                            |
| Vercel path-target retries          | None; a run can be delivered twice                        | [Handling scheduled runs](https://vercel.com/docs/schedules/handle-runs)                |

## Our expected use and the margin

| Caller                | Calls                                   | Allowance              | Margin |
| --------------------- | --------------------------------------- | ---------------------- | ------ |
| Cloudflare Cron       | 288 a day (every 5 minutes)             | 100,000 requests a day | >99%   |
| Cloudflare cron count | 1 trigger                               | 5 per account          | 80%    |
| Cloudflare CPU        | One `fetch`, about 1 to 2 ms (estimate) | 10 ms per invocation   | >80%   |
| Vercel Schedules      | 96 a day, at most 2,976 a month         | 5,000 runs a month     | ~40%   |

Every tick is a Vercel Function invocation: about 12,000 a month in total, 1.2% of the Hobby
allowance ([hosting.md](hosting.md)).

**Constraint on the tick handler**: an idle tick must not open a database connection, or the Neon
compute never sleeps and exhausts its 100 CU-hours a month. The handler reads a wake plan from the
Vercel Runtime Cache and opens the database only when the plan is missing, older than an hour,
written by another deployment, or due; see [database.md](database.md) for the figures.

## Terms on personal use and automated access

- **Cloudflare** names "calling third-party APIs to collect up-to-date data" as a use of Cron
  Triggers ([Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/),
  "Background"). The [Self-Serve Subscription Agreement](https://www.cloudflare.com/terms/), last
  updated 2025-09-12, is made with you or the entity you represent, so individuals are covered, and
  adds a Data Act addendum for individuals living in the European Union. Free Services are provided
  until Cloudflare ends them at its discretion (section 2.6). No clause restricts free use to
  evaluation or business.
- **Vercel Schedules** is a first-party Hobby feature for exactly this purpose; Hobby terms are in
  [hosting.md](hosting.md).

## Inactivity policy

- **Cloudflare**: no inactivity clause in the Self-Serve Subscription Agreement; a cron that runs
  every 5 minutes keeps the Worker in use anyway.
- **Vercel**: see [hosting.md](hosting.md). Schedules runs as long as the current production
  deployment declares it.

## Data we send

Only the tick URL (`https://<project>.vercel.app/api/tick`) and the tick secret. The secret is
stored as an encrypted Worker secret at Cloudflare and as the `CRON_SECRET` environment variable at
Vercel. The tick carries no application data; its response is a short status.

## Availability in France

Both run worldwide; nothing restricts France. Cron Triggers use UTC, which does not matter: the
application converts its own schedule from the owner's time zone, changes of daylight saving time
included (TRV-27).

## How it is called

### Primary: a Cloudflare Worker with a Cron Trigger

In the Cloudflare dashboard: create a Worker from the "Hello World" template, replace its code with
the snippet below, add the variable `TICK_URL` and the secret `CRON_SECRET` (Settings, Variables and
Secrets), then add the Cron Trigger `*/5 * * * *` (Settings, Triggers). The scheduled handler may
call an external URL with `fetch` ([Scheduled handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/)).
The snippet sends `POST`; `GET` would work as well.

```js
// Calls the application's tick endpoint. Cron Trigger: */5 * * * * (UTC).
export default {
  async scheduled(controller, env) {
    const response = await fetch(env.TICK_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.CRON_SECRET}`, 'x-tick-source': 'cloudflare' },
    });
    if (!response.ok) {
      throw new Error(`Tick answered ${response.status}`);
    }
  },
};
```

A failed tick then shows as an error in the Worker's past cron events. The snippet is plain
JavaScript, in line with the single-language rule (TRV-20); the implementation can keep it under
version control.

### Fallback: a Vercel static schedule

In `vercel.json`, with the `CRON_SECRET` environment variable set for Production. `POST` is the
default method of a path schedule; `"requestMethod": "GET"` would work as well:

```json
{
  "schedules": {
    "tick-backstop": { "schedule": "*/15 * * * *", "path": "/api/tick", "requestMethod": "POST" }
  }
}
```

Vercel sends `Authorization: Bearer <CRON_SECRET>` and the user agent `vercel-cron/1.0` with every
path request; `CRON_SECRET` must be a random string of at least 16 header-safe characters, and the
value sent is the one the current production deployment was built with, so a new secret takes effect
at the next deployment ([Handling scheduled runs](https://vercel.com/docs/schedules/handle-runs);
[Schedules configuration](https://vercel.com/docs/schedules/configuration)). Both callers use the
same secret.

### What the tick endpoint does

The flow is the design's ([module map](../engineering/module-map.md), section 1.6):

1. **Authenticate without the database**: compare `Authorization: Bearer <CRON_SECRET>` in constant
   time; a refusal answers `401` and is counted in the Runtime Cache, then journaled at the next
   database pass (TRV-65, CA-TRV-21).
2. **Answer at once**: `202` within a second or two, then continue with `after()` inside the
   300-second function limit.
3. **Suppress duplicates**: a tick less than a minute after the last accepted one stops there;
   otherwise the tick and its caller (`x-tick-source`, or the Vercel user agent) are recorded in the
   Runtime Cache, so the status screen can show a caller that has gone quiet (TRV-46).
4. **Decide from the wake plan, still without the database**: stop when nothing is due; run a
   database-free probe when the plan asks for one; go on only when the plan is missing, older than an
   hour, written by another deployment, or due.
5. **Open the database**: take the tick lease (a lease row, or `pg_advisory_xact_lock` inside a
   transaction, never a session-level lock, see [database.md](database.md)), run the due tasks in
   resumable chunks (TRV-28, TRV-30), run the execution check (TRV-31), then rewrite the wake plan.

An idle tick costs a few cache reads and one cache write: about 35,000 reads and 12,000 writes a
month for both callers, against 1,000,000 and 200,000 ([hosting.md](hosting.md)).

Use the production domain: Vercel's Standard Protection blocks the generated deployment URLs
([Deployment Protection](https://vercel.com/docs/deployment-protection)).

### Environment variables

| Where             | Variable      | Value                                                                            | Secret |
| ----------------- | ------------- | -------------------------------------------------------------------------------- | ------ |
| Vercel            | `CRON_SECRET` | 43 random base64url characters, see [accounts-and-keys.md](accounts-and-keys.md) | Yes    |
| Cloudflare Worker | `CRON_SECRET` | The same value                                                                   | Yes    |
| Cloudflare Worker | `TICK_URL`    | `https://<project>.vercel.app/api/tick`                                          | No     |

## When a quota is hit

- **Cloudflare**: a Worker over 10 ms of CPU fails with error 1102
  ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)); the 100,000
  requests a day are out of reach. Cloudflare publishes no retry for a failed cron run.
- **Vercel Schedules**: above 5,000 runs a month, scheduled runs are skipped until the next period
  ([Schedules limits](https://vercel.com/docs/schedules/limits)).
- **Either way**, a missed tick only delays work: at the next pass or visit the application finds
  any occurrence not run by its due instant plus the margin, records it, opens the "task not run"
  incident and runs the task (TRV-31). If both callers stop, the status screen shows how long ago
  each task last succeeded and each caller last called (TRV-32).

## Quota parameters to enter (TRV-03)

| Parameter                                     | Value to enter                              |
| --------------------------------------------- | ------------------------------------------- |
| Vercel Schedules runs                         | 5,000 per month                             |
| Expected interval of the primary (monitoring) | 5 minutes; the fallback's is 15 plus jitter |

## Replaceable by

The tick endpoint is a plain authenticated HTTPS call, so any scheduler that can send a header
replaces either caller with no code change:

- **cron-job.org**: free, up to one run a minute, custom headers, 30-second timeout, failure emails
  ([FAQ](https://cron-job.org/en/faq/)). It needs its own account, it disables a job after more than
  25 consecutive failures (about two hours of outage at 5 minutes), and its terms make users
  responsible for not sending security-critical secrets in headers and allow accounts to be locked
  without notice ([Terms](https://cron-job.org/en/tos/), sections 6 and 7). A good replacement if
  Cloudflare is ever dropped.
- **Vercel Cron Jobs (legacy)**: once a day on Hobby, within the hour
  ([Cron Jobs usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)); a last-resort
  daily backstop if Schedules leaves beta with worse limits.

## Date checked

2026-11-11.

## What was verified and how

Read on 2026-11-11, without logging in: Cloudflare's Cron Triggers, Workers limits, Workers pricing,
scheduled handler and product pages and the Self-Serve Subscription Agreement; Vercel's Schedules
limits, configuration, handling-runs and announcement pages and the Cron Jobs pricing page;
cron-job.org's FAQ, terms and contact pages; GitHub's Actions terms and schedule documentation;
Upstash's QStash pricing and terms; Google's Apps Script quotas. No account was created. Not
verified: how punctual Cloudflare cron runs are (the docs only say they run on underutilized
machines) and whether Cloudflare retries a failed run.

## Risks

- **One Cloudflare account for two roles**: if it is suspended, both the primary scheduler and the
  primary model stop. The fallbacks (Vercel Schedules, Groq) are on other providers.
- **Vercel Schedules is beta**: its Hobby limits may change before general availability, and a
  15-minute jitter can leave up to about 30 minutes between two of its runs (estimate).
- **No built-in failure alert** at Cloudflare's free tier is relied on; detection of a stopped
  scheduler rests on TRV-31 and the status screen.
- **Secret rotation** needs two edits (Vercel and the Worker) and a redeploy.
