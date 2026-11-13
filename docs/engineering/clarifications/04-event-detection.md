# Clarifications — 04 Event detection

Rulings on the unclear points of the French spec `docs/04-detection-des-evenements.md`, numbered `CL-DET-nn`.
The decision records (`docs/adr/`, listed in `docs/engineering/spec-deviations.md`) and these rulings override the spec text where they say so; the French spec is authoritative everywhere else, and `docs/engineering/glossary.md` fixes every English term used here.

### CL-DET-01 — One processing state for results given per player and per fact

- **Affects:** COL-35, DET-06, DET-16, DET-20, DET-24, DET-34, DET-36, DET-49, DET-54, DET-58
- **Problem:** an article has one processing state (COL-35), while classification answers per recognized player and per fact; nothing says which state wins when the outcomes differ, nor what becomes of a below-threshold part of an article attached for another player, which DET-49 cannot rescue because the article is not « non pertinent ».
- **Ruling:**
  - Results are kept per article and per recognized player (a "part"). A part holds zero or more facts, each with one outcome: attached to an event (detected or dismissed), linked to a pending proposal, or a not-relevant reason (« sous le seuil », « fait ancien », « déjà rapporté par un backtest », « type rejeté ou retiré », « proposition rejetée », and those of CL-DET-12 and CL-DET-27). A classified part with no fact has the reason « aucun fait »; a part not yet classified, or unusable, is pending.
  - The article's state is derived in this order: « rattaché » if any fact is attached; else « lié à une proposition » if any fact is linked to a pending proposal; else « en attente de classification » if any part is pending; else « non pertinent ». An article in which the prefilter recognizes nobody is « non pertinent » with the reason « aucun joueur suivi ».
  - The queue item holds the pending parts only; an article can be « rattaché » and still queued for another player.
  - A « non pertinent » article shows every distinct reason of its parts and facts, and a filter by reason matches any of them. The state is recomputed after every change of a part: classification, rescue, detachment, proposal decision, re-prefiltering (DET-07).
  - Rescue (DET-49) is offered on every kept article holding at least one not-relevant outcome, whatever its state; it creates or completes an event for the player and validated type the owner picks, with origin « utilisateur ».
  - A part's below-threshold answer stays visible as long as the article is kept (DET-24).
- **Why:** retention must follow the strongest reason to keep an article (COL-37, COL-38), and per-part rescue keeps the exhaustive counting (H-01) that a single state would lose.
- **Owner review:** yes

### CL-DET-02 — Contents and limits of the classification response

- **Affects:** DET-12, DET-14, DET-16, DET-21, DET-22, DET-34; register row DET-16
- **Problem:** DET-16 describes in plain words what the model returns; the response checks need the exact contents and allowed values, and the line between an unusable answer, which is resubmitted, and a non-compliant text, which is replaced.
- **Ruling:** the domain model names the fields; their contents are:
  - per submitted article, one result naming the article it answers (DET-12 batching); per result, one part per submitted player, naming that player by the identifier sent;
  - per part, a list of facts, possibly empty, each of exactly one kind:
    - validated-type fact: a type identifier among the validated types sent; a detection confidence, a number from 0 to 100 rounded half up to an integer; a description; either "new fact" or the identifier of one event sent for that player (DET-14); a precedence date or none (CL-DET-06); the two context indications with the closed values of the research format, in their English form (register row DET-16; the glossary renders « oui, non, inconnu » for the injury return and « fort, normal, inconnu » for the game stakes); a justification;
    - known-entry fact: the identifier of a do-not-repropose entry sent, and a justification;
    - new-type fact: a suggested type name, a suggested one-sentence definition and a justification, which is also the proposal's "reason why no validated type fits" (CL-DET-19);
    - calendar-handled fact: the identifier of an entry of the calendar list of CL-DET-22; such a fact is dropped.
  - Unusable for the part concerned (DET-22): a player, type, event or entry identifier that was not sent; a proposed, rejected, withdrawn or calendar-derived type used as a validated type (CA-DET-09); a missing element; a confidence that is missing, not a number or outside 0–100; a context value outside the closed lists; a fact mixing kinds. A submitted article with no result has all its parts unusable.
  - A text that is present but fails the checks of DSN-24 (length, quotation marks) never makes a part unusable: DET-21's replacements apply (CL-DET-18).
  - A precedence date later than the publication date sent to the model counts as none.
