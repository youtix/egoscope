# Clarifications — 13 Données sensibles

Rulings on the unclear points of the French spec [`docs/13-donnees-sensibles.md`](../../13-donnees-sensibles.md), numbered `CL-DSN-nn`.
The decision records (`docs/adr/`, with the register `docs/engineering/spec-deviations.md`) and these rulings override the spec text where they say so; the French spec is authoritative everywhere else.

### CL-DSN-01 — Acceptance-criterion IDs

- **Affects:** the nineteen acceptance criteria of 13
- **Problem:** the criteria are numbered without IDs.
- **Ruling:** as ruled in planning: `CA-DSN-01` to `CA-DSN-19` in document order; each keeps the requirement IDs written in its parentheses.
- **Why:** one citation scheme for every file without IDs.
- **Owner review:** no

### CL-DSN-02 — Descriptions in English

- **Affects:** DSN-19, DSN-23, H-DSN-08; record 0010
- **Problem:** descriptions must be written in French even for English sources.
- **Ruling:** as decided: every description is written in English, even when its source is French (DSN-23); the compliant example of DSN-19 is used in its English form from the glossary. Titles stay as published (DSN-08).
- **Why:** record 0010.
- **Owner review:** no

### CL-DSN-03 — The quotation-mark check

- **Affects:** DSN-21, DSN-24, DSN-25, CA-DSN-08, IMP-13
- **Problem:** the automatic check for quotation marks does not say which characters count, and in English the apostrophe doubles as a single quote ("player's").
- **Ruling:** a text fails the check when it contains any of `"` (U+0022), `«` (U+00AB), `»` (U+00BB), `“` (U+201C), `”` (U+201D), `„` (U+201E) or `‟` (U+201F). Apostrophes never fail it, straight or typographic (`'` U+0027, `’` U+2019), since English and French text needs them ("player's", "l'équipe"). The check applies to every description, whoever writes it (import, classification, the owner's corrections, the application's templates), and to classification justifications (DSN-25); never to titles (DSN-08) nor to sheet texts (CL-TAX-04). The message names the character found. A quotation in single quotes is left to the reading rules that the preview recalls (DSN-24).
- **Why:** one set for every check that DSN-24 and DSN-25 require, the one the rulings on 04 recommend; a single quote cannot be told from an apostrophe automatically.
- **Owner review:** no

### CL-DSN-04 — What the withdrawn-events counter counts

- **Affects:** DSN-29, IMP-37, JOU-24, VUE-09, CA-DSN-12, CA-DSN-16; record 0017
- **Problem:** the counter grows at each withdrawal and at each preview decline for "sensitive data", so one fact withdrawn and later declined counts twice.
- **Ruling:** the counter counts removal decisions, not distinct facts, and never decreases. It grows by one at each withdrawal of an event (DSN-26); by one at each event the owner declines for "sensitive data" in an import preview, whether or not it was flagged as matching a fingerprint (record 0017); and by the number of the player's events at a player-data deletion (JOU-24). It does not grow when a restore re-applies a withdrawal (CL-TRV-06). The « Méthode et limites » page and the validation table state, next to the number, that it counts the events withdrawn or declined for sensitivity, deleted players' events included, so that one fact can count more than once.
- **Why:** the application cannot always know that two decisions concern the same fact; over-counting is the safe side for a counter meant to reveal removals.
- **Owner review:** yes — the number shown is an upper bound on removed facts, not an exact count of them.

### CL-DSN-05 — Links to an item that no longer exists

- **Affects:** DSN-29, IHM-68, 12 « Cas limites » (lien vers un objet disparu), DET-51, BKT-14, IHM-27
- **Problem:** a link to a withdrawn event should "explain what became of it", while nothing may designate the event afterwards.
- **Ruling:** a link to an event, case, alert sheet, request, import or player that no longer exists opens one generic page, "This item no longer exists", with a link to the home screen, identical (same text, same HTTP status 404) whatever the cause — withdrawal, deletion, replacement, requalification, dropped derivation (CL-IHM-19). No tombstone is kept, and the fingerprints are never consulted for this. Types are never erased: a withdrawn, merged or split type keeps its page, which states its state and, for a merge or split, the type or types it went to. The backtest request a withdrawn detected event triggered keeps its trigger kind ("detection") and no link to the event (BKT-14).
- **Why:** a generic message explains without designating, which satisfies both IHM-68 and DSN-29.
- **Owner review:** no

