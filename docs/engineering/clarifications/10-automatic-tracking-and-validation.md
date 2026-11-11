# Clarifications — 10 Automatic tracking and validation

Rulings on the unclear points of the French spec `docs/10-suivi-automatique-et-validation.md`, numbered `CL-SUI-nn`.
The decision records (`docs/adr/`, listed in `docs/engineering/spec-deviations.md`) and these rulings override the spec text where they say so; the French spec is authoritative everywhere else, and `docs/engineering/glossary.md` fixes every English term used here.

### CL-SUI-01 — Identifiers of the acceptance criteria

- **Affects:** the 21 acceptance criteria of file 10
- **Problem:** the criteria are bullets with neither numbers nor IDs.
- **Ruling:** As written in the orchestrator's planning ruling on acceptance-criterion IDs: they are `CA-SUI-01` to `CA-SUI-21`, in document order; the register's `10 AC-n` cites the same criteria.
- **Why:** one citation scheme for every file.
- **Owner review:** no

### CL-SUI-02 — Content of the overall row

- **Affects:** SUI-23, SUI-24, SUI-26, SUI-28
- **Problem:** SUI-23 defines the overall row as all tracked cases with a forecast, while SUI-24(c) asks every row to compare all its cases, with or without a forecast, with the valid historical cases "of the same row", which the overall row lacks.
- **Ruling:** the overall row holds every tracked case of the testing set (valid, recorded in time, no late forecast, untouched by a post-tip-off decision), with or without a forecast, like any other row:
  - (a) counts cases with and without a forecast; (b) and the assessment use the cases with a forecast, which are SUI-23's "tracked cases with forecast";
  - (c) compares the mean gap of all its testing cases with the current mean gap of all valid historical cases, every player and type;
  - its sub-rows (SUI-28) split the cases with a forecast by source and level: probable profile, possible profile, general trend.
- **Why:** the overall row stays comparable with the others, while its assessment rests on forecasts only, as SUI-23 and SUI-28 intend.
- **Owner review:** yes

### CL-SUI-03 — Forecast versions, freezing, and a later change of measured game

- **Affects:** SUI-06, SUI-08, SUI-09, SUI-17, SUI-18
- **Problem:** the frozen forecast is the last version before the measured game's scheduled start, yet that game is only known afterwards, and nothing says what happens when a post-tip-off decision changes it.
- **Ruling:**
  - While a case is « en attente du match », a forecast version is recorded at its creation and at every change of the pair's historical profile or of the type's historical trend that changes the forecast, each with its instant.
  - When file 08 first establishes the measured game, the frozen forecast is the last version strictly before that game's scheduled start, and « enregistré à temps » is decided against the same start.
  - If a post-tip-off decision later changes the measured game (SUI-17), the frozen forecast is not chosen again and never changes (SUI-09); the case, now touched by a post-tip-off decision, keeps its category against that forecast, and « enregistré à temps » is recomputed against the new game.
- **Why:** recording versions while the case waits makes the retrospective choice exact; a case touched after tip-off tests nothing, so choosing again would only add moving parts.
- **Owner review:** no

### CL-SUI-04 — Parameter changes after a game

- **Affects:** SUI-09, SUI-21, SUI-25, IHM-51, TRV-35, edge case « Paramètre modifié après le match »
- **Problem:** changing a parameter after a game re-measures cases and can move them in or out of the counts, yet such cases are not SUI-17 decisions.
- **Ruling:** As written in the edge case: « le cas est mesuré de nouveau avec les nouveaux paramètres et sa catégorie peut changer, mais son pronostic figé ne change pas ; le tableau affiche la date du changement ». A parameter change applies to every case alike and is no post-tip-off decision. The table shows the date of the last change of any parameter that influences calculations (TRV-35), linked to its journal entry with the old and new values (IHM-51, CL-IHM-12).
- **Why:** a global change cannot pick cases by their result, and the journal and the date keep it visible.
- **Owner review:** no

### CL-SUI-05 — When a late forecast is computed

