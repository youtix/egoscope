# Accounts and keys: the hand-over list

This is the list the owner works through once the application is built: every account to create,
every key, token or secret to generate with its minimum permissions, the environment variable it
goes into and where it is entered. It holds **no real value**, and none must ever be added to the
repository, a commit, an issue, a GitHub Actions secret of the public repository or a chat message
(TRV-64). Keep a copy of every secret in a password manager (TRV-75 step 1).

The variable names are those of the application's environment schema and of `.env.example`; if a
name changes there, `.env.example` wins.

## Accounts

| Account    | New or existing | Sign-in                                            | Used for                                                                                                                    | Needed from |
| ---------- | --------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Vercel     | New             | "Continue with GitHub"                             | Hosting, fallback scheduler ([hosting.md](hosting.md))                                                                      | Lot 1       |
| Neon       | New             | "Sign up with GitHub"                              | Database ([database.md](database.md))                                                                                       | Lot 1       |
| Cloudflare | New             | Email and password, with two-factor authentication | Primary scheduler (lot 1), detection model (lot 2) ([scheduler.md](scheduler.md), [detection-model.md](detection-model.md)) | Lot 1       |
| Groq       | New, optional   | GroqCloud console sign-up                          | Second detection provider, used only when `GROQ_API_KEY` is set ([detection-model.md](detection-model.md))                  | Lot 2       |
| GitHub     | Existing        | -                                                  | Code (public), backups (private repository) ([backup-storage.md](backup-storage.md))                                        | Lot 1       |
| Telegram   | Existing        | -                                                  | Notifications through a bot ([telegram.md](telegram.md))                                                                    | Lot 2       |

**Three new accounts are required: Vercel, Neon and Cloudflare.** Groq is optional. The statistics
source needs no account and no key ([statistics-source.md](statistics-source.md)). No account anywhere needs a payment card: never
enter one, never start a trial (TRV-01, TRV-02).

## 1. Vercel

1. Sign up with "Continue with GitHub" and stay on **Hobby**. Do not start the Pro trial.
2. Import the code repository as a new project. The function region (`fra1`) comes from
   `vercel.json` and the Node.js version from `package.json`.
3. Team settings: **opt out of model training** (Hobby content can otherwise be used to train AI
   models, see [hosting.md](hosting.md); the exact label of the setting was not verified).
