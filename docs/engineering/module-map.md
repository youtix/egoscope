# Egoscope module map

**Status:** draft for integration. Names follow the owner's decisions and the spec digests; they will be aligned with `docs/engineering/glossary.md` once it is merged. Spec IDs (`JOU-04`, `TRV-31`…) point to the French specifications in `docs/`, which stay authoritative except where the [deviations register](spec-deviations.md) and the [decision records](../adr/README.md) change them ("ADR 0015" below). The statistics source is the one chosen in the [service sheet](../services/statistics-source.md) and its [evaluation](statistics-source-evaluation.md).

**How to use this map.** Find your spec file in §0, then your module in §2 or your screen in §3. §1 says what you may import, §7 is the checklist every task follows, §9 lists the shared files you must not edit and what to do instead. Lot 1 is the minimal app (players, types, backtest, import, statistics, profiles); Lot 2 adds the daily watch, alerts, tracking and Telegram.

Contents: [0 Find your place](#0-find-your-place) · [1 Layers and flows](#1-layers-and-flows) · [2 Module catalog](#2-module-catalog) · [3 Route catalog](#3-route-catalog) · [4 Scheduled tasks](#4-scheduled-tasks) · [5 Ports](#5-ports) · [6 Parameter registry](#6-parameter-registry) · [7 Cross-cutting rules](#7-cross-cutting-rules-for-implementers) · [8 Dependency graph](#8-dependency-graph) · [9 Shared files](#9-shared-files-and-how-to-avoid-collisions) · [10 Design choices and open points](#10-design-choices-and-open-points)

## 0. Find your place

| Spec file | Modules (`src/lib/…`) | Screens and handlers (`src/app/…`) |
|---|---|---|
| 00 Overview | `wording` (common states, VUE-08), `stats-engine` (VUE-03), `events` (VUE-04) | `/method` |
| 01 Followed players | `players`, `games` (stats-source link, indicators) | `/players`, `/players/new`, `/players/[playerId]` (+ `/edit`, `/delete`) |
| 02 Event taxonomy | `taxonomy`, `ai-exchange/exploration`, `data/seed/` | `/types/**` |
| 03 News collection (L2) | `collection`, `press-feeds` | `/collection/sources/**`, `/collection/runs/**` |
| 04 Event detection (L2) | `detection`, `language-model`, `ai-exchange/classification` | `/detected-events`, `/collection/queue`, `/collection/not-relevant`, `/collection/detection-log`, `/collection/instructions`, `/collection/articles/[articleId]` |
| 05 Backtest request and prompt | `backtests`, `ai-exchange/research-prompt`, `stats-engine/backtest` | `/backtests`, `/backtests/[requestId]` |
| 06 Research-result import | `imports`, `ai-exchange/research-result`, `drafts`, `link-check` | `/backtests/[requestId]/import`, `/events/[eventId]/edit` |
| 07 Game statistics | `games`, `stats-source`, `stats-engine/{performance,baseline,schedule}` | player-sheet blocks, `/status` |
| 08 Sensitivity and verdict | `sensitivity`, `stats-engine/{measured-game,cases,profiles}` | `/players/[playerId]/profiles/[typeId]`, `/profiles`, `/cases/[caseId]`, `/types/[typeId]/trend` |
| 09 Alert sheet (L2) | `alerts`, `stats-engine/alerts` | `/alerts`, `/alerts/[sheetId]` |
| 10 Tracking and validation (L2) | `tracking`, `stats-engine/tracking` | `/validation`, tracking block of `/cases/[caseId]` |
| 11 Telegram (L2) | `notifications`, `telegram`, `outbox` | `/settings/notifications`, `/api/telegram/webhook` |
| 12 Interface and access | `navigation`, `ui`, `offline`, `drafts`, `todo`, `auth` | every screen; `/`, `/more`, `/help`, `/sign-in`, `/choose-password` |
| 13 Sensitive data | `events` (whitelist, counter, fingerprint), `withdrawal`, `ai-exchange` (text rules) | `/events/[eventId]/withdraw`, `/players/[playerId]/delete` |
| 14 Cross-cutting | `env`, `db`, `time`, `params`, `journal`, `incidents`, `quotas`, `scheduler`, `tasks`, `auth`, `backups` | `/settings/**`, `/journal`, `/status`, `/api/tick`, `/api/health`, `/api/exports/[kind]` |
| Decision records | `calendar-events` (ADR 0015), `taxonomy` criterion switch (ADR 0016), `events` withdrawal fingerprint (ADR 0017), `backups` encryption (ADR 0018), collection hours (ADR 0019) | — |

## 1. Layers and flows

### 1.1 Layers

| Layer | Where | What lives there | May import |
|---|---|---|---|
| Routes | `src/app/**` | pages (React Server Components), `actions.ts` (Server Actions), `queries.ts` (page-only reads), `schema.ts` (form schemas), view and block components, route handlers (`route.ts`) | any `@/lib/<module>` |
| Composition | `src/lib/{withdrawal,todo,tasks}` | use cases that span many modules: event withdrawal, the to-do list, scheduled-task handlers | everything below |
| Domain | `src/lib/<domain>` (§2.4, §2.5) | entities, rules that need the database, read APIs | earlier domain modules (§1.3), machinery, pure core, ports |
| Machinery | `src/lib/{env,result,time,wording,ui,db,journal,params,outbox,incidents,quotas,scheduler,auth,drafts,offline,navigation,backups}` | services every feature uses | earlier machinery (§1.3); `backups` also uses a port |
| Pure core | `src/lib/stats-engine`, `src/lib/ai-exchange` | formulas, decision rules, AI exchange contracts and texts | nothing in `src/lib` |
| Ports | `src/lib/{stats-source,language-model,press-feeds,telegram,backup-storage,link-check}` | one interface, one fake, one or more real adapters per outside service | `env`, `result` |
| Database | Postgres through Drizzle; schema in `src/lib/db/schema/` | the tables of every module (Neon in production, PGlite in tests and development) | — |

### 1.2 Import rules

1. `src/lib` never imports `src/app`; a route folder never imports another route folder. Code that two routes need goes to `src/lib`. *(lint)*
2. A module is imported only as `@/lib/<module>` (its `index.ts`); no deep import, no relative import across modules. *(lint)*
3. No import cycle; a module imports only modules listed before it in §1.3. *(lint)*
4. At most two folder levels below `src/lib`; kebab-case names. Dynamic route segments (`[playerId]`) are camelCase because they become TypeScript properties. *(lint)*
5. `stats-engine` and `ai-exchange` import nothing from `src/lib`, use no Node or browser API, never read the clock and never convert time zones: instants arrive as epoch milliseconds, local dates as `YYYY-MM-DD` strings, parameters as a plain object built by the caller. *(lint)*
6. Only port modules make network calls, only `db` opens database connections, only `time` reads the clock, only `env` reads `process.env`. Server-only modules start with `import "server-only"`. *(lint + review)*
7. A table is written only by the module that owns it (§2, "Owns"). Any module may read any table through `@/lib/db` for lookups and joins; derived values (next game, profile values, coverage, profiled status, case state) are read through their owner's read API. *(review)*
8. Expected failures are returned as `Result` error values, never thrown; thrown errors mean bugs or infrastructure faults. *(review)*
9. **Lot boundary** ([ADR 0001](../adr/0001-build-both-lots-in-dependency-ordered-waves.md)): a Lot 1 domain module never imports a Lot 2 domain module or a Lot 2 port. Lot 2 reactions to Lot 1 actions are wired only in the composition layer (`withdrawal`, `todo`, `tasks`) or in a route's composed action (§1.7), behind the lot gate (`navigation.isLotActive(2)`). *(lint)*

### 1.3 Allowed order

A module may import only modules that appear earlier in this order.

1. **Machinery (no domain knowledge):** `env`, `result`, `time`, `wording` → `ui` → `db` → `journal` → `params` → `outbox` → `incidents` → `quotas` → `scheduler` → `auth` → `drafts` → `offline` → `navigation`.
2. **Pure core:** `stats-engine`, `ai-exchange` (independent of everything).
3. **Ports:** `stats-source`, `language-model`, `press-feeds`, `telegram`, `backup-storage`, `link-check`.
4. **Machinery using a port:** `backups`.
5. **Domain, Lot 1:** `events` → `players` → `games` → `sensitivity` → `calendar-events` → `taxonomy` → `backtests` → `imports`.
6. **Domain, Lot 2:** `collection` → `alerts` → `tracking` → `detection` → `notifications`.
7. **Composition:** `withdrawal` → `todo` → `tasks`.

Why this domain order: `events` is the lowest domain module — it stores events, and the modules that create or change them trigger the consequences. `sensitivity` reads events, games and type states as data and calls none of them back. `taxonomy` calls `sensitivity` after a merge, split, withdrawal or criterion switch, and `calendar-events` when a calendar-derived type is validated, reactivated or changed. `alerts` sits below `tracking` because tracking closes alert sheets with their outcome; `detection` is the highest Lot 2 producer because dismissal, routing and corrections call `sensitivity`, `alerts`, `tracking` and `backtests`.

### 1.4 Flow: a page request

1. **Request proxy** (`src/proxy.ts`, Next.js's request interceptor): security headers; a public path (§3.4) passes; no session cookie → redirect to `/sign-in?next=<path>`.
2. **Authenticated layout** `src/app/(app)/layout.tsx`: `auth.requireSession()` checks the session in the database (idle expiry; an account still on its initial password goes to `/choose-password`); renders the navigation (`navigation`, gated by the active lot) with the to-do count (`todo.todoCount()`).
3. **Page** `page.tsx` (Server Component) reads through its `queries.ts` and the read APIs of `@/lib/<module>`; a page made of blocks lets each block file fetch its own data.
4. **Render** with `ui` components, labels from `wording`, instants through `time` in the user's zone (`display.timeZone`).
5. **Device copy:** the service worker keeps the latest copy of the screens marked "cached" in §3.3; the client refreshes on reopen and on return from another app (IHM-04).

### 1.5 Flow: a Server Action

1. A client form posts to an action of the route's `actions.ts`; offline, the submit button is disabled with the reason and typed input is kept (IHM-58).
2. The action calls `auth.requireSession()` (Server Actions are public endpoints: every action checks), parses the input with the route's zod schema, then calls **one** lib use case — or the composed services of §1.7.
3. The service validates the rules, applies them, writes, calls `journal.record(...)` and, for a notifiable fact, `outbox.emit(...)` — all inside one `transaction()`; nested service calls join the outer transaction.
4. The action maps the `Result` to an `ActionState` (plain-language message from `wording`) and calls `revalidatePath` or `redirect`. Heavy follow-up work is queued (statistics fetch queue, recalculation queue, link checks), never awaited.

### 1.6 Flow: a scheduler tick

1. An external scheduler calls `GET /api/tick` every few minutes with `Authorization: Bearer <tick secret>`. A missing or wrong secret gets `401` and one aggregated journal entry (TRV-65).
2. `scheduler.runTick({ registry, budgetMs })` takes the global tick lease, runs the execution check (missed runs, TRV-31), then computes the due tasks of `tasks.registry`: local-time slots in the user's zone (one execution per slot, even on clock-change days), weekly slots, pending queues with their interval, every-tick tasks.
3. For each due task, in registry order: per-task lease → the handler works in chunks until it is done or the budget is spent → the run is recorded (slot, trigger, pass id, result, cursor). An unfinished run resumes at the next tick from its cursor (TRV-30).
4. Chained tasks run in the same pass, under the same pass id, while budget remains; otherwise at the next tick (TRV-26).
5. Every outbound call goes through `quotas.withQuota`; failures open incidents; facts emitted to the outbox during the pass are sent by `notification-dispatch` at its end (L2), grouped by pass id (TEL-19).
6. The response is a summary with no data.

### 1.7 Composed user actions

When one user action must trigger rules of a module that sits **above** the module owning the action (§1.3), the route's Server Action calls the services in order inside one `transaction()`. These are the only compositions allowed in routes; every other action is one call. For example, dismissal is `detection.dismiss` (detection calls sensitivity, alerts and tracking itself), saving an import is `imports.save`, withdrawing an event is `withdrawal.withdrawEvent`.

| Action (route) | Calls, in order | Spec |
|---|---|---|
| Add a player (`/players/new`) | `players.add` → `games.confirmLink` (or `games.markLinkPending`) → `games.requestHistory`; L2: `detection.reprefilterForPlayer` | JOU-07, JOU-10, STA-03, DET-07 |
| Reactivate a player, add a name variant (`/players/[playerId]`, `/edit`) | `players.reactivate` or `players.updateIdentity`; L2: `detection.reprefilterForPlayer` or `detection.reprefilterForVariant` | JOU-20, DET-07 |
| Withdraw a player (`/players/[playerId]`) | `players.withdraw` → `backtests.cancelOpenRequest(playerId, "player withdrawn")` | JOU-19, BKT-14 |
| Change a parameter (`/settings/parameters`) | `params.setParam` → if the parameter affects calculations, `sensitivity.requestFullRecalculation("parameter change")` | TRV-35, SEN-34 |
| Validate a type born of a detection proposal (`/types/[typeId]/validate`, L2) | `taxonomy.validate` → `detection.requeueProposalArticles` | TAX-19, DET-36 |
| Save an import while the player has a detected event awaiting its game (`/backtests/[requestId]/import`, L2) | `imports.save` → `alerts.produceAfterImport(playerId)` | IMP-36, ALE-05 |

Scheduled reactions that cross the lot boundary (for example completing an alert sheet once the imported player's statistics arrive, ALE-05) are composed in the task handlers of `tasks` (§4), never inside a Lot 1 module.

## 2. Module catalog

Every module is a folder `src/lib/<module>/` with an `index.ts` that re-exports its planned files (listed under **Files**; one file per operation group, flat). **Owns** names the entities whose tables only this module writes; the exact tables come from `docs/engineering/domain-model/`. **Lot** is the lot of the requirements; **Task** says who creates the module: a foundation task of §9 (`F-…`) or the planners' feature tasks.

### 2.1 Machinery

#### `env` — deployment configuration
- **Does:** reads and validates `process.env` once at startup; typed access to every deployment value; marks secrets so they are never logged, displayed or exported; selects the adapter of each port; exposes the active lot.
- **Exposes:** `env`, `isSecret`, `redact`, `adapterFor(port)`, `activeLot`.
- **Values (complete list):** database URL; app base URL; tick secret; initial password; session secret; fingerprint secret (ADR 0017); backup encryption key and backup storage token (ADR 0018); statistics-source base URL (optional, `STATS_SOURCE_BASE_URL`, no secret); language-model key (L2); Telegram bot token and webhook secret (L2); adapter selection per port (`fake` or a provider key; `fake` is refused in production outside the hermetic end-to-end mode); `EGOSCOPE_LOT` (1 until the Lot 2 milestone, then 2).
- **Implements:** TRV-37, TRV-64. **Depends on:** —. **Lot:** foundation. **Task:** F-env.
- **Files:** `schema.ts`, `secrets.ts`, `adapters.ts`.

#### `result` — expected-failure values
- **Does:** the `Result<T, E>` discriminated union and its helpers; `ActionState`, the shape Server Actions return to forms (field errors, one plain-language message).
- **Exposes:** `ok`, `err`, `isOk`, `mapResult`, `toActionState`, types `Result`, `ActionState`.
- **Depends on:** —. **Lot:** foundation. **Task:** F-service-kit.

#### `time` — clock, zones, formatting
- **Does:** the only clock (`now()`, with a fake clock for tests); IANA zone conversion; DST-safe local-time slots, one instant per scheduled local time even on clock-change days (TRV-27); the user's day and a game's US date (TRV-72, H-TRV-11); end of day on the Pacific coast for date-only events (SEN-01); English display formats — "Wednesday 18 November 2026, 01:30 Paris time", short "Wed 18 Nov 2026, 01:30", zone always named, a game's US date and venue time (TRV-71, IHM-14, ADR 0010).
- **Exposes:** `now`, `useFakeClock`, `toZoned`, `localSlotInstant`, `userDay`, `gameUsDate`, `endOfDayPacific`, `formatInstant`, `formatGameTime`, `formatDate`, `formatDuration`.
- **Implements:** TRV-68–TRV-72 (TRV-73 with each owner), IHM-14 (conversion), STA-30 (display). **Depends on:** —. **Lot:** foundation. **Task:** F-time.

#### `wording` — the app's words
- **Does:** the single English rendering of every glossary term and common state (VUE-08); one-sentence definitions (IHM-15); fixed sentences (SEN-30 reminder, SEN-31 label, IHM-50 notice, ALE-17 closing statement, TEL-05 closing mention, IHM-54–IHM-56 empty states, the app-written descriptions of calendar-derived events, ADR 0015); number formats (explicit sign with a true minus, decimal point, index 3 decimals STA-12, gap 2 decimals SEN-09); the banned betting vocabulary and a test helper that scans rendered text (VUE-02, IHM-50, ALE-18, TEL-05).
- **Exposes:** `label`, `definition`, `sentence`, `formatGap`, `formatIndex`, `formatCount`, `formatShare`, `assertNoBettingWords`.
- **Implements:** VUE-08, IHM-13 (numbers), IHM-50 (vocabulary). **Depends on:** —. **Lot:** foundation. **Task:** F-wording.
- **Files:** `states.ts`, `glossary.ts`, `sentences/<area>.ts` (one per spec area), `numbers.ts`, `banned-words.ts`.

#### `ui` — design system
- **Does:** accessible, phone-first components: layout and navigation bars, buttons with explicit labels, forms and field errors, dialogs with double confirmation, banners, empty states, paged lists with state filters and name search (IHM-18), long-text areas, copy and share buttons, a paste area with autocorrect, smart punctuation and auto-capitalization off. `ui/figures/` holds the honest-display components: mean gap with case count and plausible range, verdict with profile confidence and case count, written direction with symmetric styling, origin breakdown (historical / tracked), counts instead of percentages below the threshold, filter summary with the total, the method notice, a glossary term with its one-tap definition, drill-down links to a gap's numbers.
- **Exposes:** components (names fixed by F-ui and F-figures).
- **Implements:** IHM-01, IHM-60–IHM-63; figures: IHM-15, IHM-45–IHM-49, IHM-52, SEN-38, SEN-39 (as components; each screen must use them). **Depends on:** `wording`, `time`. **Lot:** foundation. **Task:** F-ui, F-figures.

#### `db` — database access
- **Does:** the Drizzle client (Neon in production, PGlite in tests and local development), the central schema, migrations applied at deploy time, the test-database helper, and `transaction()`: nested service calls join the outer transaction (interactive transactions are required).
- **Exposes:** `db`, `transaction`, the schema tables, `createTestDatabase`; script `scripts/migrate.ts`.
- **Owns:** the schema files `src/lib/db/schema/<owning-module>.ts`, one per module that owns tables.
- **Implements:** TRV-14 (with the service sheet), TRV-68 (instants as `timestamptz`, dates as `date`), TRV-76. **Depends on:** `env`. **Lot:** foundation. **Task:** F-db (+ `transaction` in F-service-kit).

#### `journal` — activity journal
- **Does:** one entry per task run, recalculation and its cause, external-service failure, incident, data-changing user action, import refused in full, parameter change (old and new value), refused login and lockout, and (L2) Telegram message; level info / warning / incident; plain-language text answering what happened, when, with what consequence, what to do; an optional `objectRef` (the screen the entry leads to) and an optional `eventRef` (a foreign key to the event, set to null when the event is withdrawn, so no entry ever names a withdrawn event); technical details stored apart, redacted, shown on demand; filters by category and period; text export of a period; retention purge that keeps open incidents.
- **Exposes:** `record`, `list`, `exportText`, `purgeExpired`; the complete category enum.
- **Owns:** JournalEntry, JournalTechnicalDetail.
- **Implements:** TRV-41 (capability; each feature writes its own entries), TRV-43, TRV-44, TRV-48, TRV-49 (export function), DSN-11, DSN-29 (event mentions disappear). **Depends on:** `db`, `time`, `result`. **Lot:** foundation. **Task:** F-service-kit.

#### `params` — parameter registry and preferences
- **Does:** the registry of every tunable of §6 (key, type, default, unit, allowed values, owning spec file and requirement, origin, "affects calculations" flag, plain-language sentence); overrides stored in the database; bounds checked with an explanation; reset to default; every change journaled with old and new value; the date of the last change that affects calculations (also moved by a type's criterion switch, ADR 0016); small owner preferences (guide hidden, first profile viewed, phone time-zone prompt dismissed).
- **Exposes:** `getParam`, `getParams`, `setParam`, `resetParam`, `listRegistry`, `lastCalculationChange`, `noteCalculationChange`, `getPreference`, `setPreference`.
- **Owns:** ParameterOverride, Preference.
- **Implements:** TRV-35, TRV-36, TRV-38–TRV-40 (screen: `/settings/parameters`, TRV-34). **Depends on:** `db`, `time`, `journal`, `result`. **Lot:** foundation. **Task:** F-params.
- **Files:** `registry/<family>.ts` (one per key family of §6), `accessors.ts`, `overrides.ts`, `preferences.ts`.

#### `outbox` — notifiable facts
- **Does:** lets a module record, inside its own transaction, a fact Telegram may announce: kind, reference, pass id, version; unique per fact, so a rerun never produces a second message (TRV-29, TEL-17); consumed by `notifications` (L2); purge of consumed facts. In Lot 1 only `incidents` emits, and nothing consumes.
- **Exposes:** `emit`, `pending`, `markConsumed`, `purgeConsumed`; the complete kind enum: `backtest-request.to-do`, `backtest-request.deadline-changed`, `alert-sheet.produced`, `alert-sheet.updated`, `tracked-result.ready`, `type-proposal.new`, `incident.opened`, `incident.closed`.
- **Owns:** OutboxFact. **Implements:** TEL-02 (facts recorded in the app), TEL-17 (with `notifications`). **Depends on:** `db`, `time`. **Lot:** foundation. **Task:** F-incidents.

#### `incidents` — incidents and service states
- **Does:** opens an incident once per cause, keeps it open while the cause lasts, closes it automatically or at the owner's request; hiding with a "hidden incidents" count (IHM-20); a state per service, normal / degraded / unavailable; emits `incident.opened` and `incident.closed` facts.
- **Exposes:** `open`, `close`, `closeByOwner`, `hide`, `listOpen`, `hiddenCount`, `serviceStates`; the complete cause enum: `quota-reached(service)`, `stats-source-unavailable`, `stats-source-schema-changed`, `task-not-run(task)`, `backup-failed`, `logins-refused`; L2: `feed-down(source)`, `collection-impossible`, `source-silent(source)` (warning level), `telegram-link-broken`, `messages-failed`.
- **Owns:** Incident. **Implements:** TRV-45, TRV-46 (service states). **Depends on:** `db`, `time`, `journal`, `outbox`. **Lot:** foundation. **Task:** F-incidents.

#### `quotas` — quota guard and database volume
- **Does:** wraps every outbound call: before the call, checks the service's declared limits per kind and period (per minute, per day, per month, volume) and keeps the reserve for priority work; defers instead of exceeding; after the call, records the requests and bytes the port reports; warning at the warning share; incident when a limit is reached, closed when work resumes; an early refusal by the service counts as "limit reached for the period" (TRV-06); database volume against capacity with its warning; usage in plain words with the reset time; usage history (measured volumes, TRV-08).
- **Exposes:** `withQuota({ service, estimate, priority }, call)`, `usageReport`, `databaseVolume`, `nextAvailableAt`.
- **Owns:** QuotaUsage. **Implements:** TRV-03–TRV-08, the mechanism of STA-39 and DET-08. **Depends on:** `db`, `time`, `params`, `journal`, `incidents`, `result`. **Lot:** foundation. **Task:** F-quotas.

#### `scheduler` — task runs
- **Does:** due computation for five schedule kinds (daily local times, weekly slot, chained after another task, while work is pending with an interval, every tick); DST-safe slots; a global tick lease and per-task leases that expire when a run crashed; chunked execution under a time budget with a persisted cursor; run history (slot, trigger scheduled / on demand / catch-up, pass id, start, end, result); postponement journaled; missed-run detection with the margin, which journals, opens "task not run" and makes the task due at once; on-demand runs that keep the next planned run; a "ready" guard that lets a due task wait (the statistics update waits for the source's refresh).
- **Exposes:** `runTick`, `requestRun`, `taskOverview` (last run, result, next planned run), `checkMissedRuns`, types `TaskDefinition`, `TaskContext` (`now`, `budget`, `passId`, `cursor`).
- **Owns:** TaskRun, TaskLease.
- **Implements:** TRV-27 (scheduling), TRV-28, TRV-29 (runs), TRV-30, TRV-31, TRV-33 (mechanism), TRV-13 (wake-up by the tick). **Depends on:** `db`, `time`, `params`, `journal`, `incidents`, `env`, `result`. **Lot:** foundation. **Task:** F-scheduler.

#### `auth` — single account and sessions
- **Does:** the account, created from the configured initial password, whose keyed fingerprint is kept to detect a reset; until the initial password is replaced only the change screen opens; password hashing with Node's built-in scrypt; minimum length; sessions in a secure cookie, idle expiry, several devices; sign-out here or everywhere; a password change closes the other sessions; lockout after repeated failures, journaled, with the "logins refused" incident closed at the first success; at server start, a changed initial password resets the account, closes every session and lifts the lockout.
- **Exposes:** `ensureAccount`, `signIn`, `choosePassword`, `changePassword`, `signOut`, `signOutEverywhere`, `requireSession`, `currentSession`, `lockoutStatus`, `purgeExpired`.
- **Owns:** Account, Session, LoginAttempt.
- **Implements:** TRV-57, TRV-60–TRV-63 (screens: F-access). **Depends on:** `db`, `time`, `params`, `journal`, `incidents`, `env`, `result`. **Lot:** foundation. **Task:** F-auth.

#### `drafts` — pasted-text drafts
- **Does:** keeps text pasted or typed in the import screen or the exploration screen, at once on the device (IndexedDB) and, when online, on the server attached to its request; the only copy of pasted text — never in saved data, import traces, the journal or backups; gone when the import is saved, when the draft is discarded, or after the retention; survives session expiry, app update and network loss.
- **Exposes:** client `usePasteDraft(kind, ref)`, `clearDeviceDrafts`; server `saveDraft`, `getDraft`, `discardDraft`, `purgeExpired`.
- **Owns:** Draft (kind `research-result` or `exploration-return`, reference, text, saved at).
- **Implements:** IHM-42, DSN-32. **Depends on:** `db`, `time`, `params`, `result`. **Lot:** foundation. **Task:** F-drafts.

#### `offline` — installable app and offline behavior
- **Does:** the web app manifest and icons, the service worker (precached shell, network-first copies of the screens marked "cached" in §3.3, the first-visit offline page), online status, the offline banner with the date of the copy, an online-only submit that says why it is disabled, the new-version banner that waits for unsaved drafts, refresh on reopen and on return from another app, restore of the last screen and scroll position, erasure of device data at sign-out (drafts included).
- **Exposes:** `registerServiceWorker`, `useOnlineStatus`, `OfflineBanner`, `OnlineOnlySubmit`, `UpdateBanner`, `useRefreshOnReturn`, `clearDeviceData`.
- **Implements:** TRV-21, TRV-22, IHM-02 (all but the help page), IHM-03, IHM-04, IHM-41, IHM-57, IHM-58 (helper), IHM-59, DSN-33. **Depends on:** `drafts`, `ui`. **Lot:** foundation. **Task:** F-pwa, F-offline.

#### `navigation` — app map and links
- **Does:** the tab bar and the "More" menu per lot (IHM-16), the lot gate, typed path builders for every screen of §3 (every mentioned object links to its screen, IHM-17), absolute links for Telegram (base URL from `env`).
- **Exposes:** `tabs`, `moreItems`, `paths`, `absoluteUrl`, `isLotActive`.
- **Implements:** IHM-16 (with the shell). **Depends on:** `env`. **Lot:** foundation. **Task:** F-shell.

#### `backups` — backup, export, restore
- **Does:** one archive format shared by export, backup and restore (one JSON Lines file per table plus a documented manifest); the full export and the spreadsheet exports (players, events, cases with one row per case, profiles; CSV) and the journal text export; last-export tracking and the reminder after the configured delay; the weekly backup — authenticated encryption with the configured key, upload part by part to `backup-storage` across ticks, manifest written last, rotation that truly deletes the oldest (ADR 0018), journal entry, "backup failed" incident; a backup before every schema change, taken by the deploy-time migration script (TRV-55); the restore script into an empty database, with the key, followed by a consistency check and the count summary shown on the status screen. Never included: drafts, sessions, secrets; the withdrawal fingerprints follow ADR 0017 open point 3.
- **Exposes:** `exportFull`, `exportPartial(kind)`, `exportJournal(period)`, `runBackup`, `beforeMigration`, `lastBackup`, `lastExport`, `exportReminderDue`, `restoreSummary`; script `scripts/restore.ts`.
- **Owns:** BackupRun, ExportRecord, RestoreReport.
- **Implements:** TRV-49–TRV-56. **Depends on:** `db`, `time`, `params`, `journal`, `incidents`, `env`, `backup-storage`. **Lot:** 1. **Task:** F-export, F-backups, F-restore.
- **Files:** `archive.ts`, `export.ts`, `backup.ts`, `rotation.ts`, `restore.ts`, `queries.ts`.

### 2.2 Pure core

#### `stats-engine` — what is measured and what is concluded
- **Does:** every rule that decides what is measured and what is concluded, as pure functions over plain data: instants in epoch milliseconds, local dates as `YYYY-MM-DD` strings, parameters as a plain object built by the caller from `params`. 100 % coverage, property tests and mutation testing (F-mutation). Pure rules that conclude nothing — prompt texts, JSON extraction, name prefiltering, notification restraint, feed dating — stay in their own module.
- **Parts** (one folder each; one or more planner tasks each):

| Part | Rules | Spec |
|---|---|---|
| `performance/` | Game Score (first function, F-toolchain), decimal minutes, performance index, sheet consistency (made ≤ attempted, points, minutes ceiling 48 + 5 per overtime), incomplete sheet, played game, usable game and playing-time threshold | STA-09–STA-15, H-13 |
| `baseline/` | season baseline per season and phase excluding the measured game; states final / provisional / building / insufficient; "partial" mention; postseason mode; L2 indicative comparison with the previous regular season | STA-16–STA-24 |
| `schedule/` | team record with one game excluded and opponent win share at the game's date (NBA Cup final excluded); playoff series state, series length per season and elimination flag; next game and expected game, "time to be determined"; season of a date; first NBA game; player indicators (games played, average minutes, last game, consecutive games missed); prolonged absence | STA-06, STA-07, STA-26–STA-28, STA-31, STA-46–STA-48, JOU-21, JOU-22, SUI-03, ALE-15 |
| `measured-game/` | measured game after the reference instant, attachment window, known-in-advance rule, fixed game of a calendar-derived event ("not measurable" when missed), precedence of a historical event's sources over its measured game, late detection | SEN-01–SEN-04, SEN-44, IMP-18, DET-33, ADR 0015 |
| `cases/` | grouping of same-type events on one game, concurrent cases, case state and reason, normalized gap, doubtful-case criteria (playing time, return from injury flagged or computed, unusual stakes flagged or computed, opponent level, concurrent), the per-type switched-off criterion, review flags, effect of manual decisions | SEN-05–SEN-18, SEN-45, SEN-47, ADR 0016 |
| `profiles/` | tally and invariants, views by origin, retained dispersion, expected noise, plausible range, signal-to-noise, verdict and direction, profile confidence, robustness (fragile verdict), controls, low-research-confidence count, general trend, expected false signals, verdict-change detection | SEN-19–SEN-33, SEN-37 (diff), SEN-39, SEN-41, SEN-43, SEN-48, VUE-03 |
| `tracking/` | recorded in time, forecast from the historical view and its versions, frozen and late forecast, post-tip-off decisions, gap in the forecast direction and category, validation-table rows and assessment | SUI-06, SUI-08–SUI-11, SUI-15–SUI-17, SUI-22–SUI-27 |
| `alerts/` | grouping of a player's events by expected game, the caveats list (with the switched-off-criterion warning), late mark, sheet state | ALE-03, ALE-16, ALE-24, ALE-26, ADR 0016 |
| `backtest/` | initial, supplement and full-redo extents; coverage merge, clamping of declared coverage and gaps; profiled status; deadline, to-do rank and urgency | BKT-08–BKT-10, BKT-16–BKT-18, IMP-10, H-VUE-02 |
| `matching/` | matching of two events (same type within the date gap, or same cleaned link), removal of tracking parameters from links; calendar-derived events never match | IMP-25, DET-58 (rule), COL-28, ADR 0015 |
| `calendar/` | birthday games (venue-local date with the stored day and month) and first games against a former team after the departure, from the schedule and the player's team history | ADR 0015 |

- **Exposes:** one function per rule (names fixed by each part), plus `evaluatePlayer` (all cases and profiles of one player from his data) and `evaluateTrend` (one type, all players).
- **Depends on:** nothing. **Lot:** 1 (+ the L2 rules marked above). **Task:** F-pure-skeleton (folders, shared types, barrels), then planner tasks per part.

#### `ai-exchange` — contracts and texts of every AI exchange
- **Does:** what the app sends to an AI and reads back, as pure functions: the research prompt with its placeholders and English rules; the research-result format 1.0 with English keys and values; isolation of the JSON in pasted text; recovery of a cut result; format, whole-result and per-event checks with their plain-language messages; the correction message for the AI; the exploration prompt and its return format; the versioned classification instructions and the checks of the model's answer; the automatic description checks (maximum length, no quotation marks).
- **Parts:** shared `conventions.ts` (ISO dates, lowercase enums, no `null`, omitted optional fields), `extract-json.ts` (IMP-04), `text-rules.ts` (DSN-20, DSN-21, DSN-24, DSN-25); `research-prompt/` (BKT-19–BKT-29; calendar-derived types never appear, ADR 0015); `research-result/` (IMP-04–IMP-17 field checks, IMP-20, IMP-21, BKT-23, BKT-24); `exploration/` (TAX-16, TAX-17, the cross-refusals of IMP-06 and 02 AC-17); `classification/` (DET-14, DET-16, DET-21–DET-23, DSN-05, DSN-25; calendar-derived types are not sent, ADR 0015).
- **Depends on:** nothing. **Lot:** 1 (`classification/` L2). **Task:** F-pure-skeleton (shared files and barrels), then planner tasks per part.

### 2.3 Ports

One module per outside service; §5 gives the operations and what each fake simulates. Every port folder holds `index.ts` (interface, types, the accessor that returns the adapter chosen by `env.adapterFor`), `port.ts`, `types.ts`, `errors.ts`, `fake.ts` (scriptable, the default outside production), and one file per real adapter. The shared behavioral tests every adapter must pass live in `test/support/contracts/<port>.ts`, run against the fake and against recorded fixtures of each real adapter (`data/fixtures/<port>/`).

| Port | Service | Lot | Real adapter files | Tasks |
|---|---|---|---|---|
| `stats-source` | statistics source: schedules, box-score lines, players | 1 | `sportsdataverse.ts`, `sportsdataverse-rows.ts`, `venue-time-zones.ts` (service sheet) | F-ports-lot1, F-adapter-stats-source |
| `link-check` | public article links (IMP-17) | 1 | `http.ts` | F-ports-lot1, F-adapter-link-check |
| `backup-storage` | private off-site storage (ADR 0018) | 1 | per the backup service sheet | F-ports-lot1, F-adapter-backup-storage |
| `language-model` | free-tier classification model | 2 | per the language-model service sheet | F-ports-lot2, F-adapter-language-model |
| `press-feeds` | public news feeds | 2 | `syndication.ts` (RSS and Atom) | F-ports-lot2, F-adapter-press-feeds |
| `telegram` | Telegram Bot API | 2 | `bot-api.ts` | F-ports-lot2, F-adapter-telegram |

The deep-research AI is not a port: the app never calls it (VUE-07, TRV-19). The external scheduler is not a port either: it calls the app (§3.4).

### 2.4 Domain modules, Lot 1

#### `events` — the event record
- **Does:** stores the events of every origin — historical, detected (L2), calendar-derived (ADR 0015) — with exactly the DSN-06 whitelist: one followed player (VUE-04), the type and the sheet version it was qualified under, the reference date and its precision, the sources (for a calendar-derived event, its scheduled game instead), the short neutral description, the context indications with their provenance, the research or detection confidence, the marks; the correction history; deletion records; the withdrawn-events counter; the temporary withdrawal fingerprints (keyed hash of player, type and reference day with the fingerprint secret, kept eight weeks, ADR 0017).
- **Exposes:** `createHistorical`, `createDetected`, `createCalendarDerived`, `addSources`, `applyCorrection`, `reassignType`, `setDetectedState`, `deleteHistorical`, `incrementWithdrawnCount`, `withdrawnCount`, `recordFingerprint`, `matchesFingerprint`, `purgeExpiredFingerprints`, `eraseEvent`; reads `getEvent`, `eventsOfPlayer`.
- **Owns:** Event, EventSource, EventCorrection, EventDeletionRecord, WithdrawnEventCounter, WithdrawalFingerprint.
- **Implements:** VUE-04, DSN-01, DSN-03, DSN-06–DSN-08, DSN-10, TAX-23 (stamping), DET-53 (data), ADR 0015 (third origin), ADR 0017. **Depends on:** `db`, `journal`, `params`, `time`, `env`, `result`. **Lot:** 1 (+ L2 fields). **Task:** planners.
- **Files:** `create.ts`, `sources.ts`, `corrections.ts`, `state.ts`, `delete.ts`, `traces.ts` (counter, fingerprints), `erase.ts`, `queries.ts`, `types.ts`.

#### `players` — followed players
- **Does:** the follow list: identity (an app identifier never reused, display name, current team, name variants with ambiguity marks, the day and month of birth only — ADR 0015, from the statistics source or entered by the owner), shared-variant warnings, the cap on active players, states and their history, team history, deletion of a withdrawn player's rows.
- **Exposes:** `add`, `updateIdentity`, `pause`, `reactivate`, `withdraw`, `recordTeamChange`, `deleteRows`; reads `list`, `get`, `activeCount`, `variantsOfActivePlayers`.
- **Owns:** FollowedPlayer, NameVariant, PlayerStatusChange, PlayerTeamChange.
- **Implements:** JOU-01, JOU-04–JOU-09, JOU-11–JOU-20, JOU-23, JOU-25–JOU-28 (data; JOU-24 with `withdrawal`). **Depends on:** `db`, `journal`, `params`, `time`, `result`. **Lot:** 1. **Task:** planners.
- **Files:** `add.ts`, `identity.ts`, `status.ts`, `teams.ts`, `delete.ts`, `queries.ts`, `types.ts`.

#### `games` — game statistics
- **Does:** everything that comes from the statistics source, stored with its fetch date and source version (STA-42): the player directory used for candidate search; each player's confirmed link (candidates with name, teams and seasons; "mapping to establish"; re-confirmation when the source drops an id); teams, seasons and games (phase, status, tip-off instant, "time to be determined", venue date, overtimes, series label, make-up link, excluded games flagged); box-score lines (whole minutes marked as rounded; a did-not-play reason is never stored); consistency checks; corrections within the window and their log; the units of work of the fetch queue (publication probe, season games, season lines of the followed players, player directory) with STA-40 priority, attempts, next attempt, lease, cursor and source version; retries and the outage incident; the career backfill with progress and estimated end; current-team updates; next game; covered seasons.
- **Exposes:** `searchCandidates`, `confirmLink`, `markLinkPending`, `changeLink`, `requestHistory`, `requestRefetch`, `planDailyUpdate`, `processFetchQueue`; reads `nextGame`, `expectedGame`, `gameLog`, `baselineInputs`, `indicators`, `firstNbaGame`, `seasonsOf`, `coveredSeasons`, `fetchProgress`, `lastUpdateAt`, `changedSince`.
- **Owns:** Team, Season, Game, BoxScoreLine, SourcePlayer (directory), StatsSourceLink, FetchUnit, StatCorrection.
- **Implements:** STA-01–STA-05, STA-08, STA-25, STA-29, STA-32–STA-45 (STA-38 L2), JOU-02, JOU-10 (search), JOU-13, VUE-01. **Depends on:** `players`, `stats-engine`, `stats-source`, `quotas`, `incidents`, `journal`, `params`, `time`, `db`. **Lot:** 1. **Task:** planners.
- **Files:** `link.ts`, `directory.ts`, `ingest.ts`, `fetch-queue.ts`, `daily-update.ts`, `history.ts`, `teams.ts`, `outage.ts`, `queries.ts`, `types.ts`.

#### `sensitivity` — cases, profiles, trends
- **Does:** turns events into cases and cases into profiles: attachment to the measured game, measurement, doubtful cases, manual exclusion and reinstatement, the precedence of historical events, profiles per player and type and trends per type for three views (all cases, historical, tracked), verdict history, expected false signals, review flags; recalculation inline for one scope and queued for a full recalculation, with the "recalculating" state; append-only profile snapshots that `tracking` reads to build forecasts.
- **Exposes:** `recalculate(scope, cause)`, `requestFullRecalculation(cause)`, `processRecalculationQueue`, `excludeCase`, `reinstateCase`, `eraseEventData`; reads `getProfile`, `listProfiles` (filter, total, evaluated pairs, expected chance verdicts, last calculation change), `getTrend`, `listCases`, `getCase`, `caseOfEvent`, `verdictHistory`, `reviewFlags`, `isRecalculating`, `snapshotsUntil`.
- **Owns:** Case, CaseEvent, ManualDecision, ProfileSnapshot, VerdictHistoryEntry, RecalculationRequest.
- **Implements:** SEN-01–SEN-48 (persistence and orchestration of the engine rules), IMP-18 (stored result), VUE-03, VUE-05 (data). **Depends on:** `games`, `stats-engine`, `params`, `journal`, `time`, `db`. **Lot:** 1 (SEN-21, SEN-35, SEN-45 L2). **Task:** planners.
- **Files:** `recalculate.ts`, `full-recalculation.ts`, `manual-decisions.ts`, `queries.ts`, `erase.ts`, `types.ts`.

#### `calendar-events` — events read in the schedule (ADR 0015)
- **Does:** for every active or paused player and every validated calendar-derived type, creates one event per birthday game and per first game against a former team over the covered seasons; idempotent (one event per player, type and game); re-runs when such a type is validated, reactivated or substantially changed, when a player's history or team changes, and after each statistics update; these events never enter a prompt, a coverage, matching or detection; the description is written by the app; type, player and date cannot be edited. When upcoming games get their event, and their Lot 2 handling, are ADR 0015 open points 1 and 2.
- **Exposes:** `requestDerivation(scope)`, `processDerivations`.
- **Owns:** DerivationRequest (the events themselves are written through `events.createCalendarDerived`).
- **Implements:** ADR 0015 (Q-TAX-01, Q-SEN-04), SEN-02 for these types, the JOU-11 exception. **Depends on:** `events`, `games`, `sensitivity`, `stats-engine`, `journal`, `db`. **Lot:** 1. **Task:** planners.
- **Files:** `derive.ts`, `requests.ts`, `types.ts`.

#### `taxonomy` — event types
- **Does:** type sheets and their lifecycle (proposed, validated, rejected, withdrawn); validation with the completeness check and the eight-point checklist (the dating item reads "established by the schedule" for a calendar-derived type); versions and modification history with the formal or substantive qualification; merge, split, requalification and distribution of events; withdrawal and reactivation; the nine seeded candidate types (English drafts, two calendar-derived); the exploration round trip (prompt, return, preview, creation of proposals); the do-not-repropose list; per-type flags — known in advance, calendar-derived, intimate subject, the one switched-off doubtful criterion (ADR 0016: history entry, no new version, full recalculation, calculation-change date); L2: proposals and occurrences coming from detection.
- **Exposes:** `seedCandidateTypes`, `createProposal`, `editProposal`, `validate`, `reject`, `reopen`, `modify`, `setSwitchedOffCriterion`, `merge`, `split`, `requalifyEvent`, `distributeEvent`, `withdrawType`, `reactivate`, `generateExplorationPrompt`, `previewExplorationReturn`, `createFromExploration`, `receiveDetectionProposal` (L2), `addOccurrence` (L2); reads `listByState`, `getType`, `validatedSheets` (for prompt, import and classification, calendar-derived excluded), `doNotReproposeList`, `resolveTypeId`, `versionCounters`, `eventsToReview`.
- **Owns:** EventType, TypeSheetVersion, TypeSheetChange, IllustrationSource, TypeProposalOccurrence (L2).
- **Implements:** TAX-01–TAX-33 (TAX-18, TAX-19 L2), H-TAX-05, ADR 0015, ADR 0016. **Depends on:** `events`, `sensitivity`, `calendar-events`, `ai-exchange`, `params`, `journal`, `db`. **Lot:** 1. **Task:** planners (seed file: F-seed).
- **Files:** `seed.ts`, `proposals.ts`, `validate.ts`, `modify.ts`, `criterion-switch.ts`, `merge.ts`, `split.ts`, `review-events.ts`, `lifecycle.ts`, `exploration.ts`, `detection-proposals.ts`, `queries.ts`, `types.ts`.

#### `backtests` — backtest requests and coverage
- **Does:** requests (initial, supplement, full redo; one open request per player) with their extents, deadline, rank and urgency; the stored research prompt and its regeneration under the same reference; the copy time and the "in progress" state shared across devices; update, reduction, cancellation; coverage per type and period with its sheet version; the profiled status; supplement proposals after a validation, reactivation or broadening and after an incomplete import (never for calendar-derived types); L2: requests born of detection, attached detected events, the routing decision of BKT-30.
- **Exposes:** `request(playerId, mode)`, `update`, `reduce`, `cancel`, `cancelOpenRequest`, `recordPromptCopied`, `snoozeInProgressBanner`, `acceptSupplement`, `recordImport` (state and coverage, called by `imports`), `createFromDetection` (L2), `attachDetectedEvent` (L2), `routeDetectedEvent` (L2); reads `list`, `get`, `todoRequests`, `inProgress`, `coverage`, `isProfiled`, `supplementProposals`, `outdatedPrompts`.
- **Owns:** BacktestRequest, RequestedType, CoveragePeriod.
- **Implements:** BKT-01–BKT-30 (BKT-03, BKT-04, BKT-18, BKT-30 L2), IHM-39, IHM-40, H-VUE-02, VUE-07. **Depends on:** `taxonomy`, `games`, `sensitivity`, `ai-exchange`, `stats-engine`, `outbox`, `params`, `journal`, `db`. **Lot:** 1 (+ L2 parts called by `detection`). **Task:** planners.
- **Files:** `request.ts`, `edit.ts`, `prompt.ts`, `coverage.ts`, `supplements.ts`, `detection.ts`, `queries.ts`, `types.ts`.

#### `imports` — research-result import
- **Does:** checks the pasted text against its request (through `ai-exchange`); builds the preview (mode, coverage and gaps, breakdown by type and season, duplicates, precedence, fingerprint matches to decline, refusals, warnings, leads, limits, spot-check of sources); saves in one all-or-nothing operation (historical events and their sources, coverage, request imported, numbered import trace); queues the follow-up (statistics for the measured games and baselines, recalculation, link checks); corrects and deletes historical events; keeps the import history and the remaining refusals; L2: duplicates of detected events (IMP-27).
- **Exposes:** `check(requestId, text, decisions)` (returns the preview), `save`, `correctionMessage`, `correctHistorical`, `deleteHistorical`, `processLinkChecks`, `eraseEventData`; reads `history`, `remainingRefusals`.
- **Owns:** ImportTrace, ImportEventOutcome, SourceLinkCheck.
- **Implements:** IMP-01–IMP-35, IMP-37 (IMP-27 L2; IMP-36 through the composed action of §1.7), DSN-24 (import part), ADR 0017 (preview flag). **Depends on:** `backtests`, `events`, `taxonomy`, `games`, `sensitivity`, `ai-exchange`, `stats-engine`, `link-check`, `drafts`, `params`, `journal`, `db`. **Lot:** 1. **Task:** planners.
- **Files:** `preview.ts`, `save.ts`, `correction-message.ts`, `historical-edit.ts`, `link-checks.ts`, `queries.ts`, `erase.ts`, `types.ts`.

### 2.5 Domain modules, Lot 2

#### `collection` — news collection
- **Does:** press sources (trial read without saving, public-sports-press attestation, dating warnings, edit, deactivate, reactivate, withdraw, address change proposed by a feed); collection runs (one read per source with retries, item checks, language, retained publication instant and its precision under the prudence principle, maximum age and catch-up, link cleaning, deduplication, minimal storage, processing states); source health (never read, working, down, silent) with incidents and gaps; indicators; the collection journal; purge of not-relevant articles, of excerpts and of deduplication traces; immediate erasure of a withdrawn event's articles.
- **Exposes:** `trialRead`, `addSource`, `editSource`, `setSourceActivation`, `withdrawSource`, `runCollection`, `requestOnDemand`, `setArticleState` (for `detection`), `purgeExpired`, `eraseEventData`; reads `sources`, `runs`, `run`, `articlesOfRun`, `article`, `articlesToAnalyze`.
- **Owns:** Source, Article, ArticleSighting, DedupTrace, CollectionGap, CollectionRun.
- **Implements:** COL-01–COL-50, DSN-02, DSN-09, DSN-34, ADR 0019 (times). **Depends on:** `press-feeds`, `stats-engine` (link cleaning), `incidents`, `journal`, `params`, `time`, `db`. **Lot:** 2 (needs nothing from Lot 1, may start early). **Task:** planners.
- **Files:** `sources.ts`, `run.ts`, `dating.ts`, `dedup.ts`, `health.ts`, `purge.ts`, `queries.ts`, `erase.ts`, `types.ts`.

#### `alerts` — alert sheets
- **Does:** produces, at the end of each detection pass and after an import made before kick-off, one sheet per profiled player and expected game: events and sources, the player's profile for the type frozen at issuance, the general trend as benchmark or in place of a profile below the threshold, the expected game, every applicable caveat, the closing statement; dated updates (new event, new source, expected-game change, dismissal and reinstatement, corrected context or attachment); the late mark; closure with the outcome (pushed by `tracking`); the history, cancelled and late sheets included; emits sheet facts.
- **Exposes:** `produceForPass`, `produceAfterImport`, `completeProfileValues`, `addEvent`, `addSource`, `onEventDismissed`, `onEventReinstated`, `onExpectedGameChanged`, `onContextCorrected`, `onAttachmentCorrected`, `close`, `eraseEventData`; reads `list`, `get`, `openSheets`, `lateSheets`.
- **Owns:** AlertSheet, AlertSheetEvent, AlertSnapshot, AlertUpdate, AlertOutcome.
- **Implements:** ALE-01–ALE-31, VUE-10 (part). **Depends on:** `games`, `sensitivity`, `backtests`, `stats-engine`, `outbox`, `journal`, `db`. **Lot:** 2. **Task:** planners.
- **Files:** `produce.ts`, `update.ts`, `close.ts`, `queries.ts`, `erase.ts`, `types.ts`.

#### `tracking` — tracked cases and validation table
- **Does:** creates a tracked case for every detected event with its creation instant; derives forecast versions from the historical-view profile snapshots, so the frozen forecast is exactly the last version before tip-off whatever the tick timing; late forecasts; categories of measured cases; tracked-game results for Telegram (indicative while the baseline is building); closes alert sheets with their outcome; the validation table with its separate sets and the withdrawn-events counter.
- **Exposes:** `createTrackedCase`, `runAfterStatsUpdate`, `refreshForecasts`, `eraseEventData`; reads `trackedCase`, `validationTable`, `results`.
- **Owns:** TrackedCase (extension of Case), ForecastVersion, TrackedGameResult.
- **Implements:** SUI-01–SUI-30, SEN-35, VUE-10 (part). **Depends on:** `sensitivity`, `games`, `alerts`, `stats-engine`, `outbox`, `journal`, `db`. **Lot:** 2. **Task:** planners.
- **Files:** `create.ts`, `forecasts.ts`, `results.ts`, `validation-table.ts`, `queries.ts`, `erase.ts`, `types.ts`.

#### `detection` — event detection
- **Does:** the quota-free prefilter on the names and variants of active players, exposure counts, re-prefiltering after a player or variant change; the priority queue; classification by the language model within quota (validated sheets only, calendar-derived types excluded; answer checks and retries; threshold); grouping into one event per fact and reference date; the "fact already in a backtest" check and the withdrawal-fingerprint check (ADR 0017); type proposals and occurrences; routing of each new event (tracked case, backtest need, alert-sheet request); the detection journal and quality indicators; owner actions (manual classification, new classification, rescue); dismissal and reinstatement; corrections; lifting "dating to verify".
- **Exposes:** `prefilterNew`, `reprefilterForPlayer`, `reprefilterForVariant`, `processQueue`, `classifyManually`, `requestReclassification`, `rescue`, `requeueProposalArticles`, `dismiss`, `reinstate`, `correct`, `moveReferenceDateEarlier`, `liftDatingToVerify`, `eraseEventData`; reads `queue`, `notRelevant`, `runs`, `qualityIndicators`, `articleFate`, `exposure`, `instructions`.
- **Owns:** ClassificationResult, ClassificationQueueItem, ExposureCount, DetectionRun.
- **Implements:** DET-01–DET-58, JOU-03, JOU-18, TAX-19 (detection side), DSN-05, DSN-25, ADR 0015 (DET-14, DET-15), ADR 0017. **Depends on:** `collection`, `events`, `taxonomy`, `backtests`, `alerts`, `tracking`, `sensitivity`, `games`, `language-model`, `quotas`, `ai-exchange`, `stats-engine`, `incidents`, `outbox`, `journal`, `params`, `db`. **Lot:** 2. **Task:** planners.
- **Files:** `prefilter.ts`, `exposure.ts`, `queue.ts`, `classify.ts`, `grouping.ts`, `routing.ts`, `proposals.ts`, `owner-actions.ts`, `dismissal.ts`, `corrections.ts`, `runs.ts`, `queries.ts`, `erase.ts`, `types.ts`.

#### `notifications` — Telegram notifications
- **Does:** linking of the owner's private chat (one-time code, deep link with fallback, confirmation, replacement, unlinking); inbound updates (only the link code from a private chat; anything else ignored without reply and journaled); composition of the catalogue messages from outbox facts; restraint (grouping per pass, quiet hours, urgency, daily cap, staleness check at send time); message statuses; retries and Telegram's slow-down; catch-up after failures; broken link; reminders before a deadline; incident reminders; the export reminder message; abandonment of pending messages and deletion attempts for dismissed or withdrawn events.
- **Exposes:** `startLinking`, `handleInbound`, `unlink`, `sendTest`, `dispatch`, `abandonPendingFor`, `deleteMessagesAbout`, `eraseEventData`; reads `linkState`, `messages`, `failedCount`.
- **Owns:** TelegramLink, LinkCode, NotificationMessage, MessageFact.
- **Implements:** TEL-01–TEL-38, DSN-31, DSN-35, TRV-18, TRV-23, TRV-67, STA-38, TRV-54 (message). **Depends on:** `telegram`, `outbox`, `backtests`, `alerts`, `tracking`, `taxonomy`, `games`, `incidents`, `backups`, `navigation`, `wording`, `time`, `params`, `journal`, `db`. **Lot:** 2 (the Telegram transport needs nothing from Lot 1 and may start early). **Task:** planners.
- **Files:** `linking.ts`, `inbound.ts`, `compose.ts`, `restraint.ts`, `dispatch.ts`, `delivery.ts`, `event-messages.ts`, `queries.ts`, `erase.ts`, `types.ts`.

### 2.6 Composition modules

#### `withdrawal` — event withdrawal and player data deletion
- **Does:** shows what a withdrawal erases and its limits (DSN-28 as extended by ADR 0017); erases an event and every trace in one transaction by calling `eraseEventData` of `sensitivity`, `imports` and, when Lot 2 is active, `alerts`, `tracking`, `collection`, `detection` and `notifications`, then `events.eraseEvent`; increments the counter; records the temporary fingerprint; journals the withdrawal without player, type or date; recalculates; deletes every datum of a withdrawn player (each event withdrawn first, ADR 0017 open point 2 for the fingerprint).
- **Exposes:** `previewWithdrawal`, `withdrawEvent`, `previewPlayerDeletion`, `deletePlayerData`.
- **Implements:** DSN-26–DSN-29, DSN-34 (through `collection`), IMP-37, ALE-30, SUI-30, TEL-38 (through `notifications`), JOU-24, ADR 0017. **Depends on:** the erase hooks above, `events`, `players`, `sensitivity`, `journal`, `db`. **Lot:** 1 (+ L2 hooks). **Task:** planners (erase stubs: F-skeleton-lot1, F-skeleton-lot2).
- **Files:** `preview.ts`, `withdraw.ts`, `player-data.ts`.

#### `todo` — the to-do list
- **Does:** the six sections of IHM-20 in order, an empty section hidden, "Nothing to do for now" when all are empty, and the count shown on the Home tab.
- **Exposes:** `todoList`, `todoCount`.
- **Files (one per section, each filled by the task that owns its source):** `requests.ts` (to-do requests, BKT-17, BKT-18), `supplements.ts` (proposed supplements, BKT-05, BKT-06, TAX-20, TAX-24, TAX-32), `incidents.ts` (open incidents and hidden count, TRV-45), `players.ts` (JOU-04, JOU-06, JOU-10, STA-03, JOU-22), `type-proposals.ts` (proposed types, oldest first), `review.ts` (events to requalify or distribute TAX-25, TAX-29, flagged cases SEN-16, L2 "dating to verify" DET-32, SEN-45).
- **Implements:** IHM-20. **Depends on:** `backtests`, `incidents`, `players`, `games`, `taxonomy`, `sensitivity`, L2 `detection` and `notifications`, `navigation`, `params`. **Lot:** 1 (+ L2 items). **Task:** F-todo (composition and the incidents section), then the section owners.

#### `tasks` — scheduled work
- **Does:** the task registry of §4 (key, plain English name, owning spec, lot, schedule kind and parameters, chain, ready guard) and one handler file per task that composes the domain calls of that task; Lot 2 tasks stay inactive while `EGOSCOPE_LOT` is 1.
- **Exposes:** `registry`.
- **Files:** `registry.ts`, one `<task-key>.ts` per task of §4.
- **Implements:** TRV-25, TRV-26 (with `scheduler`). **Depends on:** everything above. **Lot:** foundation (registry), handlers per lot. **Task:** F-tasks (registry, stubs, purge and execution check), then planners per handler.
