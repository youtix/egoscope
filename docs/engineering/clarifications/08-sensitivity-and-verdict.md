# Clarifications — 08 Sensitivity and verdict

Rulings on the unclear points of the French spec `docs/08-sensibilite-et-verdict.md`.
The decision records (`docs/adr/`, `docs/engineering/spec-deviations.md`) and these rulings override the spec text where they say so; the French spec is authoritative everywhere else.

### CL-SEN-01 — Acceptance-criterion IDs and what each verifies

- **Affects:** the 22 acceptance criteria of 08
- **Problem:** the criteria are unnumbered bullets with no requirement IDs.
- **Ruling:** As decided (decisions, "Acceptance-criterion IDs"): `CA-SEN-01` to `CA-SEN-22` in document order (cited `08 AC-nn` in the deviations register). Each test names its ID and these requirements: 01 SEN-01; 02 SEN-03; 03 SEN-03, SEN-13; 04 SEN-04; 05 SEN-03, SEN-12; 06 SEN-05, SEN-06; 07 SEN-08; 08 SEN-14; 09 SEN-15; 10 SEN-17; 11 SEN-20, SEN-22 to SEN-26; 12 SEN-24; 13 SEN-31; 14 SEN-25; 15 SEN-29; 16 SEN-27; 17 SEN-32; 18 SEN-34, SEN-37; 19 SEN-41; 20 SEN-39; 21 SEN-09, SEN-34, SEN-37; 22 SEN-21.
- **Why:** one citation scheme; the mapping follows each criterion's content.
- **Owner review:** no

### CL-SEN-02 — The reference instant of each kind of event

- **Affects:** SEN-01, SEN-02, SEN-03, SEN-05, SEN-44, DET-30, DET-48, COL-21, COL-22, SUI-03, ALE-15, TRV-73, CA-SEN-01, CA-SEN-02; CL-COL-02, CL-DET-26, CL-SUI-12, CL-ALE-02 (file 03, 04, 09 and 10 rulings)
- **Problem:** for an event known only by its date, SEN-01 takes the end of that day in Pacific time, while articles collected in lot 2 already carry the cautious instant of COL-21, which docs 09 and 10 use for the expected game.
- **Ruling:** The measured game is searched from this instant, and from no other:
  - historical event whose public date has a time: that instant (CL-IMP-08);
  - historical event whose public date is a date D only, as written: the end of D in America/Los_Angeles, that is 00:00 Los Angeles time on D + 1 (SEN-01). This is the only use of SEN-01's rule;
  - detected event (lot 2): its reference date as DET-30 records it — the earliest retained instant of its articles — used as it is. For an article dated without a time, that instant is 23:59:59.999 of that date in the outlet's declared time zone, or at UTC−12 when none is declared; for a time without a zone, that wall time in the outlet's zone, or at UTC−12; in both cases never later than the article's first collection (COL-22, CL-COL-02). A source the owner adds (DET-48) is dated the same way (CL-DET-26). SEN-01 is never applied on top, so the expected game (SUI-03, ALE-15; CL-SUI-12, CL-ALE-02) and the measured game start from the same instant and are the same game unless the player misses it;
  - historical event with uncertain precedence: the shifted instant of CL-SEN-07;
  - calendar-derived event: no instant is searched from; its reference is its game's date, before tip-off, and that game is both its expected and its measured game, with no sliding (CL-SEN-03, CL-SUI-14);
  - event of a type known in advance that is not calendar-derived: CL-SEN-04.
  - "Strictly after" means a scheduled start (CL-SEN-23) later than the reference instant; every comparison is between instants (TRV-69).
- **Why:** file 08 owns the measured game. Keeping each owner's cautious instant makes files 08, 09 and 10 agree on detected events, as the rulings on files 03, 09 and 10 recommend, and SEN-01 keeps its role for the research AI's undated public dates.
- **Owner review:** yes — a detected article without a time is dated at the end of its day in the outlet's zone or at UTC−12, or at its first collection if that is earlier, which can be earlier or later than SEN-01's end of day in Pacific time.

### CL-SEN-03 — Calendar-derived events in the calculation

