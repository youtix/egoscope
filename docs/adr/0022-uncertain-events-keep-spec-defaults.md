# 0022. Uncertain events keep the spec defaults

- Status: Accepted
- Date: 2026-11-11

## Context

- Q-BKT-01 ([05](../05-demande-de-backtest-et-prompt.md)): should historical events whose research confidence is « faible » be excluded from the calculations, or counted like the others? Default: counted, and their number shown with the profile (SEN-43, H-SEN-16).
- Q-IMP-01 ([06](../06-import-des-resultats-de-recherche.md)): an event whose oldest source is dated the day of the measured game, without a time — doubtful case, valid case, or measured on the next game? Default (SEN-44, H-SEN-15): the source is deemed published at the end of that day, Pacific time, so the game of that day does not count, and the case is measured on the next game played, marked « antériorité incertaine ». IMP-18 classifies the precedence.

## Decision

Both defaults hold. Low-confidence events count like the others, and the profile shows how many cases rest on one (SEN-43). A same-day source without a time moves the case to the next game, marked « antériorité incertaine » (SEN-44).

## Consequences

- SEN-43, SEN-44, H-SEN-15, H-SEN-16 and the last sentence of IMP-18 bind as written; Q-BKT-01 and Q-IMP-01 are closed.
- Profiles and general trends show how many of their valid cases rest on a low-confidence event.
- IMP-18 always classifies precedence against the game given by SEN-01 to SEN-03, before any shift, so a shift for uncertain precedence never undoes itself; adding an older source (IMP-32) re-runs the classification (SEN-44).

## Alternatives considered

From Q-BKT-01 and Q-IMP-01:

- Excluding low-confidence events from the calculations. Not retained.
- Treating uncertain precedence as a doubtful case, or as a valid case on the same-day game. Not retained.