### CL-DSN-06 — Fingerprint of a withdrawn event: content, key and matching window

- **Affects:** DSN-27, DSN-29, H-DSN-07, IMP-25, IMP-37, DET-58; record 0017; register open point "Date tolerance when matching a fingerprint"
- **Problem:** the decision fixes a keyed hash of player, type and date; exact-date matching misses the same fact reported a day apart, and the cases that create or erase a fingerprint are not all listed.
- **Ruling:**
  - Each withdrawal of an event (DSN-26), of any origin, and nothing else, creates one fingerprint: HMAC-SHA-256, with the fingerprint secret of the deployment configuration, of the text `<player id>|<type id>|<YYYY-MM-DD>`, stored with its creation instant only. The player key is the application's player identifier (JOU-08, CL-JOU-24), never a name or a variant.
  - The day is the event's reference date: the date as written when it has no time; otherwise the calendar date of the reference instant in the owner's time zone (TRV-72). The same function gives the day of every event compared with a fingerprint; a change of the owner's time zone can shift a day by one, which the window absorbs.
  - An event of player p, type t and day d matches when the hash of `p|t|d'` equals a live fingerprint for some day d' from d − g to d + g, g being the maximum gap between public dates of IMP-25 (2 days by default), the single parameter that the duplicate checks also use (CL-DET-21, CL-IMP-34). The calendar derivation compares the derived game's day only: such an event's day is exact, and a window could keep another qualifying game of the same player and type within g days from being derived (record 0015: every such game counts).
  - Fingerprints are checked by detection for a model-origin fact that would create a new event, before the search of DET-58, never for the owner's own classifications (CL-DET-21; a match creates nothing, and its article follows CL-DSN-10); by the calendar derivation before it creates an event (CL-SUI-14, CL-TAX-19); in every import preview (the flag of record 0017); and at every restore (CL-TRV-06).
  - No fingerprint is created by a deletion (IMP-33), a replacement (IMP-29), a requalification or split erasure (CL-TAX-09), a calendar-derived event dropped by the derivation (CL-TAX-19), a preview decline (IMP-37) or a player-data deletion (CL-JOU-24).
  - When the owner records an event that the preview flagged, the fingerprints it matches are erased: he has taken that fact back.
  - A changed fingerprint secret makes existing fingerprints unmatchable; the deployment guide says so.
- **Why:** day precision with the duplicate window of IMP-25 catches the same fact reported a day or two apart (recommended handling of record 0017); erasing on deliberate recording keeps a restore from undoing the owner's later choice.
- **Owner review:** no

### CL-DSN-07 — Fingerprint lifetime follows the backup retention

- **Affects:** DSN-29, TRV-50, H-TRV-09; record 0017; register open point "Fingerprint horizon when the owner changes the backup retention"
- **Problem:** the decision keeps fingerprints eight weeks because backups hold the event that long; a changed retention or a failed rotation breaks that equality.
- **Ruling:** the horizon is the number of backups kept (TRV-50) times the backup interval (7 days for a weekly backup, 1 for a daily one): eight weeks by default. The daily purge erases a fingerprint, or a deleted-player entry (CL-JOU-24), when both hold: it is older than the horizon, and no backup listed in the application's backup register was made before it. While the register is in doubt (the last rotation failed), nothing is erased. A raised retention lengthens the life of existing fingerprints at the next purge; a lowered one shortens it only once the extra backups have really been deleted (CL-TRV-04).
- **Why:** an event must never sit in a stored backup without its fingerprint (recommended handling of record 0017), and the default stays the decided eight weeks.
- **Owner review:** yes — fingerprints can outlive eight weeks when the retention is raised or backups fail to rotate.

### CL-DSN-08 — Fingerprints stay out of backups and exports

