# Clarifications — 00 Vue d'ensemble

Rulings on the unclear points of the French spec [`docs/00-vue-d-ensemble.md`](../../00-vue-d-ensemble.md), numbered `CL-VUE-nn`.
The decision records (`docs/adr/`, with the register `docs/engineering/spec-deviations.md`) and these rulings override the spec text where they say so; the French spec is authoritative everywhere else.

### CL-VUE-01 — Acceptance-criterion IDs

- **Affects:** the ten acceptance criteria of 00
- **Problem:** the criteria are a numbered list without IDs, while tests must cite each criterion.
- **Ruling:** as ruled in planning: the criteria are `CA-VUE-01` to `CA-VUE-10` in document order; `CA-VUE-nn` tests `VUE-nn` (the list follows the requirement order). Tests cite these IDs.
- **Why:** one citation scheme for every file without IDs.
- **Owner review:** no

### CL-VUE-02 — Glossary terms and common states in English

- **Affects:** VUE-08, CA-VUE-08
- **Problem:** VUE-08 requires the terms and states "as written in this document", that is in French, while the product is in English (record 0010).
- **Ruling:** every screen, Telegram message, journal entry and document uses, for each term of the 00 glossary (common and complementary terms) and each common state, the single English rendering given by `docs/engineering/glossary.md`, with no synonym and no other abbreviation. CA-VUE-08 asserts that each displayed state of a player, type, detected event, request or case is one of the glossary's English common-state labels.
- **Why:** record 0010 overrides the language of VUE-08 and keeps its purpose, one fixed term per notion.
- **Owner review:** no

### CL-VUE-03 — What a case is

- **Affects:** 00 glossary « Cas », 00 relations, SEN-05, SEN-06
- **Problem:** the glossary defines a case as "an event and its measured game", while the relations section groups several same-type events attached to the same game into one case.
- **Ruling:** the relation wins over the glossary sentence.
  - A case is identified by one player, one type and one measured game, and holds one or more events of that type attached to that game; an event belongs to at most one case. Events of different types attached to the same game give one case per type, marked concomitant (SEN-06).
  - An event attached to a game that already has a case of its type joins that case; no second case is created.
  - An event that leaves the case (dismissed, erased, or attached to another game after a correction) stops counting in it; the case keeps counting while at least one of its events is neither dismissed nor erased, and its reference instant is the earliest among those events (SEN-05). A case with no event left disappears.
  - A case's origin, historical or tracked, is set by the first of its events recorded and never changes afterwards (SUI-07); CL-VUE-13 gives the origin of calendar-derived cases.
- **Why:** the relations section and SEN-05 are the owning rules; counting one game once per type keeps profiles free of duplicates.
- **Owner review:** no

### CL-VUE-04 — Withdrawing a player or a type versus withdrawing an event

