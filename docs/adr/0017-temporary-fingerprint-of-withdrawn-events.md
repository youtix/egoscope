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
- The daily purge (TRV-25) erases each fingerprint once its horizon has passed (see Amendments for the exact rule).
- Before creating an event, detection checks the fingerprints (next to DET-58): a match creates no event, so no case, no alert sheet and no backtest request.
- An import flags, in the preview, a result event that matches a fingerprint; the owner declines it with the reason « donnée sensible », which increases the counter as IMP-37 already does. Nothing is declined automatically. This flag is one of the two places where the application refers to a withdrawn event again (exception to IHM-68); the other is the restore summary (see Amendments).
- The withdrawal screen states the new limits (DSN-28): during the horizon, re-collection does not bring the event back and a later import flags it; afterwards the limits of the spec apply again; a restore made within the horizon withdraws the event again, except a restore into a new database without the old one (see Amendments).
- Within DSN-26 to DSN-35, only DSN-27, DSN-28, DSN-29 and DSN-34 change. DSN-26, DSN-30, DSN-31, DSN-32, DSN-33 and DSN-35 are untouched.

## Open points

Not settled by the decision; the recommended handling is in brackets. All six were settled on 2026-11-11; the Amendments say how.

1. Date matching: an exact date misses an event reported again one day apart. [Day precision; check every day of the IMP-25 window, two days by default.] **Settled as recommended** (CL-DSN-06, CL-DET-21, CL-IMP-28, CL-IMP-34).
2. Player key and player deletion. [Use the application's player identifier (JOU-08), never reassigned; deleting a player's data (JOU-24) creates no fingerprint, since nothing could ever match it.] **Settled as recommended, plus a deleted-player entry** (CL-JOU-24).
3. Backups: including the fingerprints keeps them in backups up to eight weeks after their erasure; leaving them out weakens a restore, which should rebuild the application identically (TRV-51). [Leave them out, so that no trace outlives the horizon.] **Settled as recommended** (CL-DSN-08, CL-TRV-05), a restore re-applying the ledger (CL-TRV-06).
4. A collected article that matches a fingerprint: DSN-34 forbids a deduplication trace, so the article will be collected and classified again for as long as it stays in a feed. [Erase it at once, as DSN-34 does, and accept the classification cost.] **Settled as recommended** (CL-COL-16, CL-DSN-10).
5. Backup retention changed by the owner (TRV-50): the eight weeks then no longer match the backup horizon. [The horizon follows the retention.] **Settled beyond the recommendation** (CL-DSN-07).
6. Calendar-derived events ([0015](0015-calendar-derived-event-types.md)) are recreated by the derivation once the fingerprint expires. Needs a decision. **Settled** (CL-DSN-09, CL-DSN-19).

## Alternatives considered

From Q-DSN-01:

- No fingerprint, the default of the spec. Not retained.
- A permanent minimal fingerprint in clear (player, type, date). Not retained.

## Amendments

### 2026-11-11 — The horizon: open point 5 (CL-DSN-07)

- The decision's eight weeks become the backup horizon: the number of backups kept (TRV-50) times the backup interval (7 days for a weekly backup, 1 for a daily one), eight weeks by default. The daily purge erases a fingerprint only when it is older than the horizon and no backup listed in the application's backup register was made before it; while the register is in doubt, after a failed rotation, nothing is erased. A raised retention lengthens the life of existing fingerprints; a lowered one shortens it only once the extra backups are really deleted.
- This settles open point 5 beyond the recommendation: a fingerprint can outlive eight weeks when the retention is raised or backups fail to rotate.

### 2026-11-11 — Content, key and checks: open point 1 (CL-DSN-06, CL-DET-21, CL-IMP-28, CL-IMP-34)

