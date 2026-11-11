# Egoscope

Egoscope is a personal, single-user web application that tests one hypothesis: do some NBA players
perform differently from their season norm in the first game after a public event that touches
their ego? For each followed player and each type of event, it measures the gap, with its sources
and a confidence level, then keeps testing every profile against new events.

It is a research tool, not a betting tool: it has no betting features. The hypothesis is unproven,
and the application is built to test it, which includes showing clearly when there is no effect.

The functional reference is the French specification in [`docs/`](docs/README.md); start with
[`docs/00-vue-d-ensemble.md`](docs/00-vue-d-ensemble.md). Code is tied to it by requirement IDs
such as `STA-11`. The English glossary of its terms is
[`docs/engineering/glossary.md`](docs/engineering/glossary.md).

## Stack

- [Next.js](https://nextjs.org) 16 with the App Router, React Server Components, Server Actions and
  Cache Components; React 19; Tailwind CSS 4.
- TypeScript 6 at its strictest settings.
- [Bun](https://bun.com) 1.4 installs dependencies and runs the scripts; Node.js 22 is the runtime,
  locally, in CI and in production.
- Vitest 5 with V8 coverage, Testing Library and fast-check.
- ESLint 10 with type-aware rules, Prettier, markdownlint and knip; lefthook and commitlint for git
  hooks; GitHub Actions for CI.
- Planned hosting: Vercel Hobby with Neon Postgres, on free tiers only.

## Getting started

You need Node.js 22 (the exact version is in `.nvmrc`), Bun 1.4 (`packageManager` in
`package.json`) and git. The lock that the heavy scripts share needs `flock`, which Linux
distributions ship; without it they run unlocked.

```sh
bun install                  # dependencies, and the git hooks
cp .env.example .env.local   # local settings; every variable is documented there
bun run dev                  # http://localhost:3000
```

## Scripts

| Script                   | What it does                                                     |
| ------------------------ | ---------------------------------------------------------------- |
| `bun run dev`            | Development server.                                              |
| `bun run build`          | Production build, type check included.                           |
| `bun run start`          | Serves the production build.                                     |
| `bun run test [path]`    | Unit tests, optionally only those under `path`.                  |
| `bun run test:coverage`  | All unit tests, with the coverage thresholds enforced.           |
| `bun run lint`           | ESLint, markdownlint and the structure check.                    |
| `bun run lint:fix`       | ESLint and markdownlint, fixing what they can.                   |
| `bun run format`         | Formats every file with Prettier (`format:check` only checks).   |
| `bun run typecheck`      | TypeScript over the whole repository.                            |
| `bun run knip`           | Unused files, exports and dependencies.                          |
| `bun run check`          | Every static check: formatting, linters, knip, workflows, types. |
| `bun run check:changed`  | The fast local check of what differs from `origin/main`.         |
| `bun run gate`           | Everything CI runs, in CI's order, under a single lock.          |
| `bun run gate:ci`        | The same steps, each taking the lock on its own.                 |
| `bun run lint:workflows` | actionlint on the workflows, when actionlint is installed.       |

`check:changed` runs Prettier, ESLint, markdownlint and the structure check on the files that
differ from `origin/main` (committed, staged, unstaged or untracked), type-checks the whole project
incrementally, then runs the tests related to the changed files, or all of them when tooling
changed. It stops at the first failing step. CI runs the full gate on every push.

Several agents may share one machine, so the heavy scripts (`build`, `typecheck`, `lint`,
`lint:fix`, `test`, `test:coverage`, `knip`, `check:changed` and `gate`) take turns on one lock that
every worktree of the clone shares: `egoscope-heavy.lock` in the git directory, managed by
[`scripts/with-lock.ts`](scripts/with-lock.ts). A waiting script says whom it waits for and for how
long, and gives up when one run has held the lock for more than 30 minutes. CI never locks.

## Layout

```text
src/app/                 Routes. Code used by one page sits flat in its route folder.
src/app/layout.tsx       The entry point of the user interface.
src/lib/<module>/        Shared code and code that belongs to no page. index.ts is the API.
src/lib/stats-engine/    The pure statistics core, covered at 100%.
src/lib/env/             The validated server environment, the only reader of process.env.
src/lib/log/             The server logger, the only writer to the console.
data/                    Seeds, fixtures and raw data. Never code.
docs/                    French functional specifications (frozen); English docs in docs/engineering/.
scripts/                 Repository tooling: the shared lock, the structure check.
.github/                 CI workflow, its shared setup action, the pull request template.
```

## Entry points

- **User interface**: [`src/app/layout.tsx`](src/app/layout.tsx), the root layout that wraps every
  page.
- **HTTP**: route handlers under `src/app/**/route.ts`, such as the health probe
  [`src/app/api/health/route.ts`](src/app/api/health/route.ts). Scheduled work will enter through a
  single route handler, protected by a secret (TRV-65), when the first scheduled job lands.

## Quality gate

Every pull request runs the CI workflow. Its jobs (lint, actionlint, typecheck, test, build and
pr-title) all feed one final check, `ci-ok`, which branch protection requires. Lint rules have no
warnings, coverage is enforced per file (100% on the statistics core, 90% elsewhere), and pull
requests are squash-merged with a Conventional Commits title. The rules that every contributor,
human or agent, must follow are in [`CLAUDE.md`](CLAUDE.md).

## Security

See [`SECURITY.md`](SECURITY.md) to report a vulnerability privately.

## License

No license is granted: all rights reserved.
