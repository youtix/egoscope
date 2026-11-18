# 0003. Public repository, one pull request per task, merge on green CI and independent review

- Status: Accepted
- Date: 2026-11-11

## Context

The specs are functional and written for a development agent (D-21); they set no delivery workflow. Three requirements touch it: TRV-64 keeps every secret out of the code, TRV-77 asks for updates preceded by a backup and reversible, and TRV-79 asks for release notes and a status of every requirement with the means to check it.

## Decision

The code lives in a public GitHub repository. Each task gets one pull request; each agent works in its own worktree and branch. A pull request merges only with green CI plus an independent review.

## Consequences

- Since the repository is public, no secret, real player name or personal data ever enters it (TRV-64, [0006](0006-public-specs-without-license-or-real-players.md)); the deployment configuration is documented by an example file with placeholder values.
- Each pull request names the requirement IDs it implements and the rows of the [deviations register](../engineering/spec-deviations.md) it relies on, so that the reviewer reads the right text.
- The reviewer checks the change against the French spec, the register and the records together. A change that departs from all three is rejected, or comes with a new record and register row.
- The merged history feeds the release notes and the requirement status of TRV-79.
