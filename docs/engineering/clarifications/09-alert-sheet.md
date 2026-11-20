# Clarifications — 09 Alert sheet

Rulings on the unclear points of the French spec `docs/09-fiche-d-alerte.md`, numbered `CL-ALE-nn`.
The decision records (`docs/adr/`, listed in `docs/engineering/spec-deviations.md`) and these rulings override the spec text where they say so; the French spec is authoritative everywhere else, and `docs/engineering/glossary.md` fixes every English term used here.

## CL-ALE-01 — Identifiers of the acceptance criteria

- **Affects:** acceptance criteria 1 to 22 of file 09
- **Problem:** the criteria are numbered without IDs, unlike files 03, 04 and 14.
- **Ruling:** As written in the coordinator's planning ruling on acceptance-criterion IDs: they are `CA-ALE-01` to `CA-ALE-22`, in document order; the register's `09 AC-n` cites the same criteria.
- **Why:** one citation scheme for every file.
- **Owner review:** no

## CL-ALE-02 — Expected game of an event dated by a date-only article

- **Affects:** ALE-15, edge case « Article daté du jour, sans heure », CA-ALE-21, DET-30, COL-22
- **Problem:** the edge case and CA-ALE-21 say an article dated today without a time makes tonight's game give way to the next one, but under COL-22 the retained instant never passes the first collection, so an article read before tonight's tip-off was surely public before it.
- **Ruling:** the expected game is the first official game of the player's team whose scheduled start is strictly after the event's reference date (DET-30, as COL-21 and COL-22 set it, CL-COL-02). An article dated today without a time and first collected before tonight's tip-off therefore has tonight's game as its expected game. The sheet shows the next game, with ALE-15's explanation, only when the reference date falls after tonight's tip-off, for instance when the article was first collected after it; CA-ALE-21 is tested that way.
- **Why:** COL-22 is a requirement and the edge case an example; the first collection proves the article was public, and H-02 measures the first game after the event became public.
- **Owner review:** yes

## CL-ALE-03 — The direction-of-effect caveat