- A fingerprint is the HMAC-SHA-256, with the fingerprint secret of the deployment configuration, of `<player id>|<type id>|<YYYY-MM-DD>`, stored with its creation instant only. The day is the event's reference date as written when it has no time, otherwise the calendar date of its reference instant in the owner's time zone.
- Every withdrawal creates one, whatever the event's origin, and nothing else does: no deletion, replacement, requalification, drop by the calendar derivation, preview decline or player-data deletion.
- Fingerprints are checked by detection, by the calendar derivation, in every import preview and at every restore. Open point 1 is settled as recommended: at import and detection an event matches over its day ± 2 days, the IMP-25 window, which is the single parameter of every duplicate and fingerprint check (CL-IMP-34); the derivation checks the derived game's exact day only. Detection checks only a model-origin fact that would create a new event, before the search of DET-58; events the owner creates are not checked.
- Recording an event the preview flagged erases the fingerprints it matches. A new fingerprint secret makes the existing fingerprints unmatchable, which the deployment guide states.

### 2026-11-11 — Player key and player deletion: open point 2 (CL-JOU-24)

- Settled as recommended: the player key is the application's player identifier. In addition, a player-data deletion creates one deleted-player entry — a keyed hash of his identifier with its creation instant, same secret and same lifetime as fingerprints — used only to delete him again after a restore.

### 2026-11-11 — The withdrawal ledger and backups: open point 3 (CL-DSN-08, CL-TRV-05)

- Settled as recommended: fingerprints and deleted-player entries form the withdrawal ledger, which no backup and no export contains. The withdrawn-events counter belongs to the ledger; its value is also written into each backup and full export.

### 2026-11-11 — Restores (CL-TRV-06, CL-DSN-08, CL-DSN-19)

- A restore never overwrites the ledger and re-applies it to the restored data, without creating a fingerprint: a restored player who matches a deleted-player entry is deleted again; for each live fingerprint, the single restored event of that player and type on its day is withdrawn again; when several fall on that day, or none does but some fall within the window, none is withdrawn and the restore summary lists them for the owner to check — a second place, besides the import preview, that points at a withdrawn event.
- The counter keeps the larger of the ledger's value and the backup's, and a re-application never makes it grow. A restore into a new database without access to the old one cannot re-apply recent withdrawals; its summary says so.
- This replaces the decision's working assumption that a restore can still bring a withdrawn event back.

### 2026-11-11 — A collected article that matches: open point 4 (CL-COL-16, CL-DSN-10)

- Settled as recommended: the matching classification result is erased at once, and so is the article unless another role keeps it, with no deduplication trace. While a feed still offers it within the maximum article age, it is collected and classified again at each run — about six times with the two default runs a day — and that cost is accepted.

### 2026-11-11 — The import flag and the counter (CL-IMP-28, CL-DSN-04)

- The flag reads "matches an event you withdrew", with the choice "don't record — sensitive data"; nothing is preselected. The save confirmation says how many flagged events will be recorded.
- The counter counts removal decisions: every decline for sensitive data counts, flagged or not, and a restore's re-application does not. One fact can therefore count more than once, which the « Méthode et limites » page and the validation table state.

### 2026-11-11 — Calendar-derived events: open point 6 (CL-DSN-09, CL-DSN-19)

- Settled as [0015](0015-calendar-derived-event-types.md) records: such events can be withdrawn like any other; only a full derivation run after the horizon can bring one back; the withdrawal screen says so and names the permanent alternative, excluding the case by hand (SEN-17).

### 2026-11-11 — The limits shown before a withdrawal (CL-DSN-19)

- The confirmation recalls that a withdrawal answers a sensitivity reason and never depends on the game that followed, then lists: in Lot 2, the number of messages already sent that mention the event, which Telegram may refuse to delete; backups keep the event until they rotate out, at most the horizon, and a restore made within it withdraws the event again, except into a new database without the old one; exports already downloaded keep it; a device left offline shows it until its next refresh; during the horizon detection does not recreate it and a later import flags it, afterwards re-collection or a later backtest can bring it back; for a calendar-derived event, a later full derivation can bring it back after the horizon.
