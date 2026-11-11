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
