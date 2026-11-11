# 0009. The minor open questions keep the spec defaults

- Status: Accepted
- Date: 2026-11-11

## Context

The section "Points à trancher avant de développer" of the [README](../README.md) lists the twelve most structuring questions. The specs hold nine more local open questions, each with a default the spec documents but leaves to confirm.

## Decision

The twelve points are all settled before any code, by records 0011 to 0022 (see the [index](README.md)). The nine minor open questions keep the defaults the specs document; Q-SEN-04 does so only where the calendar decision ([0015](0015-calendar-derived-event-types.md)) does not cover it.

| Question                                                          | Binding default                                                                                                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q-JOU-01 (01) — first game after a team change                    | SEN-16 and H-SEN-08: the case is flagged for review on the case and in the to-do list, never excluded automatically.                             |
| Q-COL-01 (03) — fill a collection gap from news archives          | COL-47: nothing beyond the catch-up of COL-45; the gap stays visible (COL-46).                                                                    |
| Q-COL-02 (03) — starting list of sources                          | COL-01: no source is preinstalled and no starting list is proposed; the owner adds every source.                                                 |
| Q-DET-01 (04) — declare an event from a link that was not collected | Not provided: only collected articles can be classified or recovered by hand (DET-13, DET-49).                                                  |
| Q-IMP-02 (06) — add a historical event by hand                    | Not provided: historical events come only from imports.                                                                                           |
| Q-SEN-02 (08) — weight the general trend per case or per player   | Per case (SEN-28, H-SEN-13), with the safeguards of SEN-29.                                                                                       |
| Q-SEN-03 (08) — add a recent-form reference                       | Not added: the season reference alone (D-07, STA-16).                                                                                             |
| Q-SEN-04 (08) — precise game missed for a known-in-advance type   | For the calendar-derived types, the case is « non mesurable » ([0015](0015-calendar-derived-event-types.md)); for any other type, SEN-02 as written. |
| Q-SUI-01 (10) — use the validation board to revise thresholds     | Never automatically; only an explicit decision of the owner (SUI-29).                                                                             |

## Consequences

- Implementers treat these defaults as decided; none of them is a reason to stop and ask.
- Q-05, Q-06 and Q-07 stay outside the first version, as the decision journal says. Q-ALE-01 and Q-TEL-01 were already answered by the specs themselves (SUI-06; DSN-35 and H-DSN-12).
- Local hypotheses marked « à confirmer » are implemented as written, unless the [deviations register](../engineering/spec-deviations.md) says otherwise.