- **Affects:** DSN-27 to DSN-29, TRV-51, TRV-52, TRV-53; record 0017, record 0018; register open point "Whether backups hold the fingerprints"
- **Problem:** inside backups, fingerprints would outlive their horizon and a restore would bring back old ones; outside them, a restore loses the protection.
- **Ruling:** fingerprints and deleted-player entries (CL-JOU-24) form the withdrawal ledger. No backup file and no export contains the ledger's entries; the withdrawn-events counter belongs to the ledger, and its value is also written into each backup and full export. A restore never overwrites the ledger and re-applies it to the restored data (CL-TRV-06).
- **Why:** no trace outlives its horizon (recommended handling of record 0017), and every withdrawal still holds after a restore (CL-TRV-06).
- **Owner review:** yes — a restore into a new database, without access to the old one, cannot re-apply recent withdrawals (CL-TRV-06).

### CL-DSN-09 — Withdrawing a calendar-derived event

- **Affects:** DSN-26, DSN-28, DSN-29, IHM-68, SEN-17; records 0015 and 0017; register open point "Withdrawing a calendar-derived event"
- **Problem:** the derivation could recreate a withdrawn calendar-derived event once its fingerprint has expired.
- **Ruling:**
  - As written in DSN-26, any event can be withdrawn, calendar-derived ones included, with the scope of DSN-27 and a fingerprint (CL-DSN-06). Their sheet offers withdrawing and correcting the context indications, and no dismissal and no deletion, since they are not detected events and their type, player and date are derived (CL-IHM-21, CL-SUI-14). Their case can also be excluded by hand like any case (SEN-17): that exclusion is permanent and stays visible on the case.
  - The regular derivation never revisits a game it has already derived, and every derivation checks the fingerprints first (CL-TAX-19, CL-SUI-14). A withdrawn calendar-derived event can therefore come back only through a full derivation — validation, reactivation or substantive change of its type; a change of the player's day and month of birth or of his statistics mapping; a box-score correction that changes his team history — run after its fingerprint has expired. No other memory of the withdrawal is kept.
  - The withdrawal screen of such an event states that limit and that excluding its case is the permanent alternative (CL-DSN-19).
  - Removing a player's day and month of birth drops all his birthday events (CL-JOU-16); deleting a player's data erases his events like the others (JOU-24); neither is a withdrawal of these events one by one.
- **Why:** DSN-26 allows any event to be withdrawn; this agrees with the rulings on 10 and 12 (CL-SUI-14, CL-IHM-21) and leaves one narrow, stated way back.
- **Owner review:** yes — a withdrawn birthday or reunion event can come back after the fingerprint horizon if the owner later triggers a full derivation; excluding its case is the permanent way to keep it out of the calculations.

### CL-DSN-10 — A collected article that matches a withdrawal

- **Affects:** DSN-34, H-DSN-10, COL-24, COL-28, COL-34, COL-37; record 0017; register open point "A collected article that matches a fingerprint"
- **Problem:** DSN-34 forbids a deduplication trace, so an erased article still in a feed is collected and classified again at every run.
- **Ruling:** as ruled for collection (CL-COL-16): an article erased because of a withdrawal (DSN-34), or because the fact found in it matches a live fingerprint (then erased at once, unless another role keeps it), leaves no deduplication trace and no other record. While a feed still offers it within the maximum article age (COL-24, 3 days by default), it is collected and classified again at each run — at most about six times with the two default runs a day — and each time the fingerprint keeps it from becoming an event. The repeated work is bounded, not avoided, and its quota cost is accepted.
- **Why:** avoiding it would need a second trace of the withdrawn event's article, while the fingerprint must stay the only exception to DSN-29; the cost is a handful of classifications per withdrawal (recommended handling of record 0017).
- **Owner review:** no

### CL-DSN-11 — Raw service responses in the journal

- **Affects:** DSN-11, TRV-44, CA-DSN-13, CA-TRV-39
- **Problem:** raw responses of the classifier and of feeds naturally contain descriptions and titles, which the journal must never hold.
- **Ruling:** the technical details of a journal entry hold only: the service, the operation, the instant, the duration, the HTTP status or error code, the code and message of an error object returned by the service (at most 300 characters, and never taken from a successful response), request identifiers, sizes and counts (bytes, items, tokens), and, for a structured response, the validation outcome (which field failed, at which position). They never hold a request or response body, a feed item, an article title, link or excerpt, a model output, a prompt, or any item of DSN-18. A test loads fixtures with known titles and descriptions and asserts that no journal entry or technical detail contains them.
- **Why:** an allowlist is the only form of DSN-11 that can be tested.
- **Owner review:** no

