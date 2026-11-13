# 0026. Runtime: Node.js in production, Bun for tooling

- Status: Accepted
- Date: 2026-11-11
- Decided by: the orchestrator, applying record [0002](0002-free-hosting-on-vercel-and-neon-with-an-external-trigger.md)

## Context

- Record 0002: Bun for install, scripts and tests; Bun as the production runtime only if Vercel's Bun runtime proves stable, otherwise Node.
- The hosting sheet (`docs/services/hosting.md`, checked on 2026-11-11): Vercel's Bun runtime is marked beta on every plan, and its current line is a rewrite with breaking changes. Vercel offers Node.js 26, 24 and 22 and follows `engines.node` of `package.json`. Node.js 22 reaches its end of life on 2027-04-30, Node.js 24 on 2028-04-30; Vercel stopped new deployments on Node.js 20 five months after that line's end of life.

## Decision

- Production runs on Node.js, because the host's Bun runtime is beta.
- Bun stays the tool for install, scripts and tests.
- Node.js 22 is used throughout the build, so that local runs, CI and production agree.
- A hardening task at the end of the build moves CI and production to the newest LTS line of Node.js that passes the gate, since support for Node.js 22 ends on 2027-04-30.

## Consequences

- One version is pinned for every environment: the toolchain's `.nvmrc` and the `engines.node` range of `package.json`, which the host follows.
- Code that runs in production uses no Bun-only API; tests that exercise production code must hold under Node.js.
- The hardening task changes the pinned version in one pull request, with the full gate and the end-to-end suite on the new line.

## What would change it

- Vercel's Bun runtime leaves beta and passes the full gate and the end-to-end suite: production may switch to Bun, by amending this record and record 0002.
- The host drops Node.js 22 earlier than planned: the hardening task moves forward.