- **Affects:** SEN-02, SEN-03, SEN-04, SEN-06, SEN-07, SEN-13, SEN-14, SEN-43, SEN-44, SEN-45, SEN-46, Q-SEN-04, register rows SEN-02, SEN-03, SEN-04, SEN-07 and SEN-46
- **Problem:** ADR 0015 measures birthday and former-team events on their own game and makes the case not measurable when the player misses it; the rest of 08 must follow.
- **Ruling:**
  - The measured game is the derived game, which is also the event's expected game (CL-SUI-14). If the player's participation in it is unknown, the case waits ("statistics pending") and becomes not measurable, "box score unavailable", once the sheet is unavailable (CL-STA-04). If he did not play it, the case is not measurable with its own reason, "did not play the derived game" (glossary). If he played it, steps 8 to 10 of CL-SEN-05 follow.
  - No skipping (SEN-03), no window (SEN-04), no precedence check (IMP-18, SEN-44), no "dating to verify" (SEN-45).
  - The case's reference is the game's date, with the provenance "known in advance". The case is tracked or historical as CL-VUE-13 rules: tracked when the event was created before the game's scheduled start, historical otherwise.
  - Context indications start "unknown" (ADR 0015), so only the calculated conditions of SEN-13 and SEN-14 apply until the owner sets them.
  - These events are never withdrawn; the owner excludes their cases instead (SEN-17, CL-DSN-09).
  - SEN-43 does not count these cases. The coverage warnings of SEN-46 never show for these types; their profile warnings are "birthday not recorded" (CL-JOU-16) and the team-history mention of CL-JOU-18, as CL-STA-24 places them.
  - Co-occurrence (SEN-06) applies: a derived event and an event of another type on the same game each give a co-occurring case.
- **Why:** ADR 0015 and its register rows, applied to every rule of 08 that the derived game touches.
- **Owner review:** no

### CL-SEN-04 — Types known in advance that are not calendar-derived

- **Affects:** SEN-02, SEN-04, SEN-13, H-SEN-02
- **Problem:** SEN-02 attaches an event known in advance by local dates, while SEN-04's window counts from a reference instant that such an event does not have, and whether skipped games count as absences is not said.
- **Ruling:** As written (register row SEN-02), made computable. E is the event's date: the public date as written for a historical event, the US date of the reference date for a detected one. The candidate games are the player's team games (CL-STA-05) whose venue local date (CL-STA-14) is E or later, in order; games he did not play are skipped and count as absences; the first game he played is the measured game if its venue local date is at most E + 10 days (the SEN-04 parameter, counted in calendar days), otherwise the case is not measurable, "no game played within the window". No seeded type is of this kind.
- **Why:** keeps SEN-02's local dates and gives SEN-04 a date to count from.
- **Owner review:** no

### CL-SEN-05 — The order in which a case gets its state and reason

- **Affects:** SEN-03, SEN-04, SEN-07, SEN-08, SEN-11, SEN-44, SEN-45, SEN-47, STA-19, STA-22, STA-35, STA-45, IMP-18, CA-SEN-01 to CA-SEN-05
- **Problem:** a case has exactly one state and one reason (SEN-07), but several reasons can hold at once, and the spec gives no order.
- **Ruling:** For each event that is not withdrawn and was not dismissed before its expected game's scheduled start, the first rule that applies sets its case's state and reason:
  1. Calendar-derived event: CL-SEN-03, then steps 8 to 10.
  2. The season of the reference instant (STA-48) is not covered (CL-STA-22): not measurable, "season not covered by the source".
  3. Lot 2: the detected event is marked "dating to verify": pending, "dating to verify" (SEN-45).
  4. The player's statistics identity is not confirmed: pending, "stats match not confirmed".
  5. The schedule of the player's teams after the reference instant is not stored: pending, "precedence to verify" for a historical event, "statistics pending" for a detected one.
  6. Attachment (SEN-03, SEN-04): the player's team games (CL-STA-05) are taken in order of scheduled start, from the first one starting strictly after the reference instant:
     - a game starting more than 10 days (parameter; 240 hours) after the reference instant ends the walk: not measurable, "no game played within the window"; with no further game stored, the same once 10 days have passed, and pending, "game not yet played", before;
     - a game not yet final ends the walk: pending, "game not yet played" if its start is still to come, "statistics pending" if it has passed;
     - a game of unknown participation (CL-STA-04) ends the walk: pending, "statistics pending", or not measurable, "box score unavailable", once its sheet is unavailable;
     - a game he did not play is skipped and counts as an absence;
     - the first game he played is the measured game.
  7. Historical event: precedence against that game (CL-IMP-17). « non établie »: not measurable, "precedence not established". « incertaine »: one shift (CL-SEN-07), then step 6 again from the shifted instant. « établie »: go on.
  8. The measured game's sheet is incomplete or suspect: pending, "statistics pending", while the game is in its correction window; then not measurable, "box score incomplete" or "box score suspect".
  9. The baseline of its season and baseline phase, measured game excluded: building gives pending, "baseline being built"; insufficient gives not measurable, "insufficient baseline".
  10. The gap is computed; the doubtful-case criteria (SEN-11 to SEN-16, without a criterion switched off for the type, CL-SEN-13) and the manual decisions (SEN-17) make the case excluded, with every retained criterion and its values, or measured, which is a valid case.
  - Grouping of same-type events (SEN-05) then follows CL-SEN-06. A postponed game with no new date is not a team game until it is rescheduled (CL-STA-17).
  - Dismissed events (lot 2, CL-DET-15): a case whose event was dismissed at or after its expected game's scheduled start keeps being evaluated by these steps, outside every profile, trend, control and verdict, so that file 10 can count it apart (SUI-17); a case whose event was dismissed earlier keeps the state and gap it had (SEN-48) until a reinstatement evaluates it again.
