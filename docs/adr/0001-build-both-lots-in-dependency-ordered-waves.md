# 0001. Build both lots in one run, in dependency-ordered waves

- Status: Accepted
- Date: 2026-11-11

## Context

The specs split the application into two lots, as a drafting hypothesis still to confirm (H-12; [00 — Lots](../00-vue-d-ensemble.md); [README](../README.md)). Lot 1 is the minimal application of D-22: tracked players, taxonomy, backtest requests triggered by hand, research prompt, JSON import, statistics, sensitivity calculation, profiles. Lot 2 adds daily collection and detection, detection-born requests, the alert sheet, automatic tracking, the validation board and Telegram. Every requirement carries its lot.

VUE-06 requires Lot 1 to work alone, from adding a player to reading his profile, without any Lot 2 function; acceptance criterion 6 of document 00 (`00 AC-6`) checks it on an installation that holds Lot 1 only. The manual trigger of Lot 1 requests (BKT-01) comes from H-12, not from a decision of the owner.

## Decision

Both lots are built in one run, in dependency-ordered waves: the foundation first, then Lot 1 up to a tagged milestone verified end to end (VUE-06), then Lot 2. Lot 2 pieces that need nothing from Lot 1 may start early.

## Consequences

- H-12 is confirmed as the delivery split, and the manual trigger of Lot 1 requests with it. Lot labels on requirements stay as written.
- The Lot 1 milestone is a tag on `main`. Before it is set, the end-to-end suite runs the journey of `00 AC-6` (add a player, validate a type, request a backtest, paste a valid research result, obtain a computed profile) on a build with no Lot 2 configuration: no feed, no language model, no Telegram.
- Lot 1 code never depends on Lot 2 modules; architecture-boundary lint rules enforce the direction ([0004](0004-quality-bar.md), [0007](0007-next-native-module-layout.md)).
- Lot 2 pieces that need nothing from Lot 1, such as a feed reader or the Telegram client, may be merged before the milestone, but the milestone journey never requires them.
- "Verified end to end" means verified by the automated suite; nothing is deployed for the owner at the milestone ([0008](0008-autonomous-build-and-end-of-build-handover.md)).

## Alternatives considered

- Delivering Lot 1, then stopping for the owner to use it before starting Lot 2. Not retained: the owner tries nothing until everything exists ([0008](0008-autonomous-build-and-end-of-build-handover.md)).