- **Why:** every check becomes mechanical and testable, and quota is spent again only on what DET-22 calls unusable.
- **Owner review:** no

### CL-DET-03 — Attempts, resubmissions and new classifications

- **Affects:** DET-12, DET-13, DET-22, DET-26, DET-50, CA-DET-09, CA-DET-32
- **Problem:** DET-12 lists the only exceptions to single submission and omits DET-22's resubmission; "up to a number of attempts (default 2)" can mean attempts or retries; what a new classification does to earlier outcomes is not said.
- **Ruling:**
  - DET-22's resubmission is a fourth exception to DET-12, beside DET-50, DET-07 and DET-36.
  - « Nombre de tentatives » counts every submission of one classification cycle, the first included: by default one submission and at most one resubmission.
  - A resubmission sends the same input as the first submission (all recognized players, events and lists, refreshed to their current state); only the parts that were unusable take the new answer, and usable parts keep their result.
  - When the cycle ends with a part still unusable, the queue item is marked « classification en échec » for that part; usable parts are applied.
  - A call refused for quota or not answered is no attempt (DET-08): it consumes none and the item keeps waiting.
  - The owner's "new attempt" (DET-22) and "new classification" (DET-50) are one action: a new cycle with the full number of attempts, at the head of the queue (CL-DET-13). Its result replaces the outcome of the parts that were pending or had a not-relevant outcome, and may add attachments; existing attachments and proposal links stay until the owner detaches the article (DET-47) or decides the proposal (DET-36). Earlier results stay in the article's history (DET-54).
- **Why:** CA-DET-09 (« soumis de nouveau, puis marqué … après la dernière tentative ») fits two submissions; resending the full context keeps the player designation of DET-17 stable, and no automatic path may undo an event (DET-26).
- **Owner review:** no

### CL-DET-04 — When the queue counts as empty

- **Affects:** DET-08, DET-10, DET-11, DET-22, DET-50, variant A, edge case « Modèle indisponible pendant plusieurs jours », TRV-25, TRV-33, TRV-45
- **Problem:** failed items stay waiting with a mark (DET-22), while the resume task runs "while the queue is not empty" (DET-10) and the « quota atteint » incident closes only "when the queue is empty" (DET-11); if failed items count, neither ever stops, and DET-10's six hours have no starting point. Variant A also opens an incident when the model is unavailable, which DET-11 does not name.
- **Ruling:**
  - An item is eligible when at least one of its parts is pending and not marked « classification en échec »; "the queue is empty" means that no item is eligible.
  - A failed item is never resubmitted automatically; it stays in the queue view with its mark (IHM-71) and among the waiting items of the status screen (TRV-46) until the owner retries or classifies it (DET-13, DET-22).
  - A pass or a resume run stops submitting at the first call refused for quota, including a refusal before the declared limit (TRV-06), or not answered; the other eligible items wait.
  - When a run stops that way with eligible items left, one classification incident is opened or kept open; its message names the cause: quota reached; refused before the declared limit, inviting the owner to check the free-tier conditions; or service not answering. A change of cause updates the open incident without a new message. It closes at the end of the first run after which no item is eligible.
  - The resume task is due, while an item is eligible, 6 hours (parameter, H-DET-05) after the end of the last run that processed the queue, pass or resume, or at the provider's quota reset when that comes first — when that run stopped for a provider's quota and the reset instant is known, from the provider's declared boundary (CL-TRV-12) or the rate-limit headers of its refusal. Every scheduled collection pass also processes the queue.
  - An owner's new attempt (DET-22) or new classification (DET-50) that makes an item eligible makes the resume task due at once, as an on-demand run (TRV-33), subject to the quota: while the provider's limit for the period is reached (TRV-04, TRV-06), the item waits for the run that the previous rule makes due. The incident's planned resumption follows from these two rules (CL-DET-05).
