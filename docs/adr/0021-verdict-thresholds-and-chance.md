# 0021. Editable verdict thresholds; chance shown, not corrected

- Status: Accepted
- Date: 2026-11-11

## Context

- Q-04: the values that separate « probable », « possible » and « non concluant » are not fixed. SEN-23 and H-SEN-10 ([08](../08-sensibilite-et-verdict.md)) propose defaults, all configurable: inconclusive under 5 valid cases (H-03); probable when the absolute signal-to-noise ratio reaches 3 and the absolute mean gap 0.40; possible when, without being probable, they reach 2 and 0.25.
- Q-VUE-01 ([00](../00-vue-d-ensemble.md)): with 20 to 30 players and several types, chance alone will produce verdicts. The default answer of 08: a stricter threshold for « probable » and, next to the profile list, the number of verdicts chance alone would produce, without correcting the verdicts (SEN-41, H-SEN-14). Still open: should the thresholds take the number of evaluated player–type pairs into account?

## Decision

The default thresholds are editable settings — signal-to-noise 2 with mean gap 0.25 for « possible », 3 with 0.40 for « probable », five valid cases minimum — with no automatic correction for the number of player–type pairs. The app shows the number of verdicts chance alone would produce (SEN-41).

## Consequences

- SEN-23, H-SEN-10, H-03 and the false-signal part of H-SEN-14 bind as written.
- SEN-41: the expected false signals are the number of evaluated pairs times the two-sided tail of the normal distribution beyond each threshold (4.6% at 2, 0.27% at 3), recomputed when the owner changes a threshold. `08 AC-19` (50 pairs give about 2.3 and 0.1) is a test.
- A threshold change is traced, recalculates every profile and shows its date (TRV-35, SEN-34, SEN-37, IHM-51). The validation board never changes a threshold (SUI-29).

## Alternatives considered

- Correcting the verdicts for the number of pairs compared, the part of Q-VUE-01 left open. Not retained.