- **Affects:** SUI-08, SUI-10, SUI-25, SEN-19, CA-SUI-03, CA-SUI-04, CA-SUI-07; ADR 0015
- **Problem:** SUI-10 gives a late forecast when "no historical profile existed yet for the player", while SEN-19 says a profile exists as soon as one event of the type concerns him; when the late forecast is computed is not said either.
- **Ruling:**
  - A case gets a late forecast only if, at its measured game's scheduled start, it had no forecast and the pair's historical data was not yet available: for a researched type, no imported research result covered the type for the player (BKT-10); for a calendar-derived type, the derivation over the covered seasons had not yet run for the player; for either kind, the pair had historical cases but none was measured yet.
  - It is computed by SUI-08 at the first moment after that start when the missing data has arrived and none of the pair's historical cases still awaits its statistics; it is frozen then and marked « tardif ».
  - If that computation gives a forecast (possible or probable), the case moves to the late-forecast part of its rows (SUI-25); if it gives none, the case stays « sans pronostic » in the testing set and is not marked late.
  - A pair whose data was available at the start and gave no forecast (inconclusive, or nothing found) stays « sans pronostic ».
- **Why:** the glossary of file 00 defines the late forecast by a missing backtest or historical cases not yet measured; waiting until all of them are measured avoids freezing a forecast on a partial import.
- **Owner review:** yes

### CL-SUI-06 — Co-occurring cases in several rows

- **Affects:** SUI-23, SUI-24, SEN-06
- **Problem:** a game that measures events of two types gives two cases (SEN-06); each appears once in its type's row, but the player's row and the overall row then hold the same game twice.
- **Ruling:** rows count cases, not games: a co-occurring case counts once in its type's row, its player's row, its pair's row and the overall row, so a game measured for two types counts twice in the player and overall rows. Each such case is marked « concomitant » and each row shows how many of its cases are co-occurring. When SEN-06's parameter treats co-occurring cases as doubtful, they leave the testing set like any doubtful case.
- **Why:** each case tests a different forecast, which cannot be merged; the count keeps the overlap visible.
- **Owner review:** yes

### CL-SUI-07 — The "2 times the expected noise" of the assessment

- **Affects:** SUI-27, SEN-23, « Données manipulées » of file 10; ADR 0021
- **Problem:** it is unclear whether the factor 2 is fixed or follows file 08's « possible » signal-to-noise threshold, which ADR 0021 makes editable.
- **Ruling:** the factor is the current value of file 08's « possible » signal-to-noise threshold (default 2); changing that parameter also changes the assessment and counts as a change of a calculation parameter for the table's date (CL-SUI-04). The « possible » mean-gap threshold (0.25) plays no part in the assessment.
- **Why:** file 10 says the threshold « reprend celui du verdict « possible » du document 08 »: one yardstick for profiles and for their test.
- **Owner review:** no

### CL-SUI-08 — Assessment of the late-forecast part

- **Affects:** SUI-25, SUI-26, SUI-27
- **Problem:** SUI-25 gives late-forecast cases "their own assessment" without saying whether the minimum of 10 cases applies.
- **Ruling:** the same minimum (SUI-26, same parameter) and the same rules (SUI-27) apply; below it the part shows « trop peu de cas suivis pour conclure (k sur 10) ».
- **Why:** an assessment on fewer cases would claim more than the main rows may.
- **Owner review:** no

### CL-SUI-09 — One result message per case

- **Affects:** SUI-19, SUI-20, SUI-21, TEL-13, TEL-17
- **Problem:** SUI-20 communicates an indicative result while the case still waits, and SUI-19 a result when it leaves « en attente du match »; whether the second sends a new message is not said.
- **Ruling:** file 10 transmits both, but file 11 sends one tracked-game result message per case in its life: the indicative one when SUI-20 applies first, otherwise the one sent when the case leaves « en attente du match ». A final measurement after an indicative message updates the case in the app and its sheet's outcome (CL-ALE-12), with no message (TEL-17).
- **Why:** SUI-20 says the final measurement « le met à jour dans l'application », and TEL-17 notifies a fact once.
- **Owner review:** no