- **Why:** items that need the owner cannot keep an automatic incident open for ever, and variant A and the edge case require an incident when the model is down. With one provider, the overflow of the 23:00 run would otherwise be classified around 05:00 Paris time, after most tip-offs, although the allocation renews hours earlier. An owner who asks for a new attempt expects it now, within the quota.
- **Owner review:** yes

### CL-DET-05 — Content of the classification incident

- **Affects:** DET-11, TEL-15, CA-DET-06
- **Problem:** DET-11 requires the number of waiting articles, the concerned player whose game is nearest and the planned resume time, without defining the last two; the TEL-15 example shows "140 of 210 articles" and "at the next pass" instead.
- **Ruling:** the incident, on screen and in its Telegram message, states:
  - the number of eligible waiting articles when it opens (the screen shows the current number);
  - the nearest player: among the active players recognized in eligible items, the one whose next game (STA-26) starts first, with that game's date, time and opponent; if none has a known next game, a sentence saying so;
  - the planned resume: the first run of the resume task or of a collection pass due at or after the quota's reset instant when it is known, otherwise the next run of either (CL-DET-04), as a date and time in the owner's zone;
  - the cause (CL-DET-04).
  - The example's article count may stay as extra context; the items above are required.
- **Why:** DET-11 owns the content and wins over the TEL-15 example (a requirement wins over an example).
- **Owner review:** no

### CL-DET-06 — The precedence indication and « datation à vérifier »

- **Affects:** DET-14, DET-16, DET-31, DET-32, SEN-45, CA-DET-16
- **Problem:** DET-16 asks the model for a precedence indication and DET-32 compares "that moment" with game start times, but neither says what the indication is, who turns « lundi soir » or « hier » into an instant, or how the model can resolve them, since it is not told how precise the publication instant is.
- **Ruling:**
  - The model receives the retained publication instant in ISO 8601, with the offset of the outlet time zone when known and `+00:00` otherwise, together with its precision (« exacte », « approximative », « absente »).
  - The precedence indication is a calendar date, `YYYY-MM-DD`, or none: the day on which, according to the article, the fact happened or became public, read in the article's own frame, when the article places it before its own publication (an earlier day, or earlier the same day); none otherwise.
  - The app sets « datation à vérifier » when an official game of the player's team (STA-27) has a scheduled start at or after 00:00 of that date — in the outlet time zone when known, otherwise in US Eastern time (`America/New_York`) — and strictly before the event's reference date. It uses the earliest precedence date among the results attached to the event, and recomputes the mark when the reference date moves (DET-31); a mark the owner lifted is never set again for that event.
- **Why:** a date is all the article reliably gives; US Eastern is the frame most NBA press and the league's own dates use (TRV-72), and the precision tells the model how far it can trust the publication date when resolving « hier ».
- **Owner review:** yes

### CL-DET-07 — Classifications made by the owner

- **Affects:** DET-13, DET-24, DET-25, DET-28, DET-49, DET-53, ALE-08, ALE-16
- **Problem:** DET-13 and DET-49 collect only a player and a type, while an event needs a description, context indications and a detection confidence (the event's confidence is the highest of its articles, DET-25 bands it, ALE-16's vigilance margin uses it).
- **Ruling:**
  - A result of origin « utilisateur » holds player, type or "no event", instant, origin and the validated types at that instant; no detection confidence, justification, instructions version or precedence date.
  - An event created from it gets DET-21's template description (type name, outlet and date of the reference article) without the « description à revoir » mention, and the context indications « inconnu »; the owner corrects both through DET-47.
  - An event's detection confidence is the highest confidence among its model-origin results; an event whose results are all of origin « utilisateur » has none and shows that origin instead (ALE-08).
  - Such events form their own user-origin row in the breakdown of DET-25, and the vigilance caveat of ALE-16 never applies to them.