- **Affects:** ALE-10, ALE-16, ALE-18, H-04, the example sheet
- **Problem:** ALE-16 words the caveat differently by direction — a tendency for a decrease (« le joueur a tendance à jouer moins bien… »), the possible opposite effect for an increase — while ALE-10 and H-04 require equal treatment, the example uses a third wording, and a stated tendency reads close to the forecasts ALE-18 forbids.
- **Ruling:** the caveat takes one of two forms. For a profile with a direction (possible or probable, increase or decrease), it says that an opposite effect remains possible and would be measured and counted the same way, in the same sentence for both directions (the example's « un effet inverse reste possible ; il serait mesuré et compté au même titre »). Below the threshold or for an inconclusive profile, it says that the effect, if any, can go either way. The direction itself is written in the sensitivity block (ALE-10). The exact English sentences come from the glossary.
- **Why:** H-04 and ALE-10 require a decrease to be treated like an increase, and a reminder about the opposite effect carries no forecast.
- **Owner review:** yes

## CL-ALE-04 — The « tardive » mark against a game known only afterwards

- **Affects:** ALE-05, ALE-06, ALE-24, ALE-29, TEL-11, TEL-21
- **Problem:** ALE-24 decides lateness against the measured game, which is only established after the game; at production only the expected game is known.
- **Ruling:**
  - A sheet's timing instant is its production instant or, for a sheet produced while its profile was being computed (ALE-05), the instant the profile values entered it, at the game-tracking run that follows the recalculation (CL-TRV-08).
  - Until the measured game is established, the sheet is « tardive » when its timing instant is at or after the expected game's scheduled start; with no expected game known it is not.
  - Once file 08 establishes the measured game, the mark is recomputed against that game's scheduled start and keeps that value. Every change of the mark is a dated entry of the update journal, except its recomputation when an erasure initializes the sheet again (CL-ALE-16), which writes none: that entry would date the withdrawal (ALE-30).
  - The Telegram alert carries the mark as computed when it is sent, and urgency (TEL-21) uses that value; a later change sends no message.
- **Why:** this mirrors the confirm-or-lift rule DET-33 gives the event's mark; a player who misses the expected game can still have a measured game after the sheet was produced.
- **Owner review:** no

## CL-ALE-05 — Small-sample caveat for a general trend

- **Affects:** ALE-12, ALE-14, ALE-16, SEN-23, SEN-25, SEN-29
- **Problem:** the caveat applies when "the applicable measure rests on fewer cases than file 08's applicable threshold", but file 08 has a case threshold and, for trends, a minimum number of players.
- **Ruling:** for the player's profile: fewer valid cases than SEN-23's case threshold (default 5) or profile confidence « faible ». For the general trend, when it is the applicable measure (player below the threshold, type not covered): fewer valid cases than that same threshold, fewer distinct players than SEN-29's minimum (default 3), or confidence « faible ».
- **Why:** SEN-29 makes a trend's verdict follow SEN-23 plus the player minimum; those are the thresholds file 08 applies to a trend.
- **Owner review:** no

## CL-ALE-06 — A closed sheet whose events are all dismissed

- **Affects:** ALE-22, ALE-26, ALE-27, ALE-28, ALE-29, SUI-17
- **Problem:** ALE-26 defines « annulée » as all events dismissed or reassigned, with no time limit; whether a closed sheet can become canceled, and what then happens to its outcome, is not said.
- **Ruling:** the state always follows ALE-26: a closed sheet whose last non-dismissed event is dismissed becomes « annulée », and reinstatement brings it back to « close » (ALE-22). Its outcome block stays visible and unchanged, the update journal records the dismissal with its date, and no message is sent. How the case then counts follows SUI-17 (CL-DET-09).
- **Why:** ALE-26's states are definitions; ALE-28 forbids rewriting the outcome, not changing the state.
- **Owner review:** no

## CL-ALE-07 — What a sheet freezes and what it updates

- **Affects:** ALE-19, ALE-20, ALE-21, ALE-22, ALE-23, ALE-25, ALE-27, ALE-28, ALE-30, ALE-31, DET-47
- **Problem:** ALE-28 says no sheet is rewritten, while caveats, the expected game and sections change; the frozen parts are never listed.
- **Ruling:**
  - Frozen once entered: the profile and trend snapshots of each section, the header's summary sentence as issued, and each event block as issued, apart from the additions below.
  - Updated, each change being a dated entry of the update journal: state and « tardive » mark; new sources appended, with the reference date and the lead time recomputed (ALE-21); an event's state and dismissal data (ALE-22); the expected-game block, superseded games struck through (ALE-23); the caveats, recomputed whenever one of their inputs changes before the expected game's scheduled start (context correction, new event, expected-game change) and frozen from then on, except once more after a withdrawal (ALE-30), an erasure by requalification or split (CL-TAX-09) or a merge of two detected events (DET-47), except the caveats that a section added after the freeze brings — those that apply to it and to its event, effect direction for its type and « plusieurs événements » included, added with it under a `caveats_changed` entry and with no message of their own, the caveats frozen before staying unchanged (ALE-16, ALE-19, ALE-20, D-35) —, and except the « fiche tardive » caveat, which follows the « tardive » mark at every instant, since ALE-16 hides no caveat that applies: whenever the mark is computed or changes — at production, when awaited profile values enter (CL-TEL-13), when the measured game is established, when the expected game changes, and at a re-initialization (CL-ALE-16) — that caveat is written or removed with it, with the entries such a change writes before the freeze, after the freeze too, and none at a re-initialization, and an alert whose text is built after such a change shows it; the « profil modifié depuis l'émission » flag (ALE-19), set by the game-tracking run that follows a recalculation (CL-TRV-08); dated sections (ALE-20, ALE-31); the outcome (CL-ALE-12).
  - Erased: only what ALE-30 erases after a withdrawal, the caveats being recomputed then, and the expected-game block too, from the remaining events, in the withdrawal's transaction, with no update entry and no message (ALE-30, ALE-15; CL-ALE-16). Re-derived, with no entry: the production of a sheet that the erasure of the event it was produced for, or of its initial section, leaves with other events — production instant, team at production, « tardive » mark with its caveat, header's summary sentence and expected-game block — which CL-ALE-16 initializes again from its earliest remaining event.
- **Why:** the sheet must keep what the app showed before the game (ALE-19, D-35) while recording the dated changes file 09 lists.
- **Owner review:** no

## CL-ALE-08 — Sheet values and the frozen forecast differ on purpose

- **Affects:** ALE-09, ALE-19, ALE-27, SUI-08, SUI-09, SUI-11
- **Problem:** the sheet shows the default view (historical and tracked cases) while the outcome judges the case against a forecast built on historical cases only, so the figures differ (example: +0.83 on 7 cases, forecast +0.95 on 5).
- **Ruling:** As written: ALE-19 says the forecast « peut différer des valeurs de la fiche, qui comptent aussi les cas suivis, et l'issue le montre ». Neither value is aligned on the other; the outcome shows the frozen forecast and its source beside the sheet's values.
- **Why:** SUI-11 forbids judging a profile on the cases that built it.
- **Owner review:** no

## CL-ALE-09 — Sheets of events the owner creates

- **Affects:** ALE-02, DET-13, DET-41, DET-47, DET-49, TEL-18, CA-ALE-17
- **Problem:** a sheet is produced "at the end of the detection pass that recorded the event", but events created by the owner's classification, rescue or detachment belong to no pass.
- **Ruling:** such an event is routed at its creation, and its sheet, when ALE-01 applies, is produced at the end of the owner's action. It is not notified on Telegram, since it follows at once from the owner's action (TEL-18), unless its profile values enter later (as in ALE-05), in which case TEL-11's rule for late values applies (CL-TEL-13).
- **Why:** the owner is in the app and sees the sheet at once; ALE-05's reason for notifying exists only when the values arrive later.
- **Owner review:** no

## CL-ALE-10 — Every source shows its title

- **Affects:** ALE-08, the example sheet
- **Problem:** the example's second source (« un quotidien régional, publié le 17 novembre à 2 h 15 ») has no title, though ALE-08 requires outlet, title, date and time, and link for each source.
- **Ruling:** ALE-08 wins: every source line shows the outlet, the title as published, the publication date and time with their precision, and the link; the example drops the title for brevity only.
- **Why:** a requirement wins over an example.
- **Owner review:** no

## CL-ALE-11 — Gaps in sheet numbers

- **Affects:** ALE-06, ALE-30, DSN-29
- **Problem:** never reassigning an erased sheet's number leaves gaps in the history, a weak trace of a withdrawal.
- **Ruling:** As written: ALE-30 says « Le numéro d'une fiche effacée n'est jamais réattribué ». Numbers come from one sequence in production order; the history lists only existing sheets, with no placeholder or explanation for a missing number.
- **Why:** ALE-30, the specific rule, accepts the gap; reassigning numbers would make those cited in Telegram messages ambiguous.
- **Owner review:** no

## CL-ALE-12 — Values shown in the outcome

- **Affects:** ALE-19, ALE-27, SUI-15, SUI-21
- **Problem:** ALE-27 does not say which view "the profile values after including the case" use, nor whether the outcome follows later changes of a provisional gap or of the category.
- **Ruling:**
  - "Profile values after including the case": the default view (SEN-21) as computed right after the case's measurement entered the profile, frozen at closure; later changes show through « profil modifié depuis l'émission ».
  - Gap, baseline and category: the outcome shows the case's current values from files 08 and 10, marked « provisoire » while they are; each change after closure is a dated entry of the update journal that keeps the earlier value.
- **Why:** the outcome must agree with the validation table, which uses updated values (SUI-21), while the profile snapshot records what this case did to the profile.
- **Owner review:** no

## CL-ALE-13 — Calendar-derived events on an alert sheet

- **Affects:** ALE-01, ALE-03, ALE-08, ALE-14, ALE-15, ALE-16, ALE-21, ALE-26; open point 1 of ADR 0015
- **Problem:** ADR 0015 leaves open whether an upcoming calendar-derived event (a birthday game, a first game against a former team) gets an alert sheet, and the sheet's event block assumes press sources, a publication instant and a detection confidence.
- **Ruling:**
  - An upcoming calendar-derived event that becomes a tracked case (CL-SUI-14) gets a sheet when the player is active and the type validated, whether or not the player is profiled, since these profiles rest on statistics, not on research; a paused or withdrawn player gets none (ALE-01).
  - It joins the sheet of the same player whose expected game is the same (ALE-03); its expected game is the derived game.
  - Its event block shows the type with its link, the description written by the app (ADR 0015), and "derived from the calendar" with the derived game (date, time, opponent) in place of sources, publication instant and lead time; it has no detection confidence and no dating mark; context indications are shown with their origin.
  - Caveats: the detection-confidence and dating caveats never apply, nor « type non couvert par le backtest » (ADR 0015); every other caveat applies as for any event, the permanent confounder warning of ADR 0016 included.
  - If the event is dropped before tip-off (CL-TAX-19, CL-SUI-14), the update journal records it and the sheet becomes « annulée », with the reason "event no longer applies", when no other non-dismissed event remains, as ALE-31 does for a corrected attachment.
- **Why:** this is ADR 0015's recommended handling, "an alert sheet, with no backtest condition", read with the exclusions of ALE-01.
- **Owner review:** yes

## CL-ALE-14 — A new event for the game of a canceled sheet

- **Affects:** ALE-03, ALE-20, ALE-22, ALE-26, TEL-11, TEL-12, TEL-17
- **Problem:** ALE-03 gathers the events of one player and one expected game on one sheet, but nothing says what happens when that sheet was canceled (its events dismissed) and a new event arrives for the same game.
- **Ruling:** the new event joins the canceled sheet as a dated section (ALE-20), and by ALE-26 the sheet becomes « ouverte » again. The message is an alert update (TEL-12) if the sheet was already notified, otherwise the alert itself (TEL-11).
- **Why:** one sheet per player and game (H-ALE-02), and one fact, one message (TEL-17).
- **Owner review:** no

## CL-ALE-15 — A research result imported after tip-off

- **Affects:** ALE-05, ALE-24, SUI-10, 00 « Variantes » (Joueur sans backtest)
- **Problem:** ALE-05 produces the sheet of a waiting detected event when a research result is imported before its game starts, but the measured game is known only once played, and file 00 restates the rule.
- **Ruling:** As written: ALE-05 says « Si le coup d'envoi est déjà passé au moment de l'import, aucune fiche n'est produite ; l'événement reste un cas suivi ». The tip-off compared with the import is the scheduled start of the event's expected game as known at that moment (SUI-03, SUI-18), the measured game being established only once played (CL-ALE-04): an import saved before it produces the sheet; an import saved at or after it produces none, and the tracked case keeps the forecast rules of file 10, a late forecast included (SUI-10, CL-SUI-05).
- **Why:** ALE-05 settles it; the expected game is the only game known at the import.
- **Owner review:** no

## CL-ALE-16 — A sheet after the withdrawal of one of its events

- **Affects:** ALE-05, ALE-06, ALE-07, ALE-15, ALE-19, ALE-20, ALE-22, ALE-23, ALE-24, ALE-26, ALE-27, ALE-28, ALE-30, ALE-31, DSN-27, DSN-29; CL-ALE-02, CL-ALE-04, CL-ALE-06, CL-ALE-07, CL-SEN-18, CL-TEL-09 (file 08 and 11 rulings)
- **Problem:** ALE-30 erases a sheet whose only event is withdrawn, or else the event's section and every mention of it, but a correction (ALE-31) or a merge (DET-47) can leave a sheet, or a section, with no event at all while it exists only because of the corrected or absorbed event; and ALE-30 does not say which state a sheet takes when the withdrawal leaves it only dismissed events, or only cases already measured, while nothing may record the withdrawal.
- **Ruling:**
  - What a correction or a merge left behind belongs to the event that left: a sheet, or a section, left with no event when a player or type correction moved an event to another sheet or section, or when a merge absorbed it into another event, is erased with that event — the corrected event, or the kept event of the merge — at its withdrawal or its erasure by requalification or split (ALE-30, DSN-27): a sheet left with no event after that goes whole, with its alert-history entry, its number never reused, when it was produced for that event or has no section left, and otherwise stays, as the canceled sheet of the other events that left it. Whenever an erasure deletes a section of a sheet that stays, the entries about another event that a correction or a merge took off that section stay, with no section, since ALE-31 keeps a correction in the sheet's update journal.
  - A sheet that keeps events takes, at once, the state ALE-26 gives its remaining events, as if the withdrawn event had never been on it: « annulée » with the reason "all events dismissed" when every remaining event is dismissed; « close » when every remaining non-dismissed event's case is measured, excluded or not measurable, its outcomes recorded as at any closure (ALE-27); « ouverte » otherwise. At a withdrawal, the alerts eraser also deletes the expected games that the withdrawn event's moved reference date gave, with the changes that recorded them, a message whose fact is such a change going like a message about that event (CL-TEL-09), then recomputes the sheet's expected-game block from its remaining events, in the withdrawal's transaction (ALE-30, ALE-15).
  - These changes write no update entry — no `status_changed`, no expected-game change — and send no message, since no entry and no message records a withdrawal (ALE-30); the outcomes a closure records name only remaining events.
  - When an erasure takes from a sheet that keeps other events the event the sheet was produced for — that event itself, or the initial section a correction or a merge of that event left behind (first item), even one that other events still hold or have joined since, the sheet's production still belonging to that event —, or leaves it with no initial section, the sheet is initialized again from its earliest remaining event, wherever that event sits: in the initial section, as a later event of the same type (ALE-20), or in another section. The section that holds it becomes the initial one; a former initial section that keeps other events becomes a dated section, dated when its earliest remaining event joined the sheet, as ALE-20 dates the section of a later event, and one that holds no event, kept until then under another event's mark, is deleted.
    - The production instant is the instant that event joined the sheet; a type correction that moved it within the sheet keeps the instant it first joined it. For the section that becomes the initial one, three cases: when it was waiting for its profile values at the production instant (ALE-05) and they have entered since, they count as entered at the instant they entered; when it was waiting for them then and still is, they count as entered when they enter, and the late mark is computed again then (CL-TEL-13); otherwise they count as there at production, which includes a section that a correction added after the production instant (a type change), since its values come from the correction, not from the wait of ALE-05. The timing instant is thus never earlier than the production instant. The team at production is the player's team at the production instant (ALE-07); the late mark is computed for the timing instant of CL-ALE-04, the instant the values entered in the first case and the production instant otherwise (ALE-24, CL-ALE-04); the header's summary sentence (ALE-07) is read from that section.
    - The alert: in the second case, when that section still waits for its profile values, the sheet's `alert_sheet_produced` fact, consumed or not, is deleted with the erasure; when the values enter, it is emitted again and the alert is composed then, late if it is (CL-TEL-13). In the other two cases the fact stays and no message follows. An alert composed but not yet sent when the event is withdrawn is discarded as moot and not replaced: the withdrawal is the owner's own action (TEL-18), and the sheet as it now stands is in the application.
    - The expected-game entries and the update entries recorded up to the production instant, the entry of that event's joining included, are deleted, except the expected-game entry live at that instant, which becomes the first one, recorded at that instant, the passed game that ALE-15's explanation names being set again from that event's reference date (CL-ALE-02), and except the entries about another event that a correction or a merge took off the sheet before that instant, which stay, since ALE-31 keeps a correction in the sheet's update journal — with no section when the erasure deletes the section they name (first item) —, and the entry of a calendar-derived event dropped before that instant, which stays as a correction's entries do, its message not deleted from Telegram. A message whose fact is a deleted entry is a trace of the sheet's production for the withdrawn event, and goes like a message about that event (CL-TEL-09).
    - No update entry records the re-initialization, since it would be a trace of the withdrawn event (CL-ALE-04, CL-ALE-07). After any erasure, a sheet that keeps events has exactly one initial section.
  - Accepted residual limits, as for the verdict history (CL-SEN-18): a state that changed with no entry, or a closure on a day when no case of the sheet changed, can let a reader guess that something left the sheet that day; the sheet's number, never reused (ALE-06), keeps the production order of the withdrawn event's sheet; the profile and trend snapshots frozen in the sheet's sections, the new initial one included, whose snapshot, frozen when that section was added, may predate the new production instant and gives the header its sentence, and on the pair's or the type's other sheets, keep the values in force before the withdrawal, since no sheet is rewritten (ALE-19, ALE-28); a section the sheet keeps from before its new production instant also keeps its « profil modifié depuis l'émission » flag, whose dated entry may have gone with the others; the correction of another event that took it off the sheet before that instant keeps its entries, and the section it left unless the erasure deletes that section, dated before the sheet's new production instant, and one that took it off since keeps the section it left when that section is dated before that instant and the erasure does not delete it, but not that event's entries up to it; and the entry of a calendar-derived event dropped before that instant stays, as a correction's entries do. Beyond these, the sheet keeps from before that instant only its number.
- **Why:** ALE-30 and DSN-29 leave nothing that designates the withdrawn event, and a sheet or section that exists only for it designates it, as do a production instant, a team, a late mark and an expected-game history taken from it; ALE-26 sets a sheet's state from its events at all times.
- **Owner review:** yes — a sheet emptied by a correction or a merge goes with the event that left it when it was produced for that event or has no section left, and otherwise stays as the canceled sheet of its other events; a sheet's state follows its remaining events at a withdrawal without an update entry, which can let a reader guess that something left it that day; a sheet that loses the event it was produced for, or its initial section, is initialized again from its earliest remaining event — production instant, team, late mark, header and expected-game block — with no update entry, a former initial section that keeps events becoming a dated section, and keeps from before its new production instant only its number, its sections' snapshots and flags, and the corrections of other events that ALE-31 records, a calendar-derived event's drop included; such a sheet whose new initial section still waits for its profile values gets its alert when they enter, late if it is, while otherwise no message follows, an alert not yet sent being discarded and not replaced; a sheet's expected-game block follows its remaining events at a withdrawal; frozen snapshots keep the values in force before the withdrawal.

## Passed to the glossary

- The fixed sentences of ALE-10, ALE-12, ALE-13, ALE-16, ALE-17 and ALE-24, and the two forms of the direction caveat (CL-ALE-03).
- Labels « profil modifié depuis l'émission », « profil en cours de calcul », « recalcul en cours », « match attendu inconnu », « aucun cas mesuré pour ce type à ce jour », « type non couvert par le backtest », « rattachement corrigé », « événement écarté », « indicatif », « tardive », « produite avant le coup d'envoi ».
- The new cancellation reason "event no longer applies" and the "derived from the calendar" line (CL-ALE-13).

## Ruled elsewhere

- File 14, TRV-71 and TRV-72 (the US date of ALE-15, games played outside the US): ruled by CL-TRV-03 — a game's US date is the calendar date of its scheduled start in US Eastern time (`America/New_York`), the date the league itself uses — and shown as CL-TRV-02 and CL-IHM-07 say.
- File 08, SEN-01: ruled by CL-SEN-02 — the measured game of a detected event uses the reference date DET-30 records (CL-COL-02, CL-SUI-12), so the expected game of ALE-15 is its measured game unless the player is absent.