- **Why:** one deterministic order gives every agent the same state for the same data, and each wait keeps the outcome SEN-47 requires.
- **Owner review:** no

### CL-SEN-06 — Cases that share a game

- **Affects:** SEN-04, SEN-05, SEN-06, SEN-32, SEN-44, CA-SEN-06
- **Problem:** same-type events on one game form one case with the earliest reference instant, but the spec does not say whether the window is checked again from that instant, nor what happens to an event that alone would not reach the game.
- **Ruling:** Each event is first attached on its own, its own window, precedence and shift included (CL-SEN-05). Events of the same player and type whose own attachment ends on the same measured game form one case (SEN-05), whose reference instant is the earliest of theirs. An event that ends pending or not measurable without reaching a game stays its own case and joins no group — for example one whose own 10-day window expires, or whose precedence is not established. Grouping never re-checks a window from the earliest instant. Events of different types on the same game give one case per type, each co-occurring (SEN-06), calendar-derived events included. Two followed players in the same game have separate cases.
- **Why:** an event can join a case only if it would have measured that game by itself.
- **Owner review:** no

### CL-SEN-07 — The shift for uncertain precedence

- **Affects:** SEN-44, H-SEN-15, IMP-18, ADR 0022
- **Problem:** SEN-44 deems the same-day source published at "the end of its day, Pacific time" without saying which day, from when the window counts, or whether a second shift can happen.
- **Ruling:** The shifted reference instant is the end, in America/Los_Angeles, of the measured game's US date — the date of its same-day undated source — that is 00:00 Los Angeles time on the next day. Attachment runs again from it, its window counted from it. Precedence is never classified again on the new game, so there is at most one shift (SEN-44, ADR 0022). The case carries the mention "uncertain precedence", and its reference-instant provenance is "shift for uncertain precedence".
- **Why:** SEN-44 and ADR 0022 as written, with the day and the window named.
- **Owner review:** no

### CL-SEN-08 — "No counted case"

- **Affects:** SEN-44, SEN-32, H-IMP-07, H-SEN-15, IMP-18
- **Problem:** a case with precedence « non établie » produces "no counted case" yet "stays in the tally"; one with « à vérifier » is "no counted case" yet a pending case of the tally.
- **Ruling:** "No counted case" means that the case enters no calculation: no verdict, control, general trend, robustness test or confidence. It stays in the tally (SEN-32), as pending or not measurable.
- **Why:** reconciles the two wordings without changing either rule.
- **Owner review:** no

### CL-SEN-09 — Counting absences for the return-from-injury criterion