- **Why:** the owner judged the fact; inventing a confidence or a text would misstate where the decision came from.
- **Owner review:** no

### CL-DET-08 — Language of the detection texts

- **Affects:** DET-16, DET-21, DET-23, H-11; ADR 0010
- **Problem:** DET-21 requires descriptions, justifications and suggested definitions in French whatever the article's language.
- **Ruling:** As written in ADR 0010 and the register rows DET-16 and DET-21: every text the model writes, the template description and the mentions are in English whatever the article's language, and so are the instructions given to the model; English and French articles are both still classified, and titles stay as published.
- **Why:** the owner's decision overrides H-11.
- **Owner review:** no

### CL-DET-09 — Dismissed events and the validation table

- **Affects:** DET-44, DET-46, SUI-16, SUI-17, SUI-25, IHM-32, CA-DET-24, CA-SUI-13
- **Problem:** DET-44 says a dismissed event's case leaves the validation table, while SUI-17, IHM-32 and CA-SUI-13 show a case dismissed after tip-off in a separate count of that table.
- **Ruling:** a dismissed event's case leaves every calculation: profiles, general trends and every computed figure of the validation table (testing set, assessments). When the dismissal instant is at or after the measured game's scheduled start, the case appears only in its rows' separate count of post-tip-off decisions, as an exit with its gap in the forecast direction (SUI-17, SUI-25, CL-SUI-10); otherwise it appears nowhere in the table (SUI-16). DET-44's « tableau de validation » means its calculations.
- **Why:** both texts then hold, and a sorting made after seeing the result stays visible (SUI-17).
- **Owner review:** no

### CL-DET-10 — Handling « doublon possible d'un événement historique »

- **Affects:** DET-43, DET-52, DET-58, IHM-20, IHM-32, IHM-67, CA-DET-35
- **Problem:** DET-58 describes only the "same fact" outcome (dismissal); there is no way to clear the mark when the facts are distinct, IHM-32 does not list it among the marks shown, and nothing draws the owner's attention while the case counts.
- **Ruling:**
  - The mark is set when an event is created with a type different from that of a historical event of the same player whose public date is within the correspondence window of IMP-25 (file 06 parameter, default 2 days).
  - It is shown wherever the other two marks are: detected-events list (IHM-32), event page (IHM-67), alert sheet.
  - The event page offers "not the same fact", which lifts the mark; the lift is traced (DET-52), changes no calculation and is no post-tip-off decision (SUI-17), since the mark never changed the counts.
  - A marked event appears in the to-do section « événements et cas à examiner » (IHM-20) until the mark is lifted or the event dismissed.
- **Why:** while marked the case counts normally; without a way out and a reminder, one fact could be counted twice (SUI-07).
- **Owner review:** yes

### CL-DET-11 — Which events the model receives

- **Affects:** DET-14, DET-28, DET-29, DET-31
- **Problem:** DET-14 can be read as limiting only the historical events to the grouping window, or both kinds, and does not say whether events dated after the article are sent.
- **Ruling:** for each recognized player the model receives his detected events, dismissed ones included, and his historical events whose reference date is at or after the article's retained instant minus the grouping window (default 72 hours). There is no upper bound: events created from later articles are sent, so an older article can attach to them and move the reference date earlier (DET-31). Calendar-derived events are never sent (ADR 0015).
- **Why:** DET-29 bars only older events from grouping, and the nominal scenario sends "the recent events, detected or historical".
- **Owner review:** no

### CL-DET-12 — Reason for a detached article

- **Affects:** DET-41, DET-47, DET-52, COL-36, COL-37, TEL-18
- **Problem:** a detached article that "becomes not relevant" has no reason among those listed, and the routing of a detached article that forms its own event is not stated.
- **Ruling:** detaching an article gives the part that attached it a new reason, « détaché par l'utilisateur » ("Detached by you"), and the article state is recomputed (CL-DET-01); if it becomes « non pertinent », its retention clock starts at the detachment. When the owner makes it its own event instead, that event has origin « utilisateur », takes the article's retained instant as reference date and is routed at creation (DET-41), with no notification (TEL-18).
- **Why:** the reasons must cover every way an article becomes not relevant, and the new event is the owner's correction.
- **Owner review:** no

