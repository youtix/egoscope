# 0007. Next-native module layout

- Status: Accepted
- Date: 2026-11-11

## Context

The specs prescribe no code layout. Each notion has a single spec document that owns it (README), and every requirement has an ID the code can cite. TRV-12 requires every service to be replaceable without changing the features.

## Decision

A "Next-native" layout: page-specific logic is colocated under `src/app/<route>/`; everything shared or belonging to no page — the calculation engine, the scheduled jobs, the adapters — lives in `src/lib/`.

## Consequences

- Boundary rules ([0004](0004-quality-bar.md)): `src/lib/` never imports from `src/app/`; the calculation engine imports no adapter, framework or database module.
- Each external service — statistics source, language model, Telegram, backup storage, trigger — sits behind an adapter in `src/lib/`, so that replacing it changes no feature (TRV-12, [0011](0011-choosing-the-remaining-services.md)).
- Code cites the requirement IDs it implements, so a reader can go from the code to the French spec and to the [deviations register](../engineering/spec-deviations.md).

## Alternatives considered

- A feature-first layout. Not retained.
