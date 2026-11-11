# 0014. Developer-level deployment guide

- Status: Accepted
- Date: 2026-11-11

## Context

- Q-01: the owner's development level is unknown, so everything about deployment and operations must be described very explicitly; document 00 puts in scope "un déploiement décrit pour un utilisateur dont le niveau technique n'est pas connu".
- TRV-74: the guide requires no programming skill; an unavoidable command is given to copy as is, with its expected result; each step says what it enables, what to do, what success looks like and what to do otherwise; the guide gives an estimated duration per step and defines every technical term.
- TRV-75: sixteen steps, in order. TRV-77: updates with backup and rollback, replacing a service, resetting the password. TRV-79: documentation in French, written for a non-specialist. CA-TRV-24: a person who has never put an application online succeeds with the documentation alone.

## Decision

The deployment guide is written for a developer: the sixteen steps of TRV-75 as a checklist, without definitions of basic terms and without a duration per step. This relaxes TRV-74 and its neighbors.

## Consequences

- Each checklist item says what to do and how to check that it worked, with the exact command where one is needed; no tutorial prose.
- The steps name the decided services and values: Vercel and Neon, the external trigger and its secret ([0002](0002-free-hosting-on-vercel-and-neon-with-an-external-trigger.md)), the fingerprint secret ([0017](0017-temporary-fingerprint-of-withdrawn-events.md)), the backup space, its single access token created at the end and the encryption key ([0018](0018-encrypted-weekly-backups.md)); the application comes from the public repository ([0006](0006-public-specs-without-license-or-real-players.md)); the list of accounts and values is the one of [0008](0008-autonomous-build-and-end-of-build-handover.md).
- The procedures of TRV-77 and the operations guide of TRV-79 are written at the same level.
- Unchanged: the application prepares its database itself (TRV-76); a restore needs no programming (TRV-53); the installation check reports in plain language (TRV-47); in-app help, the guided start and empty states (IHM-53 to IHM-56) still assume no technical knowledge.
- CA-TRV-24 is read for a developer who has the repository and the owner's accounts.

## Alternatives considered

- A guide for an unknown technical level, as TRV-74 and Q-01 specify. Not retained.