### CL-SUI-10 — Showing the post-tip-off decisions

- **Affects:** SUI-17, SUI-25, CA-SUI-13, CA-SUI-14
- **Problem:** decisions are recorded with three effects — exit, entry, change of measured game — but rows only separate exits from entries, and one case can be touched several times.
- **Ruling:** each row shows three counts of touched cases, each with its mean gap in the forecast direction over those that have both a measured gap and a forecast: cases now out of the counts (exits); cases now in the counts whose latest decision was an entry (entries); cases now in the counts whose latest decision changed the measured game. A case appears once, by its present situation and latest decision; its full list of decisions stays on the case.
- **Why:** the owner sees where each touched case now stands, which is what SUI-17 must keep visible.
- **Owner review:** no

### CL-SUI-11 — Rows of withdrawn players and withdrawn types

- **Affects:** SUI-23, SEN-19, JOU-19, JOU-24, TAX-31
- **Problem:** the table has a row per validated type and per player, but says nothing of types and players withdrawn after some of their cases were tracked.
- **Ruling:** a type or player in state « retiré » keeps its rows, with its pair rows, in a separate archived part of the table labeled « archivé » (SEN-19); its tracked cases also stay in the overall row and in every other row they belong to. A player whose data is deleted (JOU-24) loses his cases as in a withdrawal (SUI-30). Rows exist for every validated or archived type and every active or paused player, with zero cases if need be, and for every pair with at least one tracked case.
- **Why:** withdrawing a type or a player after seeing results must not change the table's figures (D-35, H-01), while SEN-19 already archives their profiles.
- **Owner review:** yes

### CL-SUI-12 — Reference instant of the expected game

- **Affects:** SUI-03, SUI-06, ALE-15, DET-30, SEN-01, SEN-03
- **Problem:** SUI-03 starts from the event's reference instant, which COL-21 and DET-30 set for a detected event, while file 08 deems a date-only event public at the end of the day Pacific time (SEN-01); the expected and measured games could come from different instants.
- **Ruling:** a detected event's expected game is computed from its reference date as file 04 records it (DET-30, CL-COL-02), never re-derived with SEN-01; a calendar-derived event's expected game is its derived game (CL-SUI-14). See "Ruled elsewhere" for the matching reading of SEN-01.
- **Why:** one instant per event keeps ALE-15's promise that the expected game is the measured game unless the player is absent.
- **Owner review:** no

### CL-SUI-13 — Scheduled start and tip-off are one instant

- **Affects:** SUI-06, SUI-09, SUI-16, SUI-17, STA-31
- **Problem:** SUI-06 and SUI-09 say « instant prévu de début », SUI-16 and SUI-17 « coup d'envoi ».
- **Ruling:** every comparison uses one instant, the game's last known scheduled start (STA-31); the actual start is never recorded nor used.
- **Why:** the source gives scheduled times, and one instant keeps the rules consistent.
- **Owner review:** no

### CL-SUI-14 — Upcoming calendar-derived events in Lot 2