- **Affects:** SEN-13, H-SEN-05, CA-SEN-03, CL-STA-04, CL-STA-05
- **Problem:** "an absence of at least 4 consecutive games of his team" is not defined across a trade, across seasons, or when a box score is missing.
- **Ruling:** The calculated condition looks only at the player's team games (CL-STA-05) of the measured game's season. A run of absences is a sequence of consecutive team games he missed: not played, or of unknown participation (CL-STA-04). The measured game meets the condition when it is the first or second game he played after a run of at least 4 (both parameters). A run never reaches into the previous season. The criterion's values give the run's length and how many of its games had no box score. A flagged indication "unknown" triggers nothing (as written).
- **Why:** the off-season is a break for every player, not an absence; counting within the season also keeps the result independent of whether the previous season has been fetched.
- **Owner review:** yes — a player who missed the last games of a season and plays the first games of the next one is not excluded for return from injury unless he also missed games of the new season.

### CL-SEN-10 — Opponent level, and stakes that cannot be evaluated

- **Affects:** SEN-14, SEN-15, H-SEN-07, CA-SEN-09, CL-STA-18, CL-STA-19
- **Problem:** SEN-15 does not say which games of the opponent's season count; the statistics-source evaluation speaks of "the opponent's win percentage at the date of the game"; and older playoff series may not allow an elimination game to be identified.
- **Ruling:**
  - Opponent percentage (SEN-15): wins out of the games of the opponent's record (CL-STA-19) for the measured game's season — all its final regular-season games except the measured game, before and after it, as for the baseline; for the current season, those played so far, provisional (as written). It is not the record at the date of the game. With fewer than 10 such games (parameter), its whole regular-season record of the previous season is used; with none, the criterion is not evaluable, not retained, and the case says so (as written). The thresholds are strict: below 25 %, above 75 %. A play-in or playoff measured game uses the same season's whole regular season.
  - Unusual stakes (SEN-14): when the elimination flag of a playoff game is unknown (CL-STA-18), the calculated condition is not evaluable, is not retained, and the case says so, as SEN-15 does; a flagged « fort » still applies, and a play-in game is always retained through its phase.
- **Why:** SEN-15's "measured game excluded" and "provisional, like the baseline" describe a season record, as the baseline is one; SEN-15's own rule for what cannot be evaluated is reused for the stakes.
- **Owner review:** no

### CL-SEN-11 — Review flags: first game with a new team, ejection

- **Affects:** SEN-16, SEN-17, H-SEN-08, Q-JOU-01, « Cas limites » (joueur expulsé), service sheet (ejection unknown)
- **Problem:** the chosen statistics source never reports ejections, so the ejection flag of SEN-16 can never be set; the first-game-with-a-new-team flag needs a definition.
- **Ruling:**
  - First game with a new team: flagged when the measured game is the first game the player played for a team other than the team of his previous game played, whatever the season (CL-STA-05). It is shown on the case and in the to-do list, and excludes nothing (as written).
  - Ejection: flagged only when the source reports one, which the chosen source never does; its adapter returns "unknown", never "no". The app never infers an ejection, for example from minutes or fouls, and never shows "not ejected". The Method and limits page and the help on review flags say that the source does not report ejections, so an ejection in a measured game is flagged only if the owner notices it; the owner can then exclude the case (SEN-17, for example "other confounding factor" with a comment), and a case excluded for playing time can be reinstated with "criterion unsuited to this case" (« Cas limites »). With a source that reports ejections, the flag works as written.
- **Why:** nothing is invented from data the source does not hold; the owner is told where the flag cannot help.
- **Owner review:** yes — with the chosen source, the ejection review flag of SEN-16 never appears.

### CL-SEN-12 — Manual decisions when the measured game changes

- **Affects:** SEN-17, SEN-27, SEN-44, SEN-45, IMP-32, DET-48, « Cas limites » (correction de la date)
- **Problem:** decisions "survive recalculations and parameter changes", but nothing says what happens when the case's measured game changes.
- **Ruling:** A manual decision belongs to the measured game it was made on. When the case's measured game changes — a corrected date, an older source, a dating mark lifted or a reference date advanced (lot 2), a new derivation — the decision stops applying, stays in the case history, and the case gets the review flag "manual decision to review: the measured game changed", shown on the case and in the to-do list (the SEN-16 mechanism). The owner decides again on the new game. A recalculation or a parameter change that keeps the measured game keeps the decision (SEN-17).
- **Why:** a decision about one game's context says nothing about another game.
- **Owner review:** yes — after a correction that changes the measured game, an earlier exclusion or reinstatement stops applying until the owner confirms it again.