### CL-DSN-12 — Excerpts of articles behind a type proposal

- **Affects:** DSN-09
- **Problem:** the excerpt is kept "until the decision on the proposal", with no time limit.
- **Ruling:** as written: the excerpt of an article linked to a proposal is kept until the proposal is validated or rejected (DSN-09), so that its articles can be reclassified; the to-do list keeps showing every proposal awaiting a decision (IHM-20).
- **Why:** the text settles it, and the owner sees the pending proposals.
- **Owner review:** no

### CL-DSN-13 — Telegram messages that cannot be deleted

- **Affects:** DSN-27, DSN-28, TEL-38
- **Problem:** the deletion of messages about a withdrawn event will often fail.
- **Ruling:** as ruled for Telegram (CL-TEL-09): each sent message keeps its chat identifier and Telegram's message identifier, both erased with its text; before confirmation the withdrawal screen states how many sent messages mention the event (CL-DSN-19); the application then asks Telegram once to delete each of them, digests included, and the screen shown right after the withdrawal lists, once, the send date and time of every message Telegram refused or that could not be reached, and whether it was a digest, so the owner can delete it himself; nothing about them is kept afterwards. Telegram's bot interface currently lets a bot delete a message only within 48 hours of sending it (to re-check on the day, TRV-10), so older messages usually stay.
- **Why:** pointing the messages out (TEL-38) must not become a lasting trace.
- **Owner review:** no

### CL-DSN-14 — Exporting the journal for a helper

- **Affects:** DSN-30, TRV-49
- **Problem:** DSN-30 forbids exports for a third party but allows one.
- **Ruling:** as written: the activity-journal export of TRV-49 is the only export meant to be shown to someone else, and it is acceptable because the journal holds no sensitive datum (DSN-11, CL-DSN-11).
- **Why:** the text states the exception and its condition.
- **Owner review:** no

### CL-DSN-15 — Earlier texts in the correction history

- **Affects:** DSN-06, DSN-10
- **Problem:** the correction trace could keep earlier, non-compliant versions of a free text.
- **Ruling:** as written: corrections are traced with their date and the fields changed, without the old value (IMP-32 for historical events; DET-52 for detected ones), so no earlier free text is ever kept.
- **Why:** 06 and 04 already exclude old values.
- **Owner review:** no

### CL-DSN-16 — Withdrawal across the two lots

- **Affects:** DSN-26, DSN-27, DSN-34, CA-DSN-10, CA-DSN-18
- **Problem:** withdrawal is Lot 1, but its effects on articles, alert sheets, tracked cases and Telegram are Lot 2.
- **Ruling:** Lot 1 builds the withdrawal as one operation that runs, in a single transaction, an erasure step for every kind of data that can hold the event; each Lot 2 module adds its own step (articles, classification results, alert sheets and alert history, tracked cases, Telegram texts) and a test proving it. A withdrawal never completes with part of the event left.
- **Why:** the cascade must be complete in each lot without rewriting Lot 1.
- **Owner review:** no

### CL-DSN-17 — Where drafts live

- **Affects:** DSN-32, IHM-42, H-IHM-08, IMP-03, TAX-17, TRV-51
- **Problem:** the pasted text must be kept by the application for use on another device, yet stay out of saved data, import traces, the journal and backups.
- **Ruling:** drafts live in a dedicated draft store of the database: at most one import draft per backtest request and one exploration draft per exploration screen (general) or targeted proposal, each holding the text, its last change instant and the device it came from, nothing else. The store is excluded from backups and exports by name; no journal entry or technical detail contains a draft's text. A draft is erased when its import or its proposals are saved, when abandoned, at the end of the draft lifetime (IHM-42, counted from its last change), when its request or proposal or player disappears, and at every restore. Logging out erases the device copy (DSN-33) but not the server copy.
- **Why:** one store with explicit exclusions is the only way to meet DSN-32 and IHM-42 together.
- **Owner review:** no

### CL-DSN-18 — Device copies are replaced at each refresh

