# Database: Neon Free

| Item         | Value                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------- |
| Role         | The application's only relational database (D-18, D-23)                                     |
| Decision     | Neon Free plan, one project in AWS Frankfurt (`aws-eu-central-1`), compute fixed at 0.25 CU |
| Status       | Pre-selected by the owner; verified, passes every rule under one design constraint          |
| Date checked | 2026-11-11                                                                                  |

## Role

Neon hosts the Postgres database that holds everything the application keeps: players, types and
sheets, backtest requests, historical and detected events, articles kept for detection, cases,
statistics, profiles, alerts, settings, the activity journal and the hashed password (TRV-14,
TRV-51). It is reached from the Vercel functions over TLS. The weekly backups are kept outside it, on
GitHub ([backup-storage.md](backup-storage.md)).

## Plan and cost

- **Plan**: Free, $0 per month ([Plans](https://neon.com/docs/introduction/plans), updated
  2026-11-04).
- **No payment card and no time limit**: the pricing page presents the Free plan as free with no
  time limit and no credit card ([Pricing](https://neon.com/pricing)).
- Do not add a card or enable any paid add-on: the Free plan is the target.

## Account needed

A Neon account, created at the Neon console with "Sign up with GitHub", so no new password; the
console supports Google, GitHub and other providers ([Accounts](https://neon.com/docs/manage/accounts)).

Create the account directly at Neon, not through the Vercel Marketplace. The Vercel-managed
integration creates a Neon account and an organization tied to the Vercel team, and Neon's project
transfer does not work into or out of such an organization
([Vercel-managed integration](https://neon.com/docs/guides/vercel-managed-integration), updated
2026-10-23). A direct account keeps the database independent of the host, which keeps hosting
replaceable (TRV-12). The connection strings are then copied into Vercel by hand.

## Limits

| Limit                   | Free plan value                                                    | Source                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Storage                 | 1 GB per project; 20 GB across all projects                        | [Plans](https://neon.com/docs/introduction/plans)                                                                            |
| Compute                 | 100 CU-hours per project per month (400 hours at 0.25 CU)          | [Plans](https://neon.com/docs/introduction/plans)                                                                            |
| Compute size            | Autoscaling up to 2 CU (8 GB RAM)                                  | [Plans](https://neon.com/docs/introduction/plans)                                                                            |
| Scale to zero           | After 5 minutes without active queries; cannot be disabled on Free | [Plans](https://neon.com/docs/introduction/plans), [Compute lifecycle](https://neon.com/docs/introduction/compute-lifecycle) |
| Cold start              | A few hundred milliseconds; slightly longer after 7 idle days      | [Compute lifecycle](https://neon.com/docs/introduction/compute-lifecycle), updated 2026-09-16                                |
| Public network transfer | 5 GB per project per month (egress)                                | [Plans](https://neon.com/docs/introduction/plans)                                                                            |
| Instant restore         | Up to 6 hours back, limited to 1 GB of change history              | [Plans](https://neon.com/docs/introduction/plans)                                                                            |
| Snapshots               | 1 manual snapshot; no scheduled backups on Free                    | [Plans](https://neon.com/docs/introduction/plans)                                                                            |
| Projects and branches   | 100 projects; 10 branches per project                              | [Plans](https://neon.com/docs/introduction/plans)                                                                            |
| Direct connections      | 112 at 0.25 CU, 105 of them available to the application           | [Connection pooling](https://neon.com/docs/connect/connection-pooling), updated 2026-10-19                                   |
| Pooled connections      | PgBouncer in transaction mode, up to 10,000 client connections     | [Connection pooling](https://neon.com/docs/connect/connection-pooling)                                                       |
| Encryption in transit   | TLS required on every connection                                   | [Connect securely](https://neon.com/docs/connect/connect-securely), updated 2026-06-05                                       |

## Our expected use and the margin

| Resource                | Expected use                                                                     | Allowance                  | Margin    |
| ----------------------- | -------------------------------------------------------------------------------- | -------------------------- | --------- |
| Storage                 | About 100 MB after several seasons (H-TRV-04)                                    | 1 GB                       | ~90%      |
| Public network transfer | Weekly backup reads of at most 100 MB, plus one user's pages: under 1 GB a month | 5 GB a month               | >80%      |
| Compute                 | 11 to 48 CU-hours a month at 0.25 CU (table below)                               | 100 CU-hours               | 52 to 89% |
| Connections             | A few at a time                                                                  | 105 direct / 10,000 pooled | >95%      |
| Branches                | 1 (plus a temporary one to test a restore)                                       | 10                         | 80%       |

### Design constraint: idle ticks must not wake the database

Compute is the only tight resource. Neon counts compute hours for as long as the compute is active
and suspends it 5 minutes after the last active query ([Compute lifecycle](https://neon.com/docs/introduction/compute-lifecycle)).
The scheduler calls the tick every 5 minutes ([scheduler.md](scheduler.md)), so **if every tick ran
a query, the compute would never sleep**: 0.25 CU × 730 hours = 182.5 CU-hours a month, over the
100 CU-hour allowance, and Neon would then suspend the database until the next month. Ticks every
15 minutes would still use about a third of every hour, around 60 CU-hours, before any real work.

The rule for the implementation: **an idle tick decides from a cached wake plan, without opening a
database connection.** After every pass that touches the database, the application writes the next
due instants (tasks, retries, reminders, queue resumption) to the Vercel Runtime Cache
([hosting.md](hosting.md)); an idle tick reads it and opens the database only when something is due,
when the entry is missing, or for a safety check at most once an hour. Any change that moves a due
instant (a setting, a new queue item, a failed send) rewrites the entry. The interface must not poll
the server either while it is open.

| Activity                                      | Wakes a day | Active minutes per wake (work + 5-minute tail) | Minutes a day       |
| --------------------------------------------- | ----------- | ---------------------------------------------- | ------------------- |
| Collection and detection, 16:30 and 23:00     | 2           | 20 to 40                                       | 40 to 80            |
| Statistics at 12:00 and match follow-up       | 1           | 15 to 25                                       | 15 to 25            |
| Purge at 04:00                                | 1           | 6                                              | 6                   |
| Weekly backup, Monday 05:00                   | 1/7         | 10                                             | about 1.5           |
| Classification queue resumption, if not empty | 0 to 4      | 6 to 10                                        | 0 to 40             |
| Telegram deferred messages and reminders      | 1 to 3      | 6                                              | 6 to 18             |
| Owner's visits                                | 2 to 5      | 10 to 15                                       | 20 to 75            |
| Safety checks by idle ticks, at most hourly   | 0 to 24     | 5.5                                            | 0 to 132            |
| **Total**                                     |             |                                                | **about 90 to 380** |

That is 45 to 190 active hours a month, so 11 to 48 CU-hours at 0.25 CU. Fix the compute at 0.25 CU
(minimum and maximum) so that a heavy query cannot autoscale and multiply the cost; 1 GB of RAM is
plenty for a 100 MB database.

## Terms on personal use and automated access

- **Contract.** Neon is now a Databricks product. Its terms are the
  [Product Specific Schedule (Neon)](https://neon.com/terms-of-service), last updated 2026-10-14, on
  top of the [Databricks Master Cloud Services Agreement](https://www.databricks.com/legal/mcsa),
  last updated 2026-02-20. The schedule contracts with individuals as well as companies: unless you
  act for a company, "Customer" refers to you as an individual.
- **Personal, non-commercial use**: no clause restricts the Free plan to commercial or evaluation
  use; the Free plan is described for prototypes and side projects
  ([Plans](https://neon.com/docs/introduction/plans)).
- **Automated access**: a database queried by an application is the product's purpose. The master
  agreement allows suspension only for breaches that may cause material harm or for unpaid fees
  ([Databricks Master Cloud Services Agreement](https://www.databricks.com/legal/mcsa), "Suspension").

## Inactivity policy

- **Compute**: suspends after 5 minutes idle; no data is lost and it wakes on the next query.
- **Branch archiving**: a branch older than 14 days and not accessed for 24 hours moves to cheaper
  storage and is unarchived automatically on the next access, which is slower
  ([Branch archiving](https://neon.com/docs/guides/branch-archiving)). The application touches its
  branch several times a day, so this should not happen.
- **No deletion of AWS-region projects for inactivity** was found in the plans page, the terms or the
  docs index. The only inactivity deletion found concerns the deprecated Azure regions, where Free
  projects inactive for 90 days or more are subject to deletion since 2026-10-05
  ([Regions](https://neon.com/docs/introduction/regions), updated 2026-10-14). Use an AWS region.

## Data we send

All of the application's data (TRV-51): public facts about players and events, statistics, profiles,
settings, the activity journal, the password hash and session records. No deployment secret is
stored in the database (TRV-64). Neon keeps a 6-hour history of changes, so an erased record
disappears from Neon's history within 6 hours.

## Availability in France

Available. Neon has no Paris region; its European regions are AWS Frankfurt (`aws-eu-central-1`) and
AWS London (`aws-eu-west-2`) ([Regions](https://neon.com/docs/introduction/regions)). Choose
**Frankfurt**, which matches the Vercel function region `fra1` (AWS `eu-central-1`), see
[hosting.md](hosting.md).

## How it is called

- **Driver**: node-postgres (`pg`) over TCP with a `Pool`, registered with `attachDatabasePool` from
  `@vercel/functions`. This is Neon's recommendation for Vercel Fluid compute: the pool reuses warm
  connections and closes idle ones before the instance is suspended
  ([Connecting to Neon from Vercel](https://neon.com/docs/guides/vercel-connection-methods), updated
  2026-06-05). Use `sslmode=verify-full` in the connection string, as Neon recommends
  ([Connect securely](https://neon.com/docs/connect/connect-securely)).
- **Interactive transactions** work: check a client out of the pool, run `BEGIN`, the queries and
  `COMMIT` on that client, then release it. Transaction-mode pooling keeps the whole transaction on
  one server connection.
- **What the pooled connection does not support**: `SET` and `RESET`, `LISTEN` and `NOTIFY`, SQL-level
  `PREPARE`, temporary tables and session-level advisory locks
  ([Connection pooling](https://neon.com/docs/connect/connection-pooling)). Session state is also
  lost whenever the compute suspends ([Compute lifecycle](https://neon.com/docs/introduction/compute-lifecycle)).
  So the single-run guarantee of TRV-28 uses a lease row or `pg_advisory_xact_lock` inside a
  transaction, never a session-level lock.
- **Direct connection** for schema migrations (TRV-76) and for the backup export (TRV-50), which may
  need session features and long reads: Neon advises the direct string for migrations and dumps
  ([Connection pooling](https://neon.com/docs/connect/connection-pooling)).
- **Fallback driver**: `@neondatabase/serverless` over HTTP (single queries and non-interactive
  transactions) or WebSockets (`Pool`, interactive transactions) if the code ever runs outside Fluid
  compute ([Serverless driver](https://neon.com/docs/serverless/serverless-driver), updated
  2026-10-05).
- **Export and restore** (TRV-52, TRV-53): the application's own TypeScript export reads every table
  through the direct connection; a developer can also run `pg_dump` with the same string. Neon's
  6-hour instant restore and its single manual snapshot are extra safety nets, not the backup.

### Environment variables

| Variable                | Value                                                                        | Secret |
| ----------------------- | ---------------------------------------------------------------------------- | ------ |
| `DATABASE_URL`          | Pooled connection string (host name contains `-pooler`), for the application | Yes    |
| `DATABASE_URL_UNPOOLED` | Direct connection string, for migrations and the backup export               | Yes    |

Both are copied from the Neon console's Connect dialog (with and without connection pooling) into
Vercel for the Production environment only. These are the names Neon's own Vercel integration uses
([Vercel-managed integration](https://neon.com/docs/guides/vercel-managed-integration)).

## When a quota is hit

Neon's plans page states that none of its Free limits deletes data
([Plans](https://neon.com/docs/introduction/plans), "What happens if I exceed my Free plan limits?"):

- **CU-hours or public network transfer used up**: the compute is suspended until the next billing
  period. The application cannot reach its database; the interface shows a clear outage message and
  the status screen, once back, shows the gap (TRV-32).
- **1 GB storage reached**: inserts, updates and deletes fail until space is freed. The application
  warns at 80% of capacity (TRV-07, H-TRV-03) and only purges data with a limited retention.
- **10 branches reached**: branch creation fails; the application creates none.

The application shows the database size from `pg_database_size()` against the 1 GB capacity
(TRV-07). It cannot read Neon's CU-hour metering without a Neon API key, which this design does not
require: it estimates its own active time, and the Neon console's usage page gives the exact figure.

## Quota parameters to enter (TRV-03)

| Parameter               | Value to enter         |
| ----------------------- | ---------------------- |
| Database capacity       | 1 GB                   |
| Compute                 | 100 CU-hours per month |
| Public network transfer | 5 GB per month         |

## Replaceable by

Any hosted Postgres reachable over TLS, at Neon or elsewhere. Procedure (TRV-77): download a full
export, create the new database, set `DATABASE_URL` and `DATABASE_URL_UNPOOLED`, restore into the
empty database (TRV-53), then run the installation check (TRV-47). Supabase's free plan was not
retained because free projects are paused after a week of inactivity
([Supabase pricing](https://supabase.com/pricing)).

## Date checked

2026-11-11.

## What was verified and how

Read on 2026-11-11, without logging in: Neon's plans, pricing, scale-to-zero, compute lifecycle,
connection pooling, serverless driver, Vercel connection methods, Vercel-managed integration,
regions, connect securely, branch archiving and accounts pages, the Neon product schedule and the
Databricks master agreement. No account was created. Not verified: whether Neon's occasional
availability checks on an idle compute count as billable time (the docs mention them without saying).

## Risks

- **Compute exhaustion** if any code path wakes the database on every tick or polls from the
  interface. This is the main risk; the design constraint above removes it.
- **5 GB monthly transfer**: repeated full exports or restores in one month could approach it.
- **6-hour history only**: anything older is recovered from the weekly backups.
- **Policy changes**: Neon now operates under Databricks terms, last revised in October 2026, and it
  made inactive Free projects subject to deletion when it retired its Azure regions; check this
  sheet before every deployment (TRV-10).
- **Single region**: no failover on the Free plan.
