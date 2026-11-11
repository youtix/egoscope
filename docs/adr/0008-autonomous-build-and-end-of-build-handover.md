# 0008. Autonomous build, accounts and secrets handed over at the end

- Status: Accepted
- Date: 2026-11-11

## Context

- TRV-10: the terms of free tiers are checked at technical design, again before each deployment, and whenever an incident suggests a change.
- TRV-37 and TRV-64: the deployment configuration (service addresses, access keys, Telegram token, initial password, trigger secret) is entered outside the application, in the host's configuration. TRV-75: the owner deploys by following the guide.

## Decision

- No checkpoints during the build: the orchestrator merges every pull request itself, on green CI plus a clean independent review.
- Nothing is deployed or tried by the owner until everything exists.
- Accounts and secrets remain the owner's to create and enter, from one list handed over at the end.

## Consequences

- The build never uses real accounts or secrets: CI and end-to-end tests run against local or simulated services.
- Questions are settled in records rather than by asking the owner. A point that no record settles is raised with the orchestrator, never left to the implementer's choice ([deviations register](../engineering/spec-deviations.md), "Open points").
- One list, delivered with the deployment guide ([0014](0014-developer-level-deployment-guide.md)), names every account to create and every configuration value with where to find it, including those added by later records: database connection, initial password, trigger secret ([0002](0002-free-hosting-on-vercel-and-neon-with-an-external-trigger.md)), fingerprint secret ([0017](0017-temporary-fingerprint-of-withdrawn-events.md)), backup encryption key and backup storage token ([0018](0018-encrypted-weekly-backups.md)), statistics key if the source needs one, language-model key, Telegram token.
- Service terms are checked during the build ([0011](0011-choosing-the-remaining-services.md)) and again by the owner before the first deployment (TRV-10); the guide says so.