### CL-DET-13 — Order of the classification queue

- **Affects:** DET-07, DET-09, DET-22, DET-36, DET-50, CA-DET-07, CA-DET-32
- **Problem:** DET-09 does not say which player's game counts for an article that recognizes several players, where articles of players without a known next game go, whether DET-07 items count as reclassifications, or how ties break.
- **Ruling:** eligible items are ordered at each run:
  1. the owner's requests (DET-50, DET-22 retries), the most recent first;
  2. automatic reclassifications (DET-36, DET-07), the oldest trigger first;
  3. items with an active recognized player whose next game (STA-26) starts within the queue priority horizon (default 48 hours from the run), the earliest such game first, an article with several players taking its earliest;
  4. all others, the oldest retained publication instant first, including items whose players' next games are all unknown.
  - Ties: the older retained instant, then the older first collection, then the article identifier.
- **Why:** this is DET-09's order made total; DET-12 itself calls DET-07 a reclassification.
- **Owner review:** no

### CL-DET-14 — Re-prefiltering and the exposure count

- **Affects:** DET-07, DET-57, JOU-03, CA-DET-05, CA-DET-36
- **Problem:** re-prefiltering for a new variant or player (DET-07) can count an article twice in the exposure count, and nothing says what happens to an article already processed that gains a player.
- **Ruling:**
  - The exposure count adds one for a (player, article) pair the first time the prefilter recognizes that player in that article, at the first prefilter or at a DET-07 re-prefilter; the day is the article's first-collection day in the owner's time zone. A pair already counted is never counted again.
  - An article that gains a player gets a new pending part for that player only, enters the queue for it, and its state is recomputed (CL-DET-01): a « non pertinent » article becomes « en attente de classification » and its retention clock stops until it is « non pertinent » again.
- **Why:** the indicator counts articles that cited the player, not prefilter runs, and the new part must get its chance to be classified.
- **Owner review:** no

### CL-DET-15 — Position of a dismissal, and measuring a late-dismissed case

- **Affects:** DET-44, DET-46, SUI-16, SUI-17, CA-SUI-13, TEL-23, TEL-38
- **Problem:** DET-46 records whether a dismissal came before or after the measured game's tip-off, but that game may not be established yet or may change (DET-31); and DET-44 stops tracking the game, so a case dismissed after tip-off but before its statistics arrive has no gap for SUI-17's separate count.
- **Ruling:**
  - Only the dismissal instant is stored. Its position is derived at each display, against the measured game's scheduled start once established, otherwise against the expected game's; with neither known it is "before".
  - A case whose event is dismissed before the expected game's scheduled start stops being tracked.
  - A case whose event is dismissed at or after that start keeps being attached and measured by file 08, outside every calculation, so that SUI-17's separate count can show its gap; no tracked-game result is sent for it (TEL-23, TEL-38). If its measured game turns out to start after the dismissal, it is a dismissal before tip-off (SUI-16) and appears nowhere in the table.
- **Why:** a dismissal made after watching the game is exactly the sorting SUI-17 must keep visible, and without measurement its gap would be lost.
- **Owner review:** yes

### CL-DET-16 — Late-detection mark when the expected game is unknown

- **Affects:** DET-33, SUI-06, CA-DET-17
- **Problem:** DET-33 sets the mark at creation from the expected game, which may then be unknown (stats source down, off-season).
- **Ruling:** the mark is computed, not set once: when the measured game is established, it is set if that game's scheduled start is at or before the event's creation instant, and then equals SUI-06's « enregistré après le coup d'envoi »; before that, if an expected game is known, it is set if that game's scheduled start is at or before the creation instant; otherwise it is not set.
- **Why:** DET-33 already confirms or lifts the mark once the measured game is known; this fills the time before.
- **Owner review:** no

### CL-DET-17 — Type-sheet version kept with an event