- **Affects:** SUI-01, SUI-03, SUI-05, SUI-06, SUI-08 to SUI-10, SUI-17, SUI-18, SUI-23, VUE-10; open points 1 and 2 of ADR 0015
- **Problem:** SUI-05 knows two origins of a case, research and detection; ADR 0015 adds events derived from the calendar (a birthday game, a first game against a former team) and leaves open whether an upcoming one becomes a tracked case, when it is created, how it follows schedule changes and how it appears in the table.
- **Ruling:**
  - Creation: in every collection-and-detection pass and at the end of every statistics update, for each active or paused player and each validated calendar-derived type, the app derives the qualifying official games of the player's team (his team on each game's date) played since the previous derivation run, and his next game (STA-26) if it qualifies, when they have no event yet. The withdrawal fingerprints are checked first, as in CL-DET-21. The derivation that validating, reactivating or changing a type starts (ADR 0015) covers games already started only, so an upcoming event always comes from one of these scheduled runs.
  - Origin of the case: an event derived before its game's scheduled start gives a tracked case, created « en attente du match » and therefore always « enregistré à temps »; one derived at or after that start gives a historical case, which builds profiles and never tests (SUI-05).
  - Expected and measured game: the derived game itself. SUI-18's move to the next game does not apply; a player who does not play it makes the case « non mesurable » (ADR 0015).
  - Changes before the game: every derivation run re-checks the upcoming calendar events. One whose game no longer qualifies — date or opponent changed, game cancelled, player no longer with that team, birthday or team history corrected, type no longer validated — is deleted with its tracked case before the scheduled start and never counts; its sheet follows CL-ALE-13 and its message CL-TEL-21. A game that still qualifies after a change of time stays the event's game.
  - Forecast: SUI-08 to SUI-10 as for any tracked case, from the derived historical cases and the type's historical trend (CL-SUI-05 for a late forecast).
  - Routing: no backtest request (ADR 0015); an alert sheet as CL-ALE-13 says; a tracked-game result as CL-TEL-21 says.
  - Table: these tracked cases enter the testing set and every row like any tracked case. They cannot be dismissed, not being detected events, and their type, player and date are not editable (ADR 0015); the other post-tip-off decisions of SUI-17 can touch them.
- **Why:** this is ADR 0015's recommended handling — tracked when created before kick-off, historical otherwise, created when the game becomes the next game; a derivation that never looks at results adds no selection, so a late-derived event can safely build profiles.
- **Owner review:** yes

### CL-SUI-15 — Counts expected from chance

- **Affects:** SUI-22, SUI-24, SEN-39
- **Problem:** SUI-24 shows "what chance alone would give" next to the counts, but SUI-22 gives only "about 40 % each and 20 % neutral" for the default threshold, which the owner can change.
- **Ruling:** with no effect, a gap in the forecast direction behaves as a standard normal value. For n cases with a forecast and a category threshold t, chance gives n × (1 − Φ(t)) confirmed, as many refuted, and n × (2Φ(t) − 1) neutral, Φ being the standard normal distribution function; at t = 0.25 that is 40.1 %, 40.1 % and 19.7 %. Values are shown with one decimal, as counts below 20 cases (SEN-39).
- **Why:** this gives the spec's 40/40/20 at the default and stays right when t changes, as SEN-41 does for verdicts.
- **Owner review:** no

## Passed to the glossary

- « pronostic », « pronostic figé », « pronostic tardif », « sans pronostic »: the English word must carry no betting sense (ALE-18, TEL-05); the register and ADR 0015 already use both "forecast" and "prognosis".
- Case categories « confirmé », « démenti », « neutre », « sans pronostic » and row assessments « confirmé », « confirmé, effet plus faible qu'annoncé », « démenti », « indécis »: same French words, two lists to keep apart.
- « enregistré à temps », « enregistré après le coup d'envoi », « concomitant », « archivé », « trop peu de cas suivis pour conclure (k sur 10) »; the three reading rules of SUI-28; the labels of the three post-tip-off counts (CL-SUI-10).
- « coup d'envoi »: "tip-off" in these rulings, "kick-off" in the register and ADR 0015.

## Ruled elsewhere

- File 08, SEN-01: recommendation — the end-of-day Pacific rule applies only to events whose public date has no time (imported historical events); a detected event always carries the instant DET-30 records, which SEN-03 uses as is, so its measured game and its expected game come from the same instant.
- File 13, open point 6 of ADR 0015 (a withdrawn calendar-derived event recreated once its fingerprint expires): CL-SUI-14 derives only the games since the previous run plus the next game, so only a full re-derivation (type validated, reactivated or substantively changed) can recreate it; recommendation — accept that, keep no other memory of the withdrawal, and say so among the limits the withdrawal screen states for a calendar-derived event (DSN-28).
