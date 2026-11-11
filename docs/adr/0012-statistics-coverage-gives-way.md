# 0012. Statistics source: coverage gives way

- Status: Accepted
- Date: 2026-11-11

## Context

- D-27: the application fetches every statistic itself from a free source. D-13 and H-13: performance is the Game Score divided by minutes played.
- H-06: the backtest spans the player's whole NBA career. STA-02 and TRV-15 therefore ask the source to reach every season of the tracked players' careers, with automated access permitted.
- STA-45 and H-STA-16: if the source does not cover a season at all, the cases whose measured game falls in it are « non mesurables », reason « saison non couverte par la source », and the profile shows it.
- Q-STA-01 ([07](../07-statistiques-de-match.md)): if no free source gives the twelve Game Score items and the minutes over whole careers, should profiles be limited to the covered seasons (the STA-45 default) or the indicator be revised? The question was to be settled by the owner when the source is chosen (Q-02).

## Decision

Coverage gives way. Only sources that permit automated access are used, combining two if that reaches further back, and profiles are limited to the seasons covered: cases in uncovered seasons are « non mesurables » and the profile says so (STA-45). No undocumented endpoints, no change to the Game Score indicator, no pause in the build for the owner when the source is chosen.

## Consequences

- STA-45 binds. Profiles and general trends show which seasons the source covers and count the non-measurable cases by reason (SEN-20).
- The research prompt still spans the whole career (H-06, BKT-08): events of uncovered seasons are imported and counted, never measured.
- When the source does not reach a player's first game, STA-47 answers « date inconnue » and the prompt asks the AI to start from the first NBA game, as specified (BKT-08).
- The statistics service sheet states, for each source, the first season with complete box scores and minutes.
- H-13, STA-11 and STA-12 stay as written.
- The calendar-derived types depend on covered seasons as well ([0015](0015-calendar-derived-event-types.md)).

## Open points

- Two combined sources: each tracked player then needs one confirmed identity per source (STA-03, JOU-10), and the specs do not say whether one season reference may mix box scores from two sources. Recommended handling: one source per season, chosen in the service sheet.

## Alternatives considered

From Q-STA-01 and the decision:

- Revising the indicator (D-13, H-13) to fit a poorer source. Not retained.
- Undocumented endpoints that reach further back. Not retained.
