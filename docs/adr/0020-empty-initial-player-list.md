# 0020. The app starts with an empty player list

- Status: Accepted
- Date: 2026-11-11

## Context

- Q-03: the 20 to 30 tracked players are not designated.
- JOU-06 ([01](../01-joueurs-suivis.md)): since the initial list is not designated, the application starts without any player and proposes no predefined list; until a player is tracked, the to-do list invites the owner to add some. JOU-04 caps active players at 30 and gives an indicative minimum of 20. JOU-10: each player is confirmed against the statistics source.

## Decision

The app starts empty (JOU-06), and the owner adds their 20 to 30 players in the app, each confirmed against the statistics source (JOU-10).

## Consequences

- No player is seeded. Seeds and fixtures never contain real players ([0006](0006-public-specs-without-license-or-real-players.md)).
- First-run screens follow JOU-06, IHM-53 and IHM-54.

## Alternatives considered

- A predefined starting list. Not retained, as JOU-06 already excludes it.
