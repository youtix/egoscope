# Egoscope: binding rules for every agent

These rules hold for every change. README.md has the overview, the stack and the scripts.

## Reference and language

- The French functional specifications in `docs/*.md` are the authoritative reference. Never edit,
  move or reformat them. When they disagree, `docs/90-journal-des-decisions.md` wins. They are
  checksummed in `docs/frozen-specs.sha256`, which only the coordinator updates, when the owner
  changes a specification.
- Cite requirement IDs exactly as the specs write them: requirements `JOU-04`, acceptance criteria
  `CA-TRV-12`, journal entries `D-07`, `H-13`, `Q-04`, local hypotheses `H-STA-03`.
- Owner decisions override the specs where they conflict. Above all, everything is in English,
  including the UI (overriding H-11): code, comments, UI text, docs, commits and PRs, in American
  spelling.
- The English reference documents are on `main`: the glossary of spec terms, the module map, the
  clarifications and the domain model in `docs/engineering/`, the decision records in `docs/adr/`
  and the service sheets in `docs/services/`. The section "Reference documents" below gives their
  reading order and precedence.
- No real NBA player names anywhere, fixtures included: invent players. No personal names or email
  addresses.

## Reference documents

[`docs/engineering/README.md`](docs/engineering/README.md) lists them in reading order. Precedence:

The specs decide behavior; a ruling outranks a reading of a spec. The glossary owns terms, labels
and the stored values it lists; the data model, tables, columns and the other stored values (showing
one adds its glossary label); the module map, module names, the names its modules export, routes,
parameter keys and task keys.

## Layout and module rules

Page-specific code sits flat in `src/app/<route>/`. Shared code, and code that belongs to no page
(calculation engine, database, scheduled jobs, external-service adapters, shared UI), lives in
`src/lib/<module>/`. Seeds, fixtures and raw data live in `data/` (import them as `@data/...`),
never in `src/`; `data/` holds no code. ESLint and `bun run lint:structure` enforce these rules:

1. `src/lib/**` never imports from `src/app/**`.
2. The pure core is plain `.ts` and type-checks against the ECMAScript library alone
   (`tsconfig.pure-core.json`). `src/lib/stats-engine/**` imports nothing outside itself and uses
   no I/O, no Node or browser API, no clock (`Date.now()`, argument-less `new Date()`), no local
   time (local getters and setters, `toLocale*`, date strings), no randomness, no environment and
   no async code: pass such values in as arguments, and use UTC methods on instants.
   `src/lib/ai-exchange/**` obeys the same rules, except that it may import `zod` and run async
   code. The tests of both may also import `vitest`, `fast-check` and fixtures from `@data/`; no
   other import is allowed, so that no package can bring Node or DOM types into the pure core.
3. A route never imports from another route. Inside `src/app`, relative imports are `./name` only;
   code that two routes need moves to `src/lib/<module>`.
4. Other code imports a module only as `@/lib/<module>`. Its `index.ts` only re-exports, by name
   (`export { x } from './x'`). No deep imports, no import cycles.
5. At most two folder levels below `src/lib` (`src/lib/<module>/<sub>/file.ts`); no `_private`
   folders under `src/app`.
6. File and folder names are kebab-case (Next.js special files and route segments such as
   `[playerId]` excepted). No default exports except where Next.js requires one. No enums: use
   `as const` objects or unions of literals.

Files that a tool generates and the repository commits, such as the drizzle-kit migrations in
`drizzle/`, live only in the folders listed in `scripts/generated-files.ts`. There, and nowhere
else, they are exempt from the naming rule, ESLint, knip, Prettier and markdownlint, and counted in
no coverage; a folder joins the list only by a change to that module. Never edit a generated file
by hand: regenerate it. The task that adds a generator also adds the CI check that regenerating
gives no difference.

## Code

- Expected failures are values: return `{ ok: true, ... } | { ok: false, error }`. `throw` is for
  bugs only.
- No magic numbers: name every constant. Numbers the specs treat as tunable parameters will go to
  the central parameter registry.
- Configuration and secrets come only from `@/lib/env`, validated once. Each new variable goes in
  its schema and in `.env.example`. Never log, display or export a secret (TRV-64).
- Log with `logger` from `@/lib/log`, on the server. `console` is banned everywhere else, and client
  code does not log.
