# 0016. Per-type switch for one doubtful-case criterion

- Status: Accepted
- Date: 2026-11-11

## Context

- D-19 and SEN-11 to SEN-15 ([08](../08-sensibilite-et-verdict.md)): a case is doubtful, hence excluded, when an automatic criterion applies — playing time too low (SEN-12), return from injury (SEN-13), unusual stakes (SEN-14), opponent strength (SEN-15), or co-occurring cases when its parameter is on (SEN-06); the owner may also exclude or reinstate a case by hand (SEN-17).
- D-34: the « record négatif à éviter » type is played almost always in a high-stakes game. By default all its cases are excluded for unusual stakes, and its profile says so (edge cases of 08).
- Q-SEN-01, which Q-TAX-02 also points to for the approach of a record: should one criterion be switched off for a precise type, with a permanent warning on its profiles, should these cases be compared with similar games without an event, such as the player's other elimination games, or should a criterion specific to the type be added? Meanwhile the common rule applies.

## Decision

An event-type sheet can switch off one doubtful-case criterion, for example the stakes criterion SEN-14 for the « record négatif » type. The switch is off by default, so the common rule applies until the owner decides type by type. Profiles of a type with a criterion switched off carry a permanent warning that the effect cannot be separated from the confounder.

## Consequences

- The type sheet (TAX-01) gains an optional field naming at most one of the automatic criteria SEN-12 to SEN-15, or SEN-06 when its parameter is on. It is empty by default, in the seed drafts too.
- When set, that criterion is not applied to the type's cases. Every other criterion, the manual decisions (SEN-17) and the controls (SEN-27) still apply.
- The warning belongs to the profile warnings (SEN-46): it shows on the type's profiles and general trend wherever they appear, including the alert-sheet reserves (ALE-16) and the reserves of the Telegram alert (TEL-11), and it stays as long as the switch is on.
- Changing the switch is recorded in the sheet history (TAX-21). It creates no new sheet version, since the facts that belong to the type do not change (TAX-22). It triggers a full recalculation (SEN-34) whose verdict changes carry the cause « changement de paramètre » (SEN-37), and it counts as a change that affects calculations for TRV-35 and IHM-51.

## Alternatives considered

From Q-SEN-01:

- Comparing the type's cases with similar games without an event, such as the player's other elimination games. Not retained.
- Adding a criterion specific to the type. Not retained.
- Keeping the common rule only. Kept as the default, until the owner switches a criterion off.