- **Affects:** 00 glossary « Retrait (d'un événement) », common states, JOU-15, TAX-10, DSN-26
- **Problem:** the same French word names a reversible state of a player or a type and the permanent erasure of an event; 00 does not say whether the state can be undone.
- **Ruling:** as written. A withdrawn player or type erases nothing and can be reactivated (JOU-15: withdrawn to active; TAX-10: withdrawn to validated). Withdrawing an event is a permanent erasure (DSN-26 to DSN-29). The interface never uses the event-erasure term for a player or type state, nor the reverse; the two English terms come from the glossary and must differ.
- **Why:** JOU-15 and TAX-10 settle reversibility; 00 itself warns against the confusion.
- **Owner review:** no

### CL-VUE-05 — Manual backtest requests in both lots

- **Affects:** VUE-06, 00 « Lots », H-12, D-36, JOU-07
- **Problem:** manual triggering of requests rests on H-12, while D-36 ties requests to detections.
- **Ruling:** as decided (record 0001, register row H-12): the "request a backtest" action of the player page exists from Lot 1 and stays after Lot 2, which adds detection-born requests (BKT-04) without removing the manual action. The application never creates a request for the whole list or for a player nobody asked about (D-36, JOU-07).
- **Why:** the owner confirmed the two lots with the manual Lot 1 trigger; JOU-07 says Lot 2 requests are born "also" from detection.
- **Owner review:** no

### CL-VUE-06 — A profiled player with no valid case, and calendar-derived profiles

- **Affects:** H-VUE-02, 00 complementary term « Joueur profilé », BKT-10, BKT-30, SEN-31
- **Problem:** one imported result, even empty, makes a player profiled, so a profiled player may have no profile values; calendar-derived types (record 0015) now give profiles without any research.
- **Ruling:** as written for the definition: a player is profiled once at least one research result has been imported for him, even an empty one (H-VUE-02, BKT-10). A profiled player with no valid case for a type is shown with the SEN-31 presentation, with zero valid cases. Calendar-derived profiles never make a player profiled and play no part in the routing of detected events by coverage (BKT-30): a player whose only profiles are calendar-derived is not profiled.
- **Why:** "profiled" exists to route press-detected events by research coverage, which calendar-derived types never enter (record 0015).
- **Owner review:** no

### CL-VUE-07 — Events without a lifecycle state

- **Affects:** 00 « Objets » (Événement), common states, DSN-06
- **Problem:** only detected events have states (detected, dismissed); historical events have none, and 00 defines no lifecycle for them.
- **Ruling:** as written. Historical and calendar-derived events carry no state: they exist until they are erased (deletion IMP-33, replacement IMP-29, withdrawal DSN-26, requalification or split TAX-25 and TAX-29, or re-derivation CL-TAX-19). Their case carries the four case states, and screens show the case state, never an event state, for them.
- **Why:** no requirement gives them a state; adding one would add nothing the case state does not already say.
- **Owner review:** no

### CL-VUE-08 — Three confidences

- **Affects:** 00 complementary terms « Confiance de détection », « Confiance de la recherche », « Confiance du profil »; VUE-05
- **Problem:** three different scales are all called confidence.
- **Ruling:** as written: three distinct notions, stored in distinct fields and always labelled with their full glossary term, never the bare word "confidence": detection confidence (integer 0 to 100, detected events), research confidence (three levels, historical events) and profile confidence (three levels, profiles and trends). Calendar-derived events carry neither of the first two (record 0015). An event of low research confidence counts like the others (record 0022).
- **Why:** 00 already defines three separate terms; the risk is only in labels.
- **Owner review:** no

### CL-VUE-09 — Technical choices stated in 00

- **Affects:** 00 « Dans le périmètre » (last item), README "no technical choice"
- **Problem:** the specs say they make no technical choice, yet 00 fixes a JavaScript or TypeScript stack and a free-tier relational database.
- **Ruling:** as written: these come from decisions D-18, D-23 and D-28 and bind; record 0002 now names Vercel Hobby, Neon Postgres and TypeScript.
- **Why:** decisions outrank the README's general statement.
- **Owner review:** no

### CL-VUE-10 — Prompts and stored texts in English, press in two languages

- **Affects:** 00 « Dans le périmètre » (press collection), H-11, TAX-16, BKT-21, DET-21
- **Problem:** the product is English, yet the press read is English and French, and the prompts are specified in French.
- **Ruling:** as decided (record 0010): the research prompt, the exploration prompt and the classifier instructions are in English; the application still collects and classifies English- and French-language articles; every text that an AI or the classifier writes for storage (description, justification, reservation, limit) is in English whatever the article's language; article titles and proper names stay as published.
- **Why:** the decision separates the product language from the press languages.
- **Owner review:** no

### CL-VUE-11 — What CA-VUE-01 and CA-VUE-09 check

- **Affects:** CA-VUE-01, CA-VUE-09, VUE-01, VUE-09, STA-04
- **Problem:** CA-VUE-01 tests only a national-team game; CA-VUE-09 omits the vigilance points that VUE-09 requires.
- **Ruling:** CA-VUE-01 also asserts that preseason, exhibition, All-Star, summer-league, G League and national-team games never become a measured game nor enter a baseline (STA-04). CA-VUE-09 also asserts that the page shows the two vigilance points of 00 (chosen population; many profiles, with the number of verdicts chance alone would produce) next to the conditional hypothesis, the five known limits and the withdrawn-events counter.
- **Why:** the criteria must test the whole requirement they cite.
- **Owner review:** no

### CL-VUE-12 — Calendar-derived events, a third origin

- **Affects:** 00 « Objets » (Événement, Cas), glossary « Événement », « Match mesuré », DSN-06; record 0015
- **Problem:** 00 knows two origins, detected and historical; record 0015 makes the application create birthday and former-team events itself from the schedule.
- **Ruling:** an event has one of three origins: detected, historical or calendar-derived.
  - A calendar-derived event is created and deleted by the calendar derivation (CL-TAX-18, CL-TAX-19), never by an import or a detection. The owner can withdraw it like any event (CL-DSN-09) and correct its context indicators, but never create it, dismiss it, or edit its player, type or date (CL-SUI-14, CL-IHM-21).
  - It carries the player, the type with its sheet version, a reference date equal to its game's day (known in advance, before kick-off), a reference to that game instead of sources, a description written by the application (CL-DSN-20), context indicators (unknown until the owner sets them, H-09) and management data. It carries no confidence, no precedence and no dating mark.
  - Its measured game is that game itself; if the player does not play it, the case is non-measurable (record 0015).
- **Why:** record 0015 adds the origin; 00 owns the object model every other file builds on.
- **Owner review:** no

### CL-VUE-13 — Historical or tracked: the origin of a calendar-derived case

- **Affects:** 00 glossary « Cas » (historique ou suivi), « Cas enregistré à temps », SUI-06; register open point "Lot 2 flow of upcoming calendar-derived events"
- **Problem:** a case is historical when it comes from a backtest and tracked when it comes from a detected event; calendar-derived events come from neither.
- **Ruling:** a calendar-derived case is tracked when its event was created before the scheduled start of its game, and is then recorded on time (SUI-06); it is historical when its event was created after that start, which is the case for every game already played when the derivation first sees it. In Lot 1 both kinds count in the profile like any case; tracked cases get the Lot 2 treatment of CL-VUE-14.
- **Why:** a game known in advance and recorded before kick-off is exactly what the validation table needs; this follows the recommended handling of record 0015.
- **Owner review:** yes — upcoming birthday and first-reunion games now enter the validation table as real-condition tests, which no French text foresaw.

### CL-VUE-14 — Upcoming calendar-derived events go through steps 8 to 10

- **Affects:** VUE-10, CA-VUE-10, 00 « Parcours » steps 8 to 10, ALE-01, SUI-01, TEL-11; register open point "Lot 2 flow of upcoming calendar-derived events"
- **Problem:** VUE-10 covers detected events of profiled players only; nothing says what follows an upcoming calendar-derived event.
- **Ruling:** in Lot 2, a calendar-derived event created before kick-off for an active player goes through steps 8 to 10 with no action from the owner: an alert sheet (09), a tracked case whose forecast is frozen at tip-off (10), then the measured case in the profile and in the validation table, with the Telegram messages of 11. No research coverage is required, no backtest request is created and no "type not covered by the backtest" mention appears; the sheet's content follows the player's number of valid cases for that type (ALE-12). For a paused player the event and its tracked case exist but no alert sheet is produced (ALE-01, JOU-18); withdrawn players get no derivation (CL-JOU-05).
- **Why:** an upcoming birthday or reunion is a new event of the player (D-29); its history is fully derived, so no backtest condition makes sense (record 0015, recommended handling).
- **Owner review:** yes — the owner will receive alert sheets and Telegram alerts for upcoming birthday and first-reunion games.

### CL-VUE-15 — Opening the source of a calendar-derived event

- **Affects:** VUE-05, CA-VUE-05
- **Problem:** every verdict must give access to the sources of the events it counts, but calendar-derived events have no press source.
- **Ruling:** for a calendar-derived event, the place of the source is taken by its game: opening it shows the game's date and tip-off, the two teams, and the basis of the derivation — for a birthday, the recorded day and month of birth; for a former team, the date of the player's last game for that team. CA-VUE-05 passes when every counted event opens either its press sources or, for a calendar-derived event, its game.
- **Why:** the schedule is the evidence of these events (record 0015); VUE-05 asks that every counted event be traceable.
- **Owner review:** no

## Ruled elsewhere

- **Supplementary request "created or proposed"** (00 « Variantes ») — owned by 05: BKT-04 creates the detection-born supplement, BKT-05 proposes the validation-born one and creates nothing without the owner's agreement; no change needed.
- **Alert sheet for a non-profiled player whose result is imported after tip-off** — owned by 09: ALE-05 settles it (no sheet after tip-off; the event stays a tracked case); no change needed.
- **Valid case versus the "measured" state** — owned by 08: SEN-07 settles it (a measured case has no retained doubtful criterion, so measured and valid coincide; a case with one is "excluded"); no change needed.
- **Which season the normalized gap uses** — owned by 07: STA-16 and STA-17 settle it (the measured game's season and phase, only the measured game removed); no change needed.
- **Details of the Lot 2 flow of calendar-derived events** — owned by 09, 10 and 11: settled consistently with CL-VUE-13 and CL-VUE-14 by CL-ALE-13 (sheet), CL-SUI-14 (tracked case, timing, deletion before kick-off) and CL-TEL-21 (messages); no change needed.

## Passed to the glossary

- English terms for every common and complementary term of the 00 glossary and for the common states (VUE-08).
- Two distinct English terms: withdrawing an event (erasure) versus the withdrawn state of a player or a type.
- The label of the third origin, calendar-derived.
- The full English names of the three confidences.
- The title of the « Méthode et limites » page and the label of the withdrawn-events counter.