### CL-SEN-13 — A criterion switched off for a type

- **Affects:** SEN-11 to SEN-15, SEN-06, SEN-17, SEN-27, SEN-46, « Cas limites » (record négatif), ADR 0016, register rows SEN-11, SEN-46 and Q-SEN-01
- **Problem:** ADR 0016 lets a type sheet switch off one criterion; the label "all cases are excluded for unusual stakes" appears only in an edge case.
- **Ruling:**
  - As decided (ADR 0016): the sheet names at most one of SEN-12, SEN-13, SEN-14 and SEN-15, or SEN-06, which has no effect while SEN-06's own parameter is off. That criterion is not evaluated for the type's cases. The other criteria, manual decisions (their reasons all stay available) and the controls still apply. The permanent warning shows on every profile and on the general trend of the type (wording from the glossary).
  - The label "all cases are excluded for unusual stakes" shows on a profile with at least one excluded case, no valid case, and the unusual-stakes criterion among the retained criteria of every excluded case; never while SEN-14 is switched off for the type.
- **Why:** ADR 0016 as decided; the label gets a testable condition.
- **Owner review:** no

### CL-SEN-14 — The robustness test

- **Affects:** SEN-26, SEN-25, SEN-29, CA-SEN-11
- **Problem:** SEN-26 does not say whether the test runs on a profile below the valid-case threshold, where removing a case while ignoring that threshold could make an inconclusive verdict "fragile", nor how it treats ties and trends.
- **Ruling:** The test runs only when n reaches the valid-case threshold (5 by default). Below it nothing is fragile and no confidence drop for fragility applies. For a possible or probable verdict, one case is removed — the highest gap for an increase, the lowest for a decrease, the first in the fixed order of CL-STA-09 on a tie — and SEN-22 and SEN-23 are recomputed without the case-count threshold; the verdict is fragile if the level or the direction changes. For an inconclusive verdict, the highest gap is removed and the verdict recomputed, then the lowest, each time from the full set; it is fragile if either gives possible or probable. For a general trend, the recomputation also leaves out the 3-player requirement of SEN-29. The retained dispersion is recomputed on the remaining cases, never below 1.
- **Why:** the test measures dependence on a single game; the sample-size gates already apply to the official verdict.
- **Owner review:** no

### CL-SEN-15 — Profiles with fewer than two valid cases

- **Affects:** SEN-20, SEN-22, SEN-25, SEN-31, SEN-38
- **Problem:** the dispersion divides by n − 1, undefined below two cases.
- **Ruling:** With n = 0, no mean, range or ratio is computed: the profile shows its tally and "0 valid cases", the verdict is inconclusive and the confidence low. With n = 1, the mean is that gap, the observed dispersion is undefined and shown as a dash, the retained dispersion is 1 (SEN-22), the noise 1 and the range the mean ± 2; no dispersion drop applies. Below the threshold, SEN-31's display applies.
- **Why:** SEN-22 already fixes the retained dispersion at 1 below two cases.
- **Owner review:** no

### CL-SEN-16 — Recalculation runs as a job; what profiles show meanwhile

- **Affects:** SEN-34, SEN-35, SEN-36, IMP-34, TRV-29, TRV-30
- **Problem:** a recalculation "ends together with the processing that triggered it", yet "during a recalculation, the profiles concerned say so": synchronous or background work is not said.
- **Ruling:**
  - Every change that SEN-34 or SEN-35 lists records a recalculation job in the same transaction as the change, with its scope (SEN-34, items a to d) and its cause (CL-SEN-17). Jobs run one at a time, in the order recorded; jobs with different causes are never merged.
  - The job starts in the same request, right after the commit. If it cannot finish within the request's time budget, it continues in chunks from the external trigger (TRV-30) until done. The operation that caused it — an import save, a manual decision, a parameter save, a statistics update — reports itself complete only when its job has finished; until then its screen says that the recalculation is in progress.
  - Each profile and general trend is written whole, never half updated. While a job covering it is pending or running, it shows "recalculation in progress" next to its last values and their date. Verdict-history entries are written when the job finishes.
  - Results never depend on chunking or timing (SEN-36; order of sums, CL-STA-09). A job requests nothing from the statistics source; statistics an import asks for (IMP-34) arrive through the daily update, which records its own job.
