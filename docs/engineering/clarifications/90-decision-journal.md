# Clarifications — 90 Journal des décisions

Rulings on the unclear points of the French spec [`docs/90-journal-des-decisions.md`](../../90-journal-des-decisions.md), numbered `CL-JRN-nn`.
The decision records (`docs/adr/`, with the register `docs/engineering/spec-deviations.md`) and these rulings override the spec text where they say so; the French spec is authoritative everywhere else.

### CL-JRN-01 — Precedence between the journal, the decision records and these rulings

- **Affects:** 90 preamble ("il fait foi"), README, every spec file
- **Problem:** the journal says it prevails over the specs and must be corrected when contradicted, but the owner's later decisions and the French specs are frozen.
- **Ruling:** the order is: the owner's decisions as recorded in the decision records and the deviations register; then the journal; then the spec files. Between spec files, the file that owns a notion wins over one that uses it, a requirement over an example, a specific rule over a general one. These clarification files settle unclear points inside that order and never override a decision record. The French journal and specs are never edited: an entry a record replaces (for example H-11) stays as written, and the register says what applies instead.
- **Why:** the register's closing section sets this precedence; one order avoids different readings by different agents.
- **Owner review:** no

### CL-JRN-02 — Hypotheses "to confirm" are implemented as written

- **Affects:** H-01 to H-13, every local H-xxx, Q-05, Q-06, Q-07
- **Problem:** every hypothesis is "to confirm", and the journal requires them to be presented as such; nothing says whether a builder may implement them.
- **Ruling:** as decided (record 0009): every hypothesis, journal-wide or local, is implemented exactly as written unless the register overrides it; "to confirm" is never a reason to stop, ask or leave a gap. Q-05 (betting), Q-06 (team events) and Q-07 (other sports) stay outside the first version.
- **Why:** the owner settled every open point before the build and chose no checkpoints (record 0008).
- **Owner review:** no

### CL-JRN-03 — H-11 replaced by the English product

- **Affects:** H-11, and through it TRV-24, IHM-12, TEL-04, DSN-23, DET-21
- **Problem:** H-11 makes the interface French and is propagated as firm requirements.
- **Ruling:** as decided (record 0010): the whole product is in English — screens, Telegram messages, descriptions, prompts and their JSON keys, the journal, the documentation — while collection and classification still handle English- and French-language press.
- **Why:** an owner decision overrides the hypothesis and everything derived from it.
- **Owner review:** no

### CL-JRN-04 — D-20 minimal storage versus the event record

- **Affects:** D-20, D-27, H-09, DSN-06
- **Problem:** D-20 names only type, date and source link, while the specs store a description, context indicators, a confidence and more.
- **Ruling:** as written: DSN-06 is the exhaustive list of what an event holds, each item justified there against D-20 (the description by H-DSN-09, the context by D-19 and H-09); nothing outside that list is stored. Calendar-derived events hold the reduced list of CL-DSN-20.
- **Why:** 00 delegates the list to 13, whose hypotheses bind (CL-JRN-02); D-20 sets the principle, DSN-06 its exact content.
- **Owner review:** no

### CL-JRN-05 — Manual requests in Lot 1 versus D-09, D-24 and D-36

- **Affects:** D-09, D-24, D-36, H-12
- **Problem:** the decisions tie backtest requests to detections; Lot 1 has no detection and creates requests by hand.
- **Ruling:** as decided (record 0001, register row H-12): requests are triggered by hand from Lot 1, and the manual action stays after Lot 2 (CL-VUE-05). D-36 still holds: no request is ever created for the whole list.
- **Why:** the owner confirmed the lot split with its manual trigger.
- **Owner review:** no

### CL-JRN-06 — Symmetric measurement

- **Affects:** D-01, D-08, H-04
- **Problem:** D-01 and D-08 speak of a better performance only; measuring decreases rests on H-04 alone.
- **Ruling:** as written: the measure is symmetric (H-04 binds, CL-JRN-02); a negative sensitivity is computed, shown and given a verdict exactly like a positive one.
- **Why:** D-01 refuses to take the direction for granted; H-04 is consistent with it.
- **Owner review:** no

### CL-JRN-07 — Team examples in D-32

- **Affects:** D-32, D-34, Q-06, VUE-04
- **Problem:** two of the three motivating examples are team situations, while every event concerns exactly one player.
- **Ruling:** as written: team events stay out (Q-06, VUE-04); the examples are motivation, not types. D-34 already recasts the series example as the player-centred type "negative record to avoid", whose criteria require the player to be named.
- **Why:** examples never override a requirement.
- **Owner review:** no

### CL-JRN-08 — Content of Lot 2

- **Affects:** H-12, 00 « Lot 2 »
- **Problem:** H-12's list of Lot 2 omits detection-born backtest requests and detection-born type proposals, which 00 includes.
- **Ruling:** each requirement's own lot tag is authoritative. Lot 2 is H-12's list plus detection-born requests (BKT-04) and type proposals coming from detection (TAX-18), as 00 lists them.
- **Why:** both items depend on detection, which only Lot 2 brings; the tags already say so.
- **Owner review:** no

### CL-JRN-09 — Standing of the "game against a former team" candidate

- **Affects:** 90 « Types d'événements candidats » (last item), TAX-15, annex « Match contre l'ancienne équipe »
- **Problem:** the type was proposed during scoping and "not explicitly taken up by the user".
- **Ruling:** as decided (record 0015): the type is seeded like the eight other candidates, proposed, origin scoping, with the calendar-derived draft; like every type it is used only once the owner validates it (D-12). The draft's « Statut particulier » line is not seeded as a field (CL-TAX-15).
- **Why:** the owner decided how the type works if validated, not that it is validated.
- **Owner review:** no

### CL-JRN-10 — The ID « D-07 bis »

- **Affects:** D-07 bis, traceability tooling
- **Problem:** one decision ID has a non-numeric suffix.
- **Ruling:** IDs are cited exactly as the specs write them, « D-07 bis » with its space. Traceability tooling accepts requirement, decision, hypothesis and question IDs of the form `^[A-Z]+(-[A-Z]+)*-\d{2}( bis)?$` and criterion IDs of the form `^CA-[A-Z]+-\d{2}$`.
- **Why:** one pattern lets tooling parse every ID the specs use.
- **Owner review:** no

### CL-JRN-11 — "Profiled", "already processed" and "no backtest yet"

- **Affects:** D-24, D-29, H-05
- **Problem:** the journal uses these words without defining the threshold between them.
- **Ruling:** as written in 00 and 05: a player is profiled, or already processed, once one research result has been imported for him, even an empty one; before that he has no backtest (H-VUE-02, BKT-10). Calendar-derived profiles do not count (CL-VUE-06).
- **Why:** H-VUE-02 binds (CL-JRN-02) and 05 owns coverage.
- **Owner review:** no

## Ruled elsewhere

- **Per-minute index at very low or zero minutes** (H-13) — owned by 07: STA-13 (no minutes, not played, no index) and STA-14 (playing-time threshold) settle it, with SEN-12 for the measured game; no change needed.
- **Opponent level computed from statistics** (H-09) — owned by 07: STA-06 computes each team's record from the results the source must provide (TRV-15); no extra data source; no change needed.

## Passed to the glossary

- English labels of the three entry kinds: decision, drafting hypothesis, open question.
- English names of the nine candidate types (with the identifiers of CL-TAX-02).
