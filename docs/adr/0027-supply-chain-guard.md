# 0027. Supply-chain guard on dependencies

- Status: Accepted
- Date: 2026-11-11
- Decided by: the coordinator, under records [0003](0003-public-repository-and-pull-request-workflow.md) and [0004](0004-quality-bar.md)

## Context

The code lives in a public repository and merges without owner checkpoints (records 0003 and 0008); dependencies are installed with Bun ([0026](0026-runtime-node-in-production-bun-for-tooling.md)). A compromised release of a package is usually caught and pulled within days of its publication, and the specs keep secrets out of the code (TRV-64).

## Decision

- A dependency version younger than seven days is refused at install, direct or transitive, through Bun's minimum release age.
- Exact versions are pinned.
- An exception names one exact version, is justified in its pull request, and is removed once that version is seven days old.

## Consequences

- `bunfig.toml` sets the minimum release age to 604,800 seconds and pins exact versions; `bun add --exact <name>@<version>` adds a dependency, picking the newest release that is old enough and keeping packages that ship together on matching versions.
- Exceptions are reserved for an urgent security fix, listed as exact `name@version` entries, and checked by the reviewer.
- CI installs from the frozen lockfile, under the same settings.

## What would change it

- Bun drops the setting: an equivalent guard in the registry configuration or in CI.
- A supply-chain incident shows seven days to be too short: a longer age, by amending this record.