- **Why:** the job cannot be lost, works within the host's time limits, and is visible while it runs.
- **Owner review:** no

### CL-SEN-17 — Causes in the verdict history

- **Affects:** SEN-37, SEN-34, SEN-35, SEN-48, ADR 0016, CA-SEN-18, CA-SEN-21, « Cas limites » (correction de la date)
- **Problem:** the closed list of causes has no value for several triggers of SEN-34 — event corrections, deletions, reinstatements, taxonomy changes — while the edge case on a corrected date requires an entry.
- **Ruling:** Each entry carries exactly one cause, that of its recalculation job. The list is the spec's seven causes plus three:

  | Cause | Triggers |
  | --- | --- |
  | « nouveaux cas » | An import saved, in any mode; a tracked case created or measured (SEN-35, lot 2). |
  | « correction de statistiques » | A statistics update in which a stored statistic used by the profile changed value (STA-33, STA-34). |
  | « référence mise à jour » | Any other statistics update: new games changing a provisional baseline, the end of a phase. |
  | « décision manuelle » | A manual exclusion or reinstatement (SEN-17). |
  | « événement écarté » | A detected event dismissed (SEN-48, lot 2). |
  | « changement de paramètre » | A parameter change; the criterion switch of a type (ADR 0016). |
  | « recalcul » | A recalculation the owner asks for; a withdrawal; the deletion of a player's data (CL-SEN-18). |
  | "event corrected or removed" (new) | A correction of an event (type, date, context, sources, research confidence, reservation; IMP-32, DET-47, DET-48); a dating mark lifted (lot 2); a requalification, reassignment or distribution (TAX-25, TAX-29); a manual deletion (IMP-33); a merge of detected events (DET-47); a derived event no longer derived (CL-SEN-25). |
  | "event reinstated" (new) | A dismissed event reinstated (DET-45, lot 2). |
  | "taxonomy changed" (new) | A type validated, withdrawn, reactivated, merged or split; a substantive change of a calendar-derived sheet that runs its derivation again. |

  - Within a statistics update, a profile's cause is "statistics correction" if one of its statistics changed value, otherwise "new cases" if one of its cases left the pending state or a calendar-derived event was added, otherwise "baseline updated" (`CA-SEN-21`).
- **Why:** every trigger gets one cause, so the history explains each change; the new values reveal nothing about a withdrawal, which keeps « recalcul ».
- **Owner review:** yes — the verdict history shows three causes the spec does not list.

### CL-SEN-18 — Verdict history after a withdrawal

- **Affects:** SEN-37, SEN-48, SEN-33, SEN-19, DSN-29, JOU-24, ADR 0017
- **Problem:** a withdrawal-caused entry has the generic cause « recalcul », but it still names the profile and is dated at the withdrawal, while DSN-29 forbids keeping anything that designates the withdrawn event, even in reduced form.
- **Ruling:**
  - A withdrawal, and the deletion of a player's data (JOU-24), is followed by a full recalculation (SEN-34, item d), the same job as one the owner asks for. Each verdict or confidence change it produces is written with the cause « recalcul », dated at that run, and nothing else: no event, count, date or type of what was withdrawn.
  - If the withdrawal leaves a player–type pair with no event in its tally — events that left the count for another reason still count there (CL-SEN-26) — its profile is erased together with its whole verdict history. A general trend left with no event is erased the same way.
  - Residual limit, accepted: an entry naming a profile and a date can still let a reader guess that something left that profile that day, since a recalculation asked for by the owner changes nothing by itself (SEN-36). Besides the global counter, the temporary fingerprint of ADR 0017 is the only other trace.
- **Why:** SEN-48 as written, without keeping the history of a pair that no longer exists.
- **Owner review:** yes — this states what the verdict history can still reveal after a withdrawal.

### CL-SEN-19 — Views and the history (lot 2)

- **Affects:** SEN-21, SEN-37, SEN-41, SUI-08
- **Problem:** each view (all cases, historical only, tracked only) has its own verdict and confidence, and the spec does not say whether the history, the robustness test, the controls and SEN-41 follow each view.
- **Ruling:** Every view is computed in full at each recalculation: tally, verdict, robustness, confidence, controls and warnings. Only the default view, all cases, is written to the verdict history and counted by SEN-41. File 10 reads the historical-only view directly (SUI-08).
- **Why:** the default view is the one the owner reads; the others serve file 10.
- **Owner review:** no

