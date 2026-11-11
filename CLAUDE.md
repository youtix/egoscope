# Egoscope: binding rules for every agent

These rules hold for every change. README.md has the overview, the stack and the scripts.

## Reference and language

- The French functional specifications in `docs/*.md` are the authoritative reference. Never edit,
  move or reformat them. When they disagree, `docs/90-journal-des-decisions.md` wins.
- Cite requirement IDs exactly as the specs write them: requirements `JOU-04`, acceptance criteria
  `CA-TRV-12`, journal entries `D-07`, `H-13`, `Q-04`, local hypotheses `H-STA-03`.
- Owner decisions override the specs where they conflict. Above all, everything is in English,
  including the UI (overriding H-11): code, comments, UI text, docs, commits and PRs, in American
  spelling. Translate spec terms with `docs/engineering/glossary.md`.
- No real NBA player names anywhere, fixtures included: invent players. No personal names or email
  addresses.

## Layout and module rules

Page-specific code sits flat in `src/app/<route>/`. Shared code, and code that belongs to no page
(calculation engine, database, scheduled jobs, external-service adapters, shared UI), lives in
`src/lib/<module>/`. Seeds, fixtures and raw data live in `data/` (import them as `@data/...`),
never in `src/`; `data/` holds no code. ESLint and `bun run lint:structure` enforce these rules:

1. `src/lib/**` never imports from `src/app/**`.
2. `src/lib/stats-engine/**` is pure. It imports nothing outside itself and uses no I/O, no Node or
   browser API, no clock (`Date.now()`, argument-less `new Date()`), no randomness, no environment
   and no async code. Pass such values in as arguments.
3. A route never imports from another route. Inside `src/app`, relative imports are `./name` only;
   code that two routes need moves to `src/lib/<module>`.
4. Other code imports a module only as `@/lib/<module>`. Its `index.ts` only re-exports, by name
   (`export { x } from './x'`). No deep imports, no import cycles.
5. At most two folder levels below `src/lib` (`src/lib/<module>/<sub>/file.ts`); no `_private`
   folders under `src/app`.
6. File and folder names are kebab-case (Next.js special files and route segments such as
   `[playerId]` excepted). No default exports except where Next.js requires one. No enums: use
   `as const` objects or unions of literals.

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

## Tests

- A test sits beside the file it tests: `foo.test.ts` next to `foo.ts`. Component tests are
  `.test.tsx` files and run in jsdom. Playwright specs must not use the `.test.ts` suffix, which
  Vitest collects and the structure check pairs with a source file: name them `.spec.ts`.
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
  and the like) are excluded and kept thin by lint; `route.ts` handlers are covered.

## The local loop

- Heavy scripts (`typecheck`, `lint`, `lint:fix`, `test`, `test:coverage`, `build`, `knip`,
  `check:changed`, `gate`) queue behind each other across worktrees on one lock,
  `egoscope-heavy.lock` in the shared git directory, so run the narrowest command that answers your
  question.
- While developing, run `bun run check:changed` (format, lint and tests for what differs from
  `origin/main`, plus the whole-project type check) and targeted tests: `bun run test <path>`.
- The coverage of one module, without the per-file thresholds of other files failing the run:
  `bun run test src/lib/<module> --coverage --coverage.include='src/lib/<module>/**'`.
- The full gate is CI's job on every push. Run `bun run gate` locally only after changing tooling,
  CI or dependencies, or when a CI failure does not reproduce with `check:changed`. CI is the
  arbiter.

## Never weaken the gate

Never weaken a lint rule, a TypeScript option, a coverage threshold or a test to get green. Every
`eslint-disable-next-line` needs a `-- reason`, and the architecture and size rules cannot be
disabled at all. Fix the code; if a rule is wrong, say so in the PR instead.

## Definition of done

`bun run check:changed` passes locally (and `bun run gate` after a tooling, CI or dependency
change), CI is green (`ci-ok`) on the last push, and the PR template is filled in. New CI jobs go in
`.github/workflows/ci.yml` (reuse `./.github/actions/setup-project`) and in the `needs` of `ci-ok`;
their local counterpart goes into the `gate:ci` script, in the same order. A new heavy script, such
as `e2e` or `test:mutation`, runs through `bun scripts/with-lock.ts`.

## Dependencies

Add or update a dependency with `bun add --exact <name>@<version>`. `bunfig.toml` refuses any
version, direct or transitive, published less than seven days ago (`minimumReleaseAge`): pick the
newest release that is old enough, and keep packages that ship together on matching versions. An
urgent security fix that is younger gets an exact `name@version` entry in
`minimumReleaseAgeExcludes`, justified in the PR and removed once that version is seven days old.

## Git and pull requests

- One task per PR, on a branch named `type/short-slug`, for example `feat/player-list`.
- Commits and PR titles follow Conventional Commits (`feat: add the player list`); PRs are
  squash-merged with the title as the commit subject. commitlint checks both.
- Every commit message ends with the `Co-Authored-By:` line of the model that wrote the commit,
  exactly as your own environment specifies it.
- The PR body follows the template: it lists the requirement IDs covered and how each was verified,
  and it ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- `bun install` installs the git hooks: pre-commit formats and lints the staged files, commit-msg
  runs commitlint. Never bypass them with `--no-verify`. Run `bun install` again after every rebase
  or checkout, so that dependencies and hooks match the lockfile.
