# 0017. Temporary keyed fingerprint of a withdrawn event

- Status: Accepted
- Date: 2026-11-11

## Context

- DSN-26 to DSN-29 ([13](../13-donnees-sensibles.md)): withdrawing an event for a sensitivity reason erases it and all its traces (DSN-27). The only trace left is a global counter, with no player, type or date (DSN-29, H-DSN-07); afterwards no screen mentions the event (IHM-68).
- DSN-34 and COL-37 erase the articles of a withdrawn event at once, without a deduplication trace, because their link would designate it; an article still in a feed can then be collected again and bring the event back (H-DSN-10).
- DSN-28 lists the limits shown before confirming a withdrawal, among them that re-collection can bring the event back and that a later backtest can report it again. IMP-37 lets the owner decline such an event in the import preview for « donnée sensible », which increases the counter.
- TRV-50: backups keep a withdrawn event until the last backup that holds it is replaced, at most as many weeks as backups kept, eight by default.
- Q-DSN-01: should a minimal fingerprint (player, type, date) be kept so that a later backtest or a restored backup cannot reintroduce a withdrawn event? Such a fingerprint is itself a trace, against the spirit of withdrawal. Without an answer, none is kept.

## Decision

A withdrawal leaves a temporary keyed fingerprint: a keyed hash of player, type and date, unreadable without the server secret. It is kept eight weeks, the horizon during which backups still hold the event (TRV-50), then erased. It stops detection from recreating the event; a later import shows it in the preview, where the owner declines it. This is an agreed, time-limited exception to DSN-29.

## Consequences

- The fingerprint is a keyed hash, for example HMAC-SHA-256, of the player identifier, the type identifier and the reference day, computed with a dedicated secret from the deployment configuration (TRV-37, TRV-64). Only the hash and its creation date are stored; the fingerprint is never displayed, logged (TRV-41), exported (TRV-52) or sent anywhere.
- The daily purge (TRV-25) erases each fingerprint eight weeks after its creation.
- Before creating an event, detection checks the fingerprints (next to DET-58): a match creates no event, so no case, no alert sheet and no backtest request.
- An import flags, in the preview, a result event that matches a fingerprint; the owner declines it with the reason « donnée sensible », which increases the counter as IMP-37 already does. Nothing is declined automatically. This flag is the only place where the application refers to a withdrawn event again (exception to IHM-68).
- The withdrawal screen states the new limits (DSN-28): during the eight weeks, re-collection does not bring the event back and a later import flags it; afterwards the limits of the spec apply again; restoring a backup can still bring the event back, as before.
- Within DSN-26 to DSN-35, only DSN-27, DSN-28, DSN-29 and DSN-34 change. DSN-26, DSN-30, DSN-31, DSN-32, DSN-33 and DSN-35 are untouched.

## Open points

Not settled by the decision; the recommended handling is in brackets.

1. Date matching: an exact date misses an event reported again one day apart. [Day precision; check every day of the IMP-25 window, two days by default.]
2. Player key and player deletion. [Use the application's player identifier (JOU-08), never reassigned; deleting a player's data (JOU-24) creates no fingerprint, since nothing could ever match it.]
3. Backups: including the fingerprints keeps them in backups up to eight weeks after their erasure; leaving them out weakens a restore, which should rebuild the application identically (TRV-51). [Leave them out, so that no trace outlives the horizon.]
4. A collected article that matches a fingerprint: DSN-34 forbids a deduplication trace, so the article will be collected and classified again for as long as it stays in a feed. [Erase it at once, as DSN-34 does, and accept the classification cost.]
5. Backup retention changed by the owner (TRV-50): the eight weeks then no longer match the backup horizon. [The horizon follows the retention.]
6. Calendar-derived events ([0015](0015-calendar-derived-event-types.md)) are recreated by the derivation once the fingerprint expires. Needs a decision.

## Alternatives considered

From Q-DSN-01:

- No fingerprint, the default of the spec. Not retained.
- A permanent minimal fingerprint in clear (player, type, date). Not retained.