- **Affects:** DET-53, TAX-23
- **Problem:** DET-53 keeps the version "in force at creation or at the last type correction", TAX-23 the version "in force at its detection".
- **Ruling:** As written in DET-53: the version in force when the event was created, replaced by the version in force at each later correction of its type; TAX-23 states the creation case only, and the two agree.
- **Why:** DET-53 is the specific rule for detected events.
- **Owner review:** no

### CL-DET-18 — Text rules for justifications, suggested names and definitions

- **Affects:** DET-21, DSN-10, DSN-20, DSN-24, DSN-25, TEL-14
- **Problem:** DET-21 says the justification and the suggested definition "obey the same rules" as the description, without saying whether the length limit applies, and says nothing of the suggested name.
- **Ruling:** the same two automatic checks — at most the description maximum of DSN-20 (default 200 characters), no quotation mark among the characters of CL-DSN-03 — apply to the description, the justification, the suggested definition and the suggested type name. A failing description is replaced by the template; any other failing text by « texte non conservé ». A proposal whose name was replaced keeps that mention as name until the owner completes it (file 02).
- **Why:** DSN-10 subjects every free text attached to an event or a type sheet, a proposal included, to file 13's rules, and one limit is simpler than two.
- **Owner review:** no

### CL-DET-19 — The "reason why no validated type fits"

- **Affects:** DET-16, DET-34, TAX-18
- **Problem:** DET-34 sends each proposal with "the reason why no validated type fits", while DET-16 only asks the model for "a justification" for such a fact.
- **Ruling:** they are the same text: the justification of a new-type fact is stored as the proposal's reason (CL-DET-02); an occurrence added to an existing entry stores its justification with the occurrence.
- **Why:** DET-16 lists what the model returns and DET-34 what the proposal carries; nothing else could supply the reason.
- **Owner review:** no

### CL-DET-20 — Two runs a day and "the next daily run"

- **Affects:** DET-10, TRV-25; ADR 0019
- **Problem:** DET-10 resumes the queue "at the latest at the next daily run", written for one run a day.
- **Ruling:** "the next daily run" is the next scheduled collection pass, at whichever configured time (16:30 or 23:00 Paris time by default); each pass prefilters its own new articles, then processes the eligible queue in the order of CL-DET-13.
- **Why:** ADR 0019 makes every configured time a pass with chained detection.
- **Owner review:** no

### CL-DET-21 — Withdrawal fingerprints at detection

- **Affects:** DET-13, DET-28, DET-49, DET-58; open point 1 of ADR 0017
- **Problem:** ADR 0017 makes detection check the withdrawal fingerprints before creating an event, but leaves open the date tolerance, the order with DET-58 and the owner's own classifications.
- **Ruling:**
  - The check runs when a model-origin fact would create a new event, not when it attaches to an existing one, and before DET-58's search for a historical event.
  - Candidate days: every calendar day from the would-be reference date's day minus the correspondence window of IMP-25 (default 2 days) to that day plus the window, each day computed as file 13 computes it when it creates a fingerprint. The fact matches when the keyed hash of (player, type, one of these days) equals a stored fingerprint.
  - A match creates no event, case, sheet or request; the part is handled by CL-COL-16, and nothing about the match is logged.
  - The calendar derivation runs the check too, on the derived game's day only (CL-DSN-06, CL-SUI-14).
  - Events created by the owner (DET-13, DET-49) are not checked: the owner acts knowingly and can withdraw again, and no screen may tell him about a withdrawn event (IHM-68, ADR 0017).
- **Why:** day precision over the IMP-25 window is ADR 0017's recommendation, and checking first keeps any readable trace of a withdrawn fact from being created.
- **Owner review:** yes

### CL-DET-22 — Articles that report a birthday or a reunion