### CL-SEN-20 — Expected false signals (SEN-41)

- **Affects:** SEN-41, H-SEN-14, ADR 0021, CA-SEN-19
- **Problem:** the evaluated pairs are defined with a fixed 5 although the threshold is a parameter, and the shares (4.6 %, 0.27 %) are rounded.
- **Ruling:** Evaluated pairs are the player–type pairs, archived ones included, whose default-view profile has at least the valid-case threshold in force (5 by default). Expected at-least-possible verdicts = pairs × 2 × (1 − Φ(t)), with t the "possible" signal-to-noise threshold; expected probable verdicts use the "probable" threshold. The shares are computed exactly (4.55 % and 0.27 % at the defaults) and shown with two significant digits; the expected counts are shown with one decimal ("about 2.3" and "about 0.1" for 50 pairs, `CA-SEN-19`). General trends are not counted. The mean-gap thresholds and the dispersion floor are ignored, as written: the counts are an approximation.
- **Why:** follows the parameters in force, as ADR 0021 requires when thresholds change.
- **Owner review:** no

### CL-SEN-21 — Proportions below 20 cases

- **Affects:** SEN-39, SEN-25, SEN-28, SEN-29, SEN-43, CA-SEN-14, CA-SEN-20
- **Problem:** SEN-39 shows proportions as counts below 20 cases, without saying which proportions or which count decides.
- **Ruling:** Every proportion shown — cases above or below zero, the share of doubtful cases, the top contributor's share, the cases resting on a low-confidence event — is shown as "k out of m" when its own denominator m is below 20 (parameter), as a percentage otherwise. Calculations always use the exact proportion, as in SEN-25's 30 % and SEN-29's 50 %.
- **Why:** the denominator is what makes a percentage misleading.
- **Owner review:** no

### CL-SEN-22 — Remaining rejections shown on profiles

- **Affects:** SEN-46, IMP-24, H-IMP-12, CL-IMP-24
- **Problem:** SEN-46 shows "the remaining rejections of the player's last import", so a later import into another request would hide rejections never corrected.
- **Ruling:** Each profile of the player shows the sum, over all his requests, of each request's remaining rejections (those of its last import, H-IMP-12). It shows on every profile of the player, since a rejected event has no reliable type.
- **Why:** an uncorrected rejection is a hole in the backtest (H-01) and must stay visible until corrected.
- **Owner review:** yes — the profile count adds up the rejections of every request instead of showing only the last import's.

### CL-SEN-23 — "Tip-off" is the scheduled start