4. Project settings, Deployment Protection: keep **Standard Protection**.
5. Project settings, Environment Variables: keep **Enable access to System Environment Variables**
   checked. The application reads `VERCEL_ENV` and `VERCEL_DEPLOYMENT_ID` from it, and Vercel makes
   no deployment ID available when the setting is off
   ([System environment variables](https://vercel.com/docs/environment-variables/system-environment-variables)).
6. Project settings, Environment Variables: enter the Vercel variables listed below for the
   **Production** environment only. Preview deployments carry no database variables, so they never
   reach the single production database (TRV-78); the application reports them as not configured.
7. Note the production address `https://<project>.vercel.app`: it is `APP_BASE_URL` and the base of
   `TICK_URL`.

## 2. Neon

1. Sign up with "Sign up with GitHub" directly at Neon, not through the Vercel Marketplace (see
   [database.md](database.md)). Stay on the **Free** plan.
2. Create one project in **AWS Europe (Frankfurt)**, `aws-eu-central-1`.
3. Compute settings: autoscaling minimum and maximum both **0.25 CU**.
4. Connect dialog: copy the **pooled** connection string (host name with `-pooler`) into
   `DATABASE_URL` and the **direct** one into `DATABASE_URL_UNPOOLED`.

## 3. Cloudflare

1. Sign up with email and password and turn on two-factor authentication. The account starts on
   **Workers Free**; never subscribe to Workers Paid or add a card.
2. **Tick Worker** (lot 1): Workers and Pages, create a Worker from the "Hello World" template, for
   example `egoscope-tick`; replace its code with the snippet in [scheduler.md](scheduler.md).
   Settings, Variables and Secrets: add the text variable `TICK_URL` and the secret `CRON_SECRET`.
   Settings, Triggers: add the Cron Trigger `*/5 * * * *`.
3. **Workers AI token** (lot 2): on the Workers AI page, choose "Use REST API", then "Create a Workers
   AI API Token". A custom token needs only **Workers AI Read** and **Workers AI Edit**. Copy the
   token into `CLOUDFLARE_AI_API_TOKEN` and the account ID shown on the same page into
   `CLOUDFLARE_ACCOUNT_ID`.

## 4. Groq (optional)

Without a Groq key the detection runs on Workers AI alone, which the application fully supports:
an unusable answer gets its further attempt on Workers AI itself, and once Workers AI's daily
allocation is used up the remaining articles wait in the queue, in priority order and without loss,
until it renews at 00:00 UTC (DET-08). With a key, Groq becomes the second provider of the chain
and takes that overflow and those further attempts ([detection-model.md](detection-model.md)).

1. Sign up at the GroqCloud console and stay on the **Free** tier: upgrading to the Developer tier
   requires a payment method, which must never be added.
2. Create one API key, for example `egoscope`, and copy it into `GROQ_API_KEY`.
3. Optional: in Data Controls, switch off the retention of inputs and outputs if the console offers
   it on the free tier (not verified).

## 5. GitHub (existing account)

1. Create a new **private** repository for backups only, for example `egoscope-backups`, with a
   README. In its settings, leave immutable releases **off**.
2. Settings, Developer settings, Personal access tokens, Fine-grained tokens, Generate new token:
   - name: for example `egoscope-backups`;
   - resource owner: the owner's own account;
   - expiration: **No expiration**, or one year with a reminder to renew it;
   - repository access: **Only select repositories**, the backup repository alone;
   - repository permissions: **Contents: Read and write**, nothing else (Metadata read-only is
     included automatically).
3. Copy the token into `BACKUP_GITHUB_TOKEN` and `owner/egoscope-backups` into
   `BACKUP_GITHUB_REPOSITORY`. The token must never grant access to the public code repository.

## 6. Telegram (existing account)

1. In Telegram, open @BotFather and send `/newbot`; choose the display name and a username ending in
   `bot`.
2. Copy the token into `TELEGRAM_BOT_TOKEN`.
3. Send `/setjoingroups` and choose Disable.
4. After deploying, link the chat from the application's notification settings and ask for the test
   message (TEL-29, TRV-47). If the token ever leaks, send `/token` to BotFather for a new one and
   replace the variable.

## Secrets the owner generates

These come from no provider. Generate each with Node.js, which the toolchain already needs:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

| Secret                    | How                                                                                                                                            | Goes into                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `CRON_SECRET`             | The command above (43 characters, safe in an HTTP header)                                                                                      | Vercel **and** the Cloudflare tick Worker                                        |
| `TELEGRAM_WEBHOOK_SECRET` | The command above                                                                                                                              | Vercel                                                                           |
| `BACKUP_ENCRYPTION_KEY`   | The command above with `base64` instead of `base64url`                                                                                         | Vercel, and a copy in the password manager: without it no backup can be restored |
| `FINGERPRINT_KEY`         | The command above; keys the temporary fingerprint of a withdrawn event (owner decision on Q-DSN-01)                                            | Vercel                                                                           |
| `INITIAL_PASSWORD`        | Chosen by the owner, at least 12 characters (TRV-60); replaced at first sign-in (TRV-57) and used again to reset a forgotten password (TRV-63) | Vercel                                                                           |

There is **no session secret**: sessions are random tokens stored hashed in the database, so nothing
signs them.

## Environment variables

### Vercel, Production environment, set by the owner

| Variable                   | Value comes from                                                                         | Required | Secret | Lot | Sheet                                        |
| -------------------------- | ---------------------------------------------------------------------------------------- | -------- | ------ | --- | -------------------------------------------- |
| `APP_BASE_URL`             | `https://<project>.vercel.app`                                                           | Yes      | No     | 1   | [hosting.md](hosting.md)                     |
| `DATABASE_URL`             | Neon, pooled connection string                                                           | Yes      | Yes    | 1   | [database.md](database.md)                   |
| `DATABASE_URL_UNPOOLED`    | Neon, direct connection string                                                           | Yes      | Yes    | 1   | [database.md](database.md)                   |
| `CRON_SECRET`              | Generated                                                                                | Yes      | Yes    | 1   | [scheduler.md](scheduler.md)                 |
| `INITIAL_PASSWORD`         | Chosen by the owner                                                                      | Yes      | Yes    | 1   | [hosting.md](hosting.md)                     |
| `FINGERPRINT_KEY`          | Generated                                                                                | Yes      | Yes    | 1   | This page                                    |
| `BACKUP_GITHUB_REPOSITORY` | `owner/egoscope-backups`                                                                 | Yes      | No     | 1   | [backup-storage.md](backup-storage.md)       |
| `BACKUP_GITHUB_TOKEN`      | GitHub fine-grained token                                                                | Yes      | Yes    | 1   | [backup-storage.md](backup-storage.md)       |
| `BACKUP_ENCRYPTION_KEY`    | Generated                                                                                | Yes      | Yes    | 1   | [backup-storage.md](backup-storage.md)       |
| `LOG_LEVEL`                | `debug`, `info`, `warn` or `error`; default `info`                                       | No       | No     | 1   | The application itself                       |
| `STATS_SOURCE_BASE_URL`    | A mirror or test address of the statistics files; by default the source's public address | No       | No     | 1   | [statistics-source.md](statistics-source.md) |
| `CLOUDFLARE_ACCOUNT_ID`    | Cloudflare, Workers AI page                                                              | Yes      | No     | 2   | [detection-model.md](detection-model.md)     |
| `CLOUDFLARE_AI_API_TOKEN`  | Cloudflare, Workers AI token                                                             | Yes      | Yes    | 2   | [detection-model.md](detection-model.md)     |
| `GROQ_API_KEY`             | GroqCloud console; without it the model chain is Workers AI alone                        | No       | Yes    | 2   | [detection-model.md](detection-model.md)     |
| `TELEGRAM_BOT_TOKEN`       | BotFather                                                                                | Yes      | Yes    | 2   | [telegram.md](telegram.md)                   |
| `TELEGRAM_WEBHOOK_SECRET`  | Generated                                                                                | Yes      | Yes    | 2   | [telegram.md](telegram.md)                   |

### Set by the repository, never by the owner

| Variable         | What it does                                                                                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EGOSCOPE_LOT`   | Build-time lot switch: 1 until the Lot 2 milestone, then 2. The build configuration sets it.                                                                                        |
| `EGOSCOPE_FAKES` | Replaces outside services with fakes (a comma-separated list of ports, or `all`), for development and the hermetic end-to-end tests only; the application refuses it in production. |

### Read from Vercel, never set

| Variable               | What it is                                                                       |
| ---------------------- | -------------------------------------------------------------------------------- |
| `VERCEL_ENV`           | `production`, `preview` or `development`, available at build time and at runtime |
| `VERCEL_DEPLOYMENT_ID` | The deployment's unique identifier, available at build time and at runtime       |

Both are system environment variables
([System environment variables](https://vercel.com/docs/environment-variables/system-environment-variables)),
present only while the project setting of step 5 above stays enabled.

### Cloudflare tick Worker

| Variable      | Value                                   | Type in Cloudflare |
| ------------- | --------------------------------------- | ------------------ |
| `TICK_URL`    | `https://<project>.vercel.app/api/tick` | Text               |
| `CRON_SECRET` | The same value as in Vercel             | Secret             |

A change to a Vercel variable takes effect at the next deployment; for `CRON_SECRET`, Vercel
Schedules keeps sending the value of the current deployment until then
([Handling scheduled runs](https://vercel.com/docs/schedules/handle-runs)), so update the Worker and
redeploy together.

## If a secret leaks

| Secret                                  | What to do                                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | Reset the database role's password in Neon, copy both new strings, redeploy                                                           |
| `CRON_SECRET`                           | Generate a new value, update Vercel and the Worker, redeploy                                                                          |
| `CLOUDFLARE_AI_API_TOKEN`               | Roll or delete the token in Cloudflare and create a new one                                                                           |
| `GROQ_API_KEY`                          | Delete the key in the GroqCloud console and create a new one, or remove the variable to run on Workers AI alone                       |
| `TELEGRAM_BOT_TOKEN`                    | Send `/token` to BotFather, update the variable, redeploy                                                                             |
| `TELEGRAM_WEBHOOK_SECRET`               | Generate a new value, redeploy; the installation check registers it again                                                             |
| `BACKUP_GITHUB_TOKEN`                   | Revoke it in GitHub's token settings and generate a new one with the same scope                                                       |
| `BACKUP_ENCRYPTION_KEY`                 | Generate a new key, redeploy, run a backup by hand; keep the old key until the last backup made with it is deleted, eight weeks later |
| `INITIAL_PASSWORD`                      | Set a new value and redeploy: the reset of TRV-63 applies                                                                             |