- **Affects:** DET-14, DET-15, DET-16, DET-34, TAX-18; open point 3 of ADR 0015
- **Problem:** calendar-derived types are not sent as types to classify into (ADR 0015), so the model could report a birthday game or a reunion as a new-type proposal or as an occurrence of a do-not-repropose entry.
- **Ruling:**
  - The model also receives a list of the types handled by the calendar: name and definition of every type whose dating rule says "derived from the calendar", whatever its state; such types are never in the do-not-repropose list.
  - The instructions (DET-23) say that a fact matching that list is not to be reported; a fact the model still reports against an entry of that list is dropped, neither unusable nor counted, and a part left without facts gets « aucun fait ».
  - In an article that reports another fact as well, only that other fact is processed (register, DET-15).
  - A fact the model reports as a new-type proposal without naming the list entry goes through DET-34 like any other; the owner rejects it or attaches it as an occurrence (file 02).
- **Why:** this is ADR 0015's recommended handling; dropping rather than resubmitting avoids spending quota on a fact the calendar already covers.
- **Owner review:** yes

### CL-DET-23 — Players paused or withdrawn after the prefilter

- **Affects:** DET-02, DET-07, DET-09, JOU-18, JOU-19
- **Problem:** recognized players are fixed when the article is prefiltered; nothing says what becomes of the pending part of a player paused or withdrawn before classification.
- **Ruling:** each submission includes only the parts of players active at that moment; a pending part of a paused or withdrawn player is closed without a model call, with the reason « aucun joueur suivi ». When a paused player is reactivated, DET-07 re-prefilters his recent kept articles (CL-DET-14).
- **Why:** JOU-18 and JOU-19 rule out detected events for paused and withdrawn players, and DET-07 already restores what matters at reactivation.
- **Owner review:** no

### CL-DET-24 — Confidence bands and period filters

- **Affects:** DET-25, DET-56, CA-DET-33
- **Problem:** DET-25's bands have no width, and the period filters of DET-25 and DET-56 do not say which instant puts an item in a period.
- **Ruling:** bands are 10 points wide (new parameter, confidence band width, default 10, registered under file 04 per TRV-40): 0–9, 10–19, …, 90–100; only bands holding at least one event are shown, plus the user-origin row (CL-DET-07). Each item enters a period by its own instant: events by their creation instant, dismissals by the dismissal instant, corrections and rescues by theirs, proposals by their transmission instant.
- **Why:** the owner tunes a threshold on a 0–100 scale, and ten-point bands match the scale of the vigilance margin.
- **Owner review:** no

### CL-DET-25 — Units of the detection-journal counters

- **Affects:** DET-55, CA-DET-33
- **Problem:** DET-55 mixes counters that can be read per article or per fact.
- **Ruling:** per article: received, not retained by the prefilter, classified, classified without fact, failed classifications, still waiting at the end of the run. Per fact: attached to an existing event, below threshold, old facts, already reported by a backtest, proposals transmitted, occurrences added, descriptions replaced, events created. Quota in calls: consumed during the run, remaining for the current period.
- **Why:** each counter answers one question, and its label says which unit it counts.
- **Owner review:** no

### CL-DET-26 — A dated public source given without a time

- **Affects:** DET-48, CA-DET-28
- **Problem:** DET-48 lets the owner move the reference date earlier with a dated public source (link, outlet, publication instant), without saying what happens when only the date is known.
- **Ruling:** the form asks for the publication date and, optionally, the time and its zone. A source with a date only, or a time without zone, gets its instant by COL-21 as CL-COL-02 applies it (end of that day, or that wall time, at UTC−12 when no zone is given) and the precision « approximative ». The change is refused when that instant is not earlier than the current reference date (DET-48).
- **Why:** a source supplied by the owner must be dated as cautiously as a collected one.
- **Owner review:** no

### CL-DET-27 — Dating an event at a coverage threshold (media storm)

