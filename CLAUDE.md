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
- The English reference documents arrive by their own pull requests: the glossary of spec terms,
  the module map, the clarifications and the domain model in `docs/engineering/`, and the decision
  records in `docs/adr/`. When one is missing from your checkout, your task brief says what to use
  instead.
- No real NBA player names anywhere, fixtures included: invent players. No personal names or email
  addresses.

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

## The local loop

- Heavy scripts (`typecheck`, `lint`, `lint:fix`, `test`, `test:coverage`, `build`, `knip`,
  `check:changed`, `gate`) queue behind each other across worktrees on one lock,
  `egoscope-heavy.lock` in the shared git directory, so run the narrowest command that answers your
  question. The lock refuses watch, UI and dev-server modes; for watch mode, run `bun x vitest`.
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
  judges them with `sh scripts/ci-ok.sh`, given `NEEDS` and `EVENT` as in `ci.yml`. No job or step
  uses `continue-on-error`. The structure check enforces this (`scripts/workflow-rules.ts`), where a
  workflow that is not a check needs an entry of its own.

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
- `gitleaks`: no commit of the history holds a secret. `.gitleaks.toml` adds rules for this
  application's deployment secrets, and the job first proves on fresh fake values that each one is
  caught (TRV-64).
- `zizmor`: the workflows, the setup action and `.github/dependabot.yml` have no security flaw, and
  no workflow reads a repository secret: deployment secrets stay in the hosting configuration.
- `codeql`: CodeQL's `security-extended` queries find nothing in the JavaScript and TypeScript.

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
  and the fix it waits for.

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