- Instants are absolute: compare and store instants, never naive local dates.
- Exported functions of `src/lib` carry a JSDoc description that cites the requirement IDs they
  implement.
- Next.js 16.4 is newer than your training data: read the matching guide in
  `node_modules/next/dist/docs/` before writing Next.js code. Cache Components is enabled.

## Time

- Only `@/lib/time` reads the clock and the machine's time zone, parses dates and converts time
  zones. Take the instant from `now()`; lint refuses any import of `temporal-polyfill`,
  `Date.now()`, `new Date()`, `Date()`, `Date.parse`, `new Date(string)`,
  `new Date(year, month, …)`, `Temporal.Now`, `performance.timeOrigin`, the local getters,
  setters and `toLocale*` of a date, the `toLocale*` of a `Temporal.Instant`, `Intl.DateTimeFormat`
  without a `timeZone`, `Temporal.PlainDate.from`, `Temporal.PlainTime.from` or
  `Temporal.PlainDateTime.from` of a string, and
  `Temporal.Instant.from` or `Temporal.ZonedDateTime.from` of a string elsewhere in `src/`,
  `scripts/` and `e2e/`, while `performance.now()`, which measures a duration, stays allowed.
  The lock wrapper (`scripts/with-lock.ts`, `scripts/signal-relay.ts`), which imports nothing from
  `src/`, stamps its records with `performance.timeOrigin + performance.now()` instead, a Unix
  time that another process reads and that does not jump when the system clock moves. With Cache
  Components, a Server Component calls `await io()` (from `next/cache`) inside `<Suspense>` before
  `now()`, and a Client Component `use(io())`; keep `connection()` for code that must wait for a
  real request.
- An instant is an `EpochMs`, a calendar date an `IsoDate`, and every day names its zone: the
  owner's day (`userDay`, in the `display.timeZone` setting the caller passes in, never a fixed
  Paris) for tasks and displays, a game's day (`gameDay`, its US Eastern date) for games. Only
  client code reads the device's zone, with `deviceTimeZone()`; lint refuses it in a server-only
  module, a module that starts with `'use server'` and a route handler (`route.ts`).
- Tests set the time with `fixedClock` and `installFakeClock`, and restore the clock afterwards.
- People read dates through the `time` formatters, machines in ISO 8601. Nowhere does code call
  `toLocale*`, `localeCompare` or an `Intl` constructor without an explicit locale.

## Design system

- Screens are built from `@/lib/ui` (decision record 0029), never from raw `<button>`, `<input>`,
  `<select>`, `<textarea>` or `<dialog>` elements, nor from another component library. Colors are
  the tokens of `src/app/globals.css` (`bg-canvas`, `text-ink`, `text-ink-muted`, `bg-accent`…):
  Tailwind's palette is removed, and no screen writes a `dark:` variant, since the tokens follow
  the phone's theme. Targets are at least `min-h-touch`; no text is truncated (`truncate`,
  `line-clamp`) and labels wrap (IHM-60, IHM-61).
- A form is a `Form` around `FormField`s, wired to a Server Action through `useActionState`: it
  shows the errors in its summary and beside each field, keeps the owner's input when the action
  refuses it, and its submit `Button` waits while the action runs. A confirmation is a
  `ConfirmDialog` inside the `Form` it submits, with `secondStep` for what cannot be undone. A save
  refused because the object changed meanwhile shows a `ChangedElsewhereNotice` (CL-IHM-18).
- Every visible text is a prop, taken from `@/lib/wording`; numbers and dates come written by its
  formatters and those of `@/lib/time`. A label names the thing, in sentence case and without a
  colon; a button starts with a verb and says what it does ("Copy the prompt", never "OK"); an
  unavailable action says why (`disabledReason`); an error says what is wrong and how to put it
  right, in one sentence without jargon; an empty state says why it is empty and which action fills
  it (IHM-56); a state is always written, its color and icon only add to it (IHM-61).
- A new component is one kebab-case file in `src/lib/ui/`, exported by name from its group in
  `index.ts`, with no `className` prop and no text of its own. Its test beside it drives it with
  user-event as a person does and runs axe on each state; the gallery, `src/app/dev/ui/`, shows it
  in every state, and `e2e/ui-gallery.spec.ts` drives the states that need an action, which the
  accessibility watch then checks in both themes.

## Tests

- A test sits beside the file it tests: `foo.test.ts` next to `foo.ts`. Component tests are
  `.test.tsx` files and run in jsdom.