- **Affects:** SEN-03, SEN-44, IMP-18, SUI-06, SUI-09, SUI-16, SUI-17
- **Problem:** SEN-03 compares with the scheduled start, while SEN-44, IMP-18 and file 10 speak of the tip-off.
- **Ruling:** As written in effect: every "tip-off" (« coup d'envoi ») of these rules is the game's scheduled start as last known (STA-31, CL-STA-14). Actual start times are neither fetched nor used.
- **Why:** the source gives only scheduled times.
- **Owner review:** no

### CL-SEN-24 — Test data from the worked example

- **Affects:** « Exemple chiffré complet », SEN-09, CA-SEN-07, CA-SEN-11, CA-SEN-12, CA-SEN-13
- **Problem:** the example chains displayed, rounded values, while SEN-09 forbids rounding in calculations.
- **Ruling:** Tests built from the worked example feed the values it prints — indices and baseline means and deviations at three decimals, gaps at two — as their inputs, and compare results at the printed precision; values the example gives as « environ » are checked within 0.05 (robustness ratio about 1.7, control ratio about 1.5). Tests of the full-precision chain, from raw box scores, use their own fixtures.
- **Why:** keeps the example reproducible by hand, as it intends, without last-digit drift.
- **Owner review:** no

### CL-SEN-25 — A calendar-derived event that is no longer derived

- **Affects:** SEN-32, SEN-33, SEN-20, CL-STA-25; CL-TAX-19, CL-JOU-16 (file 02 and 01 rulings), CL-SUI-14 (file 10 ruling)
- **Problem:** a new derivation can stop producing an event — a corrected birthday or box score, a rescheduled game, a trade before tip-off — and SEN-33's closed list of exits has no reason for it.
- **Ruling:**
  - An upcoming event dropped before its game's scheduled start is deleted with its case and leaves no trace in the tally (CL-SUI-14, CL-TAX-19): nothing about it could depend on a result.
  - An event whose game had started is deleted with its case (CL-TAX-19, CL-JOU-16), and its profile's tally counts it among the events that left the count, with the reason "no longer derived from the calendar" (SEN-33). The tally keeps only that number per reason, with no date and no game, so that a removed or corrected birthday leaves nothing that reveals it (CL-JOU-16).
  - Where this differs from CL-TAX-19 and CL-JOU-16, which record such drops in the journal only: SEN-33 requires every exit from the count to show on the profile, by reason, and an owner's correction of a birthday after seeing results must stay visible there.
- **Why:** SEN-32 and SEN-33 forbid silent exits once a game has been played; before it, no exit can follow a result.
- **Owner review:** no

### CL-SEN-26 — When a profile exists

- **Affects:** SEN-19, SEN-20, SEN-33, SEN-48
- **Problem:** a profile exists "as soon as an event of the type concerns the player", but after dismissals or deletions it may hold no event at all.
- **Ruling:** A profile exists for a player and a validated type while its tally holds at least one event, the events that left the count included, except withdrawn ones (SEN-33). A pair whose events were all dismissed or deleted keeps a profile that shows those exits by reason and its verdict history. Withdrawn events count nowhere (CL-SEN-18).
- **Why:** SEN-33 shows exits by reason, and the history of verdict changes must stay visible after deletions.
- **Owner review:** no

### CL-SEN-27 — A measured case is always a valid case

- **Affects:** SEN-07, SEN-11, VUE glossary (« cas valide »)
- **Problem:** the glossary of 00 defines a valid case as "measured, with no doubtful criterion retained", which suggests a measured case could carry a retained criterion.
- **Ruling:** As written in SEN-07 and SEN-11: a case with any retained criterion, automatic or manual, is in the state excluded; the state measured always means a valid case.
- **Why:** SEN-07 settles it.
- **Owner review:** no

## Passed to the glossary

- Case states and their reasons (SEN-07), and the new reasons "did not play the derived game", "box score unavailable", "box score incomplete", "box score suspect".
- Reference-instant provenances « instant connu », « date seule », « événement connu à l'avance », « report pour antériorité incertaine »; the mention « antériorité incertaine ».
- Criteria « temps de jeu trop faible », « retour de blessure », « enjeu inhabituel », « niveau de l'adversaire », « concomitant », « non évaluable »; the review flags of SEN-16 and "manual decision to review: the measured game changed".
- Manual-decision reasons « temps de jeu », « retour de blessure », « enjeu inhabituel », « niveau de l'adversaire », « autre facteur parasite », « indication de contexte erronée », « critère inadapté à ce cas ».
- Verdicts « non concluant », « possible », « probable »; « hausse », « baisse »; « fragile »; profile confidence « faible », « moyen », « élevé »; the labels of SEN-31 and SEN-30; « verdict dépendant des exclusions manuelles »; « tous les cas sont exclus pour enjeu inhabituel »; « archivé »; the permanent warning of ADR 0016; "recalculation in progress".
- The ten verdict-history causes of CL-SEN-17; the exit reason "no longer derived from the calendar"; the note on ejections of CL-SEN-11.

## Ruled elsewhere

- The cautious instant of a date-only article (COL-21, file 03): ruled by CL-COL-02, which CL-SEN-02 follows.
- Withdrawing a calendar-derived event (ADR 0015 open point 6, file 13): ruled by CL-DSN-09 — these events are never withdrawn, their cases can be excluded (SEN-17). The fingerprint check that CL-SUI-14 runs in the derivation can therefore never match; it is harmless.
- The origin of a calendar-derived case and its Lot 2 flow (ADR 0015 open point 1): ruled by CL-VUE-13, CL-SUI-14, CL-ALE-13 and CL-TEL-21, which CL-SEN-03 follows.
- A case dismissed after its expected game's tip-off (DET-44, SUI-17): ruled by CL-DET-15, which CL-SEN-05 follows.
