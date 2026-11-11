# 0011. Choosing the remaining services

- Status: Accepted
- Date: 2026-11-11

## Context

Q-02 leaves host, database, language model, statistics source and news feeds unchosen; free-tier terms change and must be checked at technical design. [14](../14-exigences-transverses.md) gives the method:

- TRV-09: each chosen service is documented — role, free offer, limits, date its terms were checked, where to read them, behavior at a limit, how to replace it;
- TRV-10: terms are checked again before each deployment and after a suspicious incident;
- TRV-11: a permanent free tier that covers the estimated volumes with a margin, usable from JavaScript or TypeScript, terms compatible with personal non-commercial use and, where relevant, automated access, no deletion for inactivity, data recoverable;
- TRV-12: replaceable without data loss or feature change;
- TRV-13 to TRV-19: what each kind of service must offer; TRV-02: no payment card by default.

## Decision

The orchestrator chooses the remaining services by the specs' criteria (TRV-11, TRV-12), fewest accounts first. Each must be free without a payment card, permit automated access and be replaceable, and has its service sheet (TRV-09) with its conditions checked on the day. If a service fails that check — Vercel or Neon included — it is replaced by the closest free equivalent and the reason is recorded.

## Consequences

- Still to choose: the statistics source (also [0012](0012-statistics-coverage-gives-way.md)), the language model (TRV-16), the external trigger ([0002](0002-free-hosting-on-vercel-and-neon-with-an-external-trigger.md)) and the backup storage ([0018](0018-encrypted-weekly-backups.md)). Telegram is fixed (D-30); news feeds are the owner's choice (TRV-17, COL-01); the research AI is not a service of the application (TRV-19, [0013](0013-tool-agnostic-research-ai.md)).
- "Fewest accounts first" favors an account the owner needs anyway — for example the GitHub account that holds the repository — whenever it meets the criteria.
- Each sheet carries the TRV-09 items and, for a replaced service, what failed and why the replacement is the closest free equivalent. Replacing Vercel or Neon also amends [0002](0002-free-hosting-on-vercel-and-neon-with-an-external-trigger.md).
- The limits written in the sheets become the quota parameters of TRV-03, which have no default value (TRV-39).