- **Affects:** DET-27, DET-29, DET-30, DET-31, DET-49, DET-58, annex « Tourmente médiatique » of file 02, TRV-38; CL-TAX-14 (file 02 ruling)
- **Problem:** the media-storm sheet dates its event at the publication of the article that brings the coverage to its threshold (CL-TAX-14), while DET-30 dates every event at its earliest article, and nothing says what detection does with the type's facts before the threshold is reached.
- **Ruling:**
  - This applies to a type whose sheet carries a coverage threshold of N distinct outlets within D days (CL-TAX-14); an article's outlet is the outlet name it keeps (COL-06, COL-25).
  - A model-origin fact of that type that would create a new event (CL-DET-02) creates none at once: it takes the not-relevant outcome « sous le seuil de couverture » and waits, in one group with the other waiting facts of that player and type whose articles' retained instants lie within D days of its own.
  - When the articles of a group come from at least N distinct outlets whose retained instants lie within D days, the event is created. Its reference date is the retained instant of the article that brings the N-th outlet, which is its reference article; every fact of the group is attached to it, and the article states are recomputed (CL-DET-01). The fingerprint check (CL-DET-21) and the search for a historical event (DET-58) run at that moment, as for any new event.
  - Afterwards articles attach as to any event (DET-28). An attached article with an older retained instant moves the reference date to the earliest instant at which the threshold is met, never before it (DET-31); a detachment follows DET-31 as written.
  - Facts of a group that never reaches the threshold keep « sous le seuil de couverture » once their D days have passed; rescue (DET-49) is offered on them like on any not-relevant outcome. Events the owner creates (DET-13, DET-49) are dated by DET-30.
- **Why:** the annex dates a storm at « la publication de l'article qui le franchit » and measures the first game after the third article; before the threshold there is no storm to measure, and the waiting facts keep their articles under the ordinary retention (CL-COL-08).
- **Owner review:** no

### CL-DET-28 — One event per record approach

- **Affects:** DET-14, DET-27, DET-29, DET-43, DET-47, annex « Approche d'un record historique positif » of file 02
- **Problem:** the record-approach sheet excludes the following games when the record is not broken at the first game presented as decisive, "since a record gives only one event", while detection groups articles only within the grouping window and the application tracks no records.
- **Ruling:** As written in the annex: « un record ne donne qu'un événement » is an exclusion criterion of the sheet, which the classifier receives in full (DET-14) with the player's recent events (CL-DET-11); the application keeps no list of records. A later article about the same record that the model still reports as a new fact creates a new event, which the owner merges into the first one (DET-47), the correction DET-43 prescribes for the duplicate of another detected event.
- **Why:** the criterion belongs to the sheet the model applies, and a register of records would be a second taxonomy that the specs do not provide.
- **Owner review:** no

## Passed to the glossary

- Not-relevant reasons « aucun joueur suivi », « aucun fait », « sous le seuil », « fait ancien », « déjà rapporté par un backtest », « type rejeté ou retiré », « proposition rejetée », and the new « détaché par l'utilisateur » and « sous le seuil de couverture » (CL-DET-27).
- Marks « datation à vérifier », « détecté après le coup d'envoi », « doublon possible d'un événement historique »; mentions « description à revoir », « texte non conservé », « classification en échec »; the "not the same fact" action.
- Dismissal reasons of DET-43; the three causes of the classification incident (CL-DET-04); the name of the calendar list of CL-DET-22.
- The new parameter "confidence band width" and the user-origin row of DET-25.

## Ruled elsewhere

- File 13, DSN-21 and DSN-24: ruled by CL-DSN-03 — the quotation-mark check fails a text that holds « » “ ” „ ‟ or the straight double quote, never one that holds an apostrophe, straight or typographic (' ’), which English and French text needs.
- File 13, fingerprint creation (ADR 0017): ruled by CL-DSN-06 — the fingerprint's day is the reference date's calendar date in the owner's time zone (TRV-72), or the date as written when the reference date has no time; CL-DET-21's window absorbs any one-day shift between zones.
- File 06, IMP-25: ruled by CL-IMP-34 — its window parameter is the one used by the possible-duplicate mark (CL-DET-10) and by the fingerprint check (CL-DET-21), a single parameter.
- File 02, TAX-23: ruled by CL-TAX-22, which names the type correction of DET-53 next to the creation case (CL-DET-17).