- End-to-end specs live in `e2e/`, outside `src/` (whose every file coverage counts), and are named
  `.spec.ts`, never `.test.ts`, which Vitest would collect. Specs and their helpers in `e2e/` may
  import development dependencies such as `@playwright/test`.
- A title starts with the requirement IDs it verifies, in square brackets, then states the
  behavior: `it('[JOU-04] rejects a 31st active player', ...)`. Every acceptance criterion you
  implement gets a test that cites it.
- A meaningful test drives the public behavior with concrete inputs and exact expected values (the
  spec's own examples whenever they exist), covers edge cases and failure paths, and fails if the
  code is wrong. Do not mock the unit under test or assert implementation details. Use fast-check
  property tests for calculations. Modules that read the environment when they load (`@/lib/env`,
  `@/lib/log`) are tested with `vi.stubEnv`, `vi.resetModules()` and a dynamic `import()`.
- Coverage counts every file in `src/`: at least 90% per file for lines, branches, functions and
  statements, and 100% in `src/lib/stats-engine/`. Next.js route shells (`page.tsx`, `layout.tsx`
  and the others listed in `scripts/route-shells.ts`) are excluded, so lint keeps them thin: no
  loops, `switch` or `try`, no top-level helper or class, only the exports Next.js reads, and at
  most 60 lines per file and a complexity of 3 per function. What fits under those caps (a
  condition, an inline callback) goes untested, so keep it trivial; `route.ts` handlers are
  covered.

## End-to-end tests

- `bun run e2e` builds the app and runs `e2e/` with Playwright in Chromium, on a desktop in the
  light theme and on a phone in the dark one, against `next start`, never `next dev`. Each lot
  has its own hermetic server, with `EGOSCOPE_LOT` set, on a port that the system picks
  (`playwright.config.ts`). `bun run e2e:ui` opens Playwright's UI, without the lock. Install
  the browser once with `bun x playwright install chromium`. The report and the traces of the
  failed tests land in `reports/e2e/`.
- One journey per screen task, in `e2e/<screen>.spec.ts` (`e2e/lot2/` for Lot 2), its titles
  citing the requirement IDs it verifies, as in unit tests.
- Take `test` and `expect` from `e2e/fixtures/test.ts`, which bring the accessibility watch of
  the next section.
- Locate elements by role and label (`getByRole`, `getByLabel`), as a person and a screen
  reader find them, never by CSS, XPath or a test id, and act on them as a person does, never
  with `dispatchEvent`, before which the watch cannot check the page. No sleeps and no waiting
  for the network to go quiet: wait with web-first assertions for what the owner would see.
- The hermetic mode, `EGOSCOPE_FAKES=all`: every outside service is a fake, and without a
  database URL the database is PGlite in memory, fresh at each start. `EGOSCOPE_FAKES` beside
  a real credential, which `src/lib/env/server-env.ts` marks as such, or on a production
  deployment makes the configuration invalid, and the server refuses to start. `isHermetic()`
  from `@/lib/env` says whether the mode is on.
- `/api/test/*` controls the running app from the specs, in the hermetic mode only: every route
  there calls `isHermetic()` first, after `await connection()`, and answers 404 otherwise, as
  `/api/test/ping` does. A new control is a coordinator decision.

### The accessibility watch

The watch of `e2e/fixtures/test.ts` checks the document of a watched page with axe's WCAG 2.2 A
and AA rules:

1. before every action and every web-first assertion on a locator, and before each of their
   retries, when the document changed since its last check;
2. before every navigation that the test itself starts on the page (`goto`, `reload`, `goBack`,
   `goForward`) and before `close`, of the page or of its browser context, when it changed since
   its last check;
3. when the test ends, whatever changed.

- A change is one of these signals: a new document or a new address, a new fragment included; a
  DOM mutation of any kind (child list, attributes, character data); an `input` or `change`
  event; the top layer opening or closing (the toggle events of a popover or of a dialog); a new
  viewport size; new emulated media (color scheme, reduced motion, forced colors); a move of the
  focus.
- Each check first lets the page's animations end, for a second at most, and clears the mark of
  a change before axe runs, so that a change made during the check is not lost.
- The watch does not see a state that shows by CSS alone with none of these signals, such as a
  hover style or the end of an animation that the one-second wait did not cover. Check such a
  state, or any state at a moment of your choosing, with `await accessibility.check()`, or
  `accessibility.check(otherPage)` for another page.
- A check that a new document interrupts is dropped: the state that it was reading is gone, and
  the new document is checked in its turn. A document that the app leaves by itself before the
  test acts on it is not reported as unchecked. Only a violation, or a document that the test
  itself left unchecked, fails the test: a document on which no check began, whose departure
  raw keyboard, mouse or touch input of the test began. The input begins a departure that starts
  while the browser itself dispatches an event of the input (a key going down or up, a button
  pressed or released, a click, a touch beginning or ending) or the `beforeinput`, `input`,
  `change` or `submit` event that it fires in response, whether a handler of the event leaves or
  the browser does, as it follows a link; and the navigation that the browser then queues for a
  submission of a form that the input made, itself or through such a handler (`requestSubmit()`,
  `submit()` or a click of a submit button). Any other departure is the app's own, such as one
  that begins after a timer or a request, even one that a handler of the input started or one of
  a form that the input submitted before, or one that a script of the test starts.
- Playwright runs the checks of point 1 only while the body of the page has a box, which the root
  layout's `min-h-dvh` gives it: a check of a loaded page reports a body that has none.
- A page that the test opens beside its `page`, such as a popup or the page of a second browser
  context for another device, is watched once the test passes it to
  `await accessibility.watch(otherPage)`.

## Mutation testing

- Stryker mutates the non-test files of the pure core (`src/lib/stats-engine/` and
  `src/lib/ai-exchange/`), one fault at a time, and runs only their own tests against each
  mutant: `vitest.stryker.config.ts` holds no other. Every mutant must be killed: a run below a
  100% mutation score fails.
- Code that runs when a module loads, such as a named constant, a pattern or a lookup table, is
  tested like any other, and afresh in every run (`scripts/mutation-run.ts`): Stryker activates
  its mutant before the tests load, and runs against it every test of the pure core that imports
  its file, directly or not.
- `bun run test:mutation` runs it, under the shared lock. `bun run gate` runs it from scratch
  (`--force`), and only when one of these differs from `origin/main`: a file of the pure core,
  `stryker.config.ts`, `scripts/mutation-run.ts`, `.github/workflows/mutation.yml`,
  `vitest.stryker.config.ts`, `vitest.config.ts`, `package.json`, `bun.lock`,
  `scripts/mutation-scope.ts`, `tsconfig.json` or a file of `data/`. The `mutation` workflow does
  the same in CI, where no result of an earlier run is kept.
- A run of your own is incremental: it records its results in `reports/` (git-ignored), and the
  next tests only the mutants of what changed, and those of code that runs when a module loads.
  Stryker tells whether a mutant changed by its own code alone, and whether a test changed by its
  own lines alone, from its start to the start of the next test. So an incremental run does not
  see a change to anything else that a test runs or reads: a helper, a constant or an arbitrary
  of a test file (above its first test, say), another function of the pure core, a fixture, a
  dependency or the configuration. After such a change, run `bun run test:mutation --force`.
- A survivor, shown in `reports/mutation/mutation.html`, is a wrong formula or check that the
  tests let through: write the test that fails on it, with exact expected values. Prompt and
  message texts are asserted exactly, which kills their string mutants.
- Only a genuinely equivalent mutant, which no test can tell from the code, may be spared, on
  its own line, by the one Stryker comment allowed (see "Never weaken the gate"). It names its
  mutators, never `all` in any letter case, and its reason says why no test can tell the mutant
  apart. Never disable a mutator for a whole file.

## Requirement traceability

Every requirement and acceptance criterion of the specs is verified by a test that names it, or
listed in `docs/engineering/requirement-waivers.md` with its reason. `bun run trace`, one of the
static checks, fails on a title ID that the specs do not define, on an ID in other square brackets
than those a title starts with, and on an unsound register. On a pull request, the `trace` workflow
also fails on a description without a "Requirements covered" heading, unless the dependency-update
bot opened the pull request, and when an ID listed under that heading has neither a test nor a
waiver. There, and in the other brackets of a title, a token counts as an ID when no letter or digit
touches it and its prefix, its letters before the first hyphen, is that of an ID the specs define:
`JOU-4` counts, and fails, while `SHA-256` does not.

- A test or suite title cites the IDs it verifies in the square brackets it starts with, one per
  pair: `[JOU-04]`, and `[CA-JOU-02]` for a criterion, numbered as
  `docs/engineering/acceptance-criteria-index.md` says. Hypotheses, questions, decisions and
  rulings (`[H-13]`, `[CL-STA-01]`) may be cited; none needs a test.
- A `waiver` is legitimate only when no automated test can or must verify the requirement: a
  documentation requirement, or one that a decision record overrides. A waived ID has no test, and
  its entry names no part and gives its reference.
- A `limit` is legitimate only when tests prove the application's part and one named part can only
  be checked by hand, such as a real language model's answers or a text an outside AI writes. It
  names that part and its manual check, and the ID keeps its tests.
- Reviewers read every waiver and every limit, as they read every disable comment.

## Database

- The application reaches Postgres only through `@/lib/db`: `getDb()` for everything it does
  (Neon's pooled connection, PgBouncer in transaction mode), `getDirectDb()` for migrations and
  long reads such as the backup export. Both are async and return `{ ok: true, db }` or
  `{ ok: false, error }`: on Vercel without a URL the database is "not configured", never PGlite.
  Outside Vercel without a URL, both give one PGlite database, on disk in `.pglite/` under
  `next dev` and in memory otherwise, migrated on first use.
- Nothing connects at import or start-up: call `getDb()` where a query follows, never at module
  level. The free plan bills compute for five minutes after each query and allows 100
  compute-hours a month, so code that does not query (an idle tick, `/api/health`, the request
  proxy) never asks for the database.
- The pooled connection keeps no session state: never `SET` or `RESET`, `LISTEN` or `NOTIFY`,
  SQL-level `PREPARE`, temporary tables or session-level advisory locks. Interactive transactions
  work (`db.transaction`, one client from `BEGIN` to `COMMIT`); a single-run lock is a lease row or
  `pg_advisory_xact_lock` inside a transaction.
- Name a Drizzle database `db` and a transaction `tx`: lint refuses a `delete` or an `update` on
  them without `.where(...)`.
- The schema follows the data model: one file per owning module, `src/lib/db/schema/<module>.ts`,
  re-exported by `schema/index.ts` and, table by table, by `src/lib/db/index.ts`. Tables are
  snake_case plurals and columns snake_case, each named explicitly; `id` is an integer identity
  primary key unless a spec demands another identifier (a random uuid for followed players, the
  slug for event types, `id = 1` for singletons); instants are `timestamptz` and calendar dates
  `date`; enumerations are `text` with a `CHECK` built from one `as const` array, never Postgres
  enum types; every foreign key states its `on delete`; `created_at` and `updated_at` exist where
  the specs need them.
- After a schema change, run `bun run db:generate` and commit `drizzle/`. `bun run db:check`, the
  drift check of CI, fails when the schema and `drizzle/` differ, when the migrations do not
  build the schema from an empty database, or when they build another database than the SQL that
  drizzle-kit generates from the schema alone, as a migration edited by hand does. Nobody
  migrates by hand (TRV-76): the production build runs `db:migrate` (`scripts/migrate.ts`) before
  `next build`, through the direct connection, and only when `VERCEL_ENV` is `production`.
- Drizzle's migrator applies a migration only when its `when` in `drizzle/meta/_journal.json` is
  later than that of the last one applied, and skips any other without a word: `bun run db:check`
  refuses a journal whose `idx` and `when` do not both increase. A conflict in `drizzle/meta/`
  after a rebase is resolved by generating the migration again, never by hand: take
  `drizzle/meta/` as `origin/main` has it, journal and snapshots
  (`git restore --source=origin/main --staged --worktree drizzle/meta`), delete only the `.sql`
  files of your own migrations, then run `bun run db:generate`.
- A test gets a database of its own from `createTestDatabase()`: in memory, every migration
  applied. Close it when the test ends, `onTestFinished(database.close)`, since an open one holds
  about 200 MB.
- `next dev` migrates the PGlite of `.pglite/` at its first query, then keeps it through every
  reload until it stops: restart `next dev` after `bun run db:generate` to apply a new migration.
- No test reaches the database that the shell running it points to, which may export the
  production connection strings (TRV-76), and no test depends on any other variable that the
  shell exports. The environment is read once, when `@/lib/env` loads, and is valid or invalid as
  one whole: one refused value, such as a connection string with `sslmode=require` or
  `LOG_LEVEL=INFO`, invalidates all of it, and a valid one, such as `LOG_LEVEL=error`, changes
  what the logger writes. So every test starts from every variable of the schema in
  `src/lib/env/server-env.ts` pinned, whatever the shell exports: `test.env` in `vitest.config.ts`
  sets `NODE_ENV` to `test` and the others to `''`, which leaves them unset, and a test of
  `src/lib/env/` fails when a variable of the schema is missing there, so a new variable joins
  that list in the same change. A test that loads `@/lib/env` afresh, directly or through a module
  that reads it such as `@/lib/log` or `@/lib/db`, stubs only what it needs before loading it; a
  test that starts a script that loads `@/lib/env` passes its own environment on, then adds what it
  needs, as `scripts/migrate.test.ts` does. A Vercel deployment must carry every value that its lot
  requires, so a test that plays one, with `VERCEL_ENV` set, stubs them all. `createTestDatabase()`
  reads no variable.
- The databases that `getDb()`, `getDirectDb()`, `ping()` and `migrateDatabase()` open stay on
  `globalThis` for the life of the process, so a test that plays a fresh server also stubs that
  registry away, as the tests of `src/lib/db/` do.

## The local loop

- Heavy scripts (`typecheck`, `lint`, `lint:fix`, `test`, `test:coverage`, `test:mutation`,
  `build`, `knip`, `check:changed`, `gate`) queue across worktrees on a lock with two slots in the
  shared git directory: a whole-project script, every test run included, runs alone on the first,
  and a narrow one, an eslint run with paths
  (`bun scripts/with-lock.ts node_modules/.bin/eslint <paths>`), on either, so run the narrowest
  command that answers your question. The lock refuses watch, UI and dev-server modes; for watch
  mode, run `bun x vitest`.
- While developing, run `bun run check:changed` (format, lint and tests for what differs from
  `origin/main`, plus the whole-project type check) and targeted tests: `bun run test <path>`.
- The coverage of one module, without the per-file thresholds of other files failing the run:
  `bun run test src/lib/<module> --coverage --coverage.include='src/lib/<module>/**'`.
- The full gate is CI's job on every push. Run `bun run gate` locally only after changing tooling,
  CI or dependencies, or when a CI failure does not reproduce with `check:changed`. CI is the
  arbiter.

## Never weaken the gate

Never weaken a lint rule, a TypeScript option, a coverage threshold or a test to get green, and
never switch a check off from the source. Three comments are allowed, each with its reason:

- `eslint-disable-next-line` with a `-- reason`, never for the architecture and size rules, nor
  for the bans below;
- in tests only, `@ts-expect-error`;
- the one deliberate exception to the bans: for a genuinely equivalent mutant, in the non-test
  files of `src/lib/stats-engine/` and `src/lib/ai-exchange/`,
  `// Stryker disable next-line <Mutator>[,<Mutator>…]: <reason>`, with a reason of at least 20
  characters. Reviewers read every such reason.

Lint, the structure check and commitlint refuse everything else:

- coverage hints of the whole `v8`, `c8`, `istanbul` and `node:coverage` family (`ignore` with
  `next`, `if`, `else`, `file`, `start` or `stop`, and `disable` or `enable`), in any comment and on
  any line of covered code;
- `@ts-ignore`, `@ts-nocheck`, triple-slash references and every other ESLint comment;
- `prettier-ignore`, markdownlint and shellcheck comments, every other Stryker comment (`all`, a
  block, no mutator or no reason), and knip's `@public`, `@beta`, `@alias` and `@internal` tags;
- React's `'use no memo'`, and tests that are skipped, focused, conditional or expected to fail;
- commit messages and pull request titles that make GitHub skip CI (`[skip ci]` and the like).

Fix the code; if a rule is wrong, say so in the PR instead.

## Definition of done

`bun run check:changed` passes locally (and `bun run gate` after a tooling, CI or dependency
change), every required check is green on the last push, and the PR template is filled in. A new
heavy script, such as `e2e` or `test:mutation`, runs through `bun scripts/with-lock.ts`.

CI checks come in two kinds:

- An ordinary check is a job of `.github/workflows/ci.yml` (reuse
  `./.github/actions/setup-project`) listed in the `needs` of `ci-ok`; its local counterpart goes
  into the `gate:ci` script, in the same order.
- A concern with its own triggers, permissions or runtime gets its own workflow file instead, which
  ends in one final job named after the file: the planned ones are `e2e`, `mutation`, `trace` and
  `security`. That job always starts and always reports a result: it may finish at once when
  nothing relevant changed, but no path filter or condition ever skips it. It is a required check of
  `main`, like `ci-ok`.
- Every final job, `ci-ok` included, has `if: always()`, needs every other job of its file, and
  judges them with `sh scripts/ci-ok.sh`, given `NEEDS` and `EVENT` as in `ci.yml`, in a step that
  has no `if:`. If it sets `name:`, the name is its id, under which `main` requires it. No job or
  step uses `continue-on-error`. The structure check enforces this (`scripts/workflow-rules.ts`),
  where a workflow that is not a check needs an entry of its own.

## Dependencies

Add or update a dependency with `bun add --exact <name>@<version>`. `bunfig.toml` refuses any
version, direct or transitive, published less than seven days ago (`minimumReleaseAge`): pick the
newest release that is old enough, and keep packages that ship together on matching versions. An
urgent security fix that is younger gets an exact `name@version` entry in
`minimumReleaseAgeExcludes`, justified in the PR and removed once that version is seven days old.

## Security checks

`.github/workflows/security.yml` runs on every pull request, on every push to `main` and weekly. Its
final job, `security`, passes only when each of these jobs succeeded:

- `dependency-review`: the pull request adds no dependency with a known vulnerability of high
  severity or above.
- `osv-scanner`: `bun.lock`, transitive dependencies included, has no known vulnerability.
- `gitleaks`: no commit of the history, merge commits included, holds a secret. `.gitleaks.toml`
  adds rules for this application's deployment secrets, and the job first proves on fresh fake
  values that each one is caught (TRV-64).
- `zizmor`: the workflows, the setup action and `.github/dependabot.yml` have no security flaw, and
  no workflow reads a repository secret: deployment secrets stay in the hosting configuration.
- `codeql`: CodeQL's `security-extended` queries find nothing in the JavaScript and TypeScript. On
  a pull request the analysis is diff-informed: the data-flow queries that support it report
  results in the changed lines only, and the other queries in all the code. A data-flow result in
  other code therefore first fails a push to `main` or the weekly run.

When one fails, fix the cause: upgrade the package, or rewrite the code, the workflow or the branch.
A secret in any commit of the branch fails the scan until that commit is rewritten, and a real one,
once pushed, is public and must also be rotated. Never silence a finding without a written reason
in its allow-list, the only place for an exception:

- `osv-scanner.toml`: an `[[IgnoredVulns]]` entry for the advisory, with why it cannot harm this
  project, what will fix it, and an `ignoreUntil` date at most three months away.
- `.gitleaks.toml`: an `[[allowlists]]` entry for one exact dummy value of `.env.example` or of a
  test fixture, with its description; never a path or a pattern, since recorded answers of real
  services are scanned like code.
- `.github/zizmor.yml`: an ignore of one audit in one workflow, with a comment giving the reason
  and the fix it waits for. Until the workflows load the setup action as
  `$/.github/actions/setup-project`, a new workflow that reuses `./.github/actions/setup-project`
  adds itself to the `self-repository` entry, or the `zizmor` job fails.

The scans honor nothing else: no `gitleaks:allow` comment, no `.gitleaksignore` file, no inline
zizmor ignore. A CodeQL result is fixed in the code; if you are sure it is a false positive, say so
in the pull request and leave the decision to the owner.

## Git and pull requests

- One task per PR, on a branch named `type/short-slug`, for example `feat/player-list`.
- Commits and PR titles follow Conventional Commits (`feat: add the player list`); PRs are
  squash-merged with the title as the commit subject. commitlint checks both.
- Bring a branch up to date with `git fetch origin main` and `git rebase origin/main`. A merge
  commit, if you must make one, needs a conventional message (`chore: merge origin/main into
feat/player-list`). Never commit `fixup!` or `squash!` messages: amend the commit instead.
- Every commit message ends with the `Co-Authored-By:` line of the model that wrote the commit,
  exactly as your own environment specifies it.
- The PR body follows the template: it lists the requirement IDs covered and how each was verified,
  and it ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- `bun install` installs the git hooks: pre-commit formats and lints the staged files, commit-msg
  runs commitlint. Never bypass them with `--no-verify`. Run `bun install` again after every rebase
  or checkout, so that dependencies and hooks match the lockfile, and when a commit stops with
  "Can't find lefthook in PATH".