- **Affects:** DSN-33, DSN-28, IHM-57
- **Problem:** a withdrawn event must disappear from a device "at its next refresh", which a merging cache would not do.
- **Ruling:** each refresh of a screen replaces its stored copy with the fresh data, never merging; an item absent from the fresh data disappears from the copy. A refresh that fails keeps the previous copy with its load date.
- **Why:** replacement is the only behavior under which withdrawals reach the device.
- **Owner review:** no

### CL-DSN-19 — Limits shown before a withdrawal

- **Affects:** DSN-28, CA-DSN-11, IHM-68; record 0017
- **Problem:** the fingerprint and the restore rules change the limits the confirmation must state.
- **Ruling:** before confirming, the screen recalls that a withdrawal answers a sensitivity reason and never depends on the game that followed, then lists these limits:
  - in Lot 2, the number of messages already sent that mention the event, as a number only, and the fact that Telegram may refuse to delete the older ones, which then stay in the conversation for the owner to delete (CL-TEL-09);
  - backups keep the event until they rotate out, at most the fingerprint horizon (CL-DSN-07); a restore made within it withdraws the event again, except a restore into a new database without the old one (CL-TRV-06);
  - exports already downloaded keep it; deleting them is the owner's task;
  - a device left offline shows it until its next refresh;
  - during the horizon, detection does not recreate it and a later import flags it; afterwards, re-collection (Lot 2) or a later backtest can bring it back, to be declined or withdrawn again;
  - for a calendar-derived event, that a later full derivation can bring it back once the horizon has passed, and that excluding its case (SEN-17) is the permanent alternative (CL-DSN-09).

  CA-DSN-11 checks this list.
- **Why:** the owner must know exactly how far a withdrawal reaches.
- **Owner review:** yes — the confirmation text changes.

### CL-DSN-20 — Data of a calendar-derived event

- **Affects:** DSN-01, DSN-06, DSN-10, DSN-17, DSN-19 to DSN-22; record 0015
- **Problem:** DSN-06 lists press sources and a confidence for every event; calendar-derived events have neither.
- **Ruling:** a calendar-derived event holds only: the player; the type with its sheet version; its reference date, the game's day; a reference to its game; a description written by the application from a fixed template, in English, within the description length, naming only the player and, for a former-team event, that team; context indicators, unknown until the owner sets them (H-09); the origin "calendar-derived"; and management data (creation and change instants, trace of context corrections). It holds no source, no confidence, no precedence and no dating mark; DSN-01 does not apply, since the schedule, not an article, is its evidence.
- **Why:** record 0015; nothing else is needed to measure or recognize the event.
- **Owner review:** no

### CL-DSN-21 — The day and month of birth

- **Affects:** DSN-14, DSN-18, JOU-11; record 0015
- **Problem:** the birthday is now the only personal datum stored about a player.
- **Ruling:** only the day and month are stored, never the year — not even in a log, a technical detail or a temporary table. The value is never sent to the research AI or the classifier. The journal records that the birthday was entered, changed or removed, without the value. It is part of backups and exports and is erased with the player's data.
- **Why:** the owner agreed to this one exception, as small as possible.
- **Owner review:** no

## Ruled elsewhere

- **Showing a fingerprint match in the import preview** — owned by 06 (IMP-37): ruled by CL-IMP-28 (the flag beside the event with the choice "don't record — sensitive data", nothing preselected (record 0017), the save confirmation saying how many flagged events will be recorded, and the matched fingerprints of an event recorded anyway erased, CL-DSN-06).
- **Already settled consistently by the rulings on Lot 2:** Telegram message identifiers and the deletion list (CL-TEL-09), the article that matches a fingerprint (CL-COL-16), the fingerprint check in detection (CL-DET-21), the calendar derivation's fingerprint check (CL-SUI-14), the sheet of a calendar-derived event (CL-IHM-21) and the generic page for vanished items (CL-IHM-19).

## Passed to the glossary

- The English form of the DSN-19 example and the description templates of calendar-derived events.
- The labels "sensitive event" (DSN-35) and "sensitive data" (the decline reason of IMP-37).
- The counter's label and its explanatory sentence (CL-DSN-04).
- The limit sentences of the withdrawal screen (CL-DSN-19), including the one for a calendar-derived event, and the page "This item no longer exists".
- The message of the quotation-mark check.
