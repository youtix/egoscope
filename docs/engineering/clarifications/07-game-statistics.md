# Clarifications — 07 Game statistics

Rulings on the unclear points of the French spec `docs/07-statistiques-de-match.md`.
The decision records (`docs/adr/`, `docs/engineering/spec-deviations.md`) and these rulings override the spec text where they say so; the French spec is authoritative everywhere else.

These rulings take into account the statistics source chosen on 2026-11-11 (`docs/services/statistics-source.md` and `docs/engineering/statistics-source-evaluation.md`): season files of box scores, schedules and players from 1993-94, whole minutes, no ejection data.

### CL-STA-01 — Acceptance-criterion IDs and what each verifies

- **Affects:** the 19 acceptance criteria of 07
- **Problem:** the criteria are unnumbered bullets with no requirement IDs.
- **Ruling:** As decided (decisions, "Acceptance-criterion IDs"): `CA-STA-01` to `CA-STA-19` in document order (cited `07 AC-nn` in the deviations register). Each test names its ID and these requirements: 01 STA-11, STA-12; 02 STA-16, STA-17, STA-19, STA-20; 03 STA-14, STA-15; 04 STA-10, STA-12; 05 STA-09; 06 STA-19 to STA-22; 07 STA-18, STA-19, STA-20; 08 STA-29, STA-30; 09 STA-26; 10 STA-33; 11 STA-33, STA-42; 12 STA-36, STA-37, STA-40; 13 STA-39, STA-40, STA-41; 14 STA-35, STA-44; 15 STA-03; 16 STA-13, STA-46; 17 STA-48; 18 STA-42; 19 STA-24, STA-45.
- **Why:** one citation scheme; the mapping follows each criterion's content.
- **Owner review:** no

### CL-STA-02 — Game phase and baseline phase

- **Affects:** STA-05, STA-16, STA-18, STA-19, STA-20, STA-22, SEN-14, CA-STA-07
- **Problem:** a game has three phases while a baseline has two, and "phase finished" is league-wide for one and per player for the other.
- **Ruling:**
  - Game phase: regular season, play-in, playoffs (STA-05). Baseline phase: regular season or postseason, the postseason grouping the play-in and playoff games of the same season (STA-18 default). With STA-18's parameter set to the regular season, a play-in or playoff game is compared with the same season's regular-season baseline, built from regular-season games only.
  - The regular-season phase is finished when no regular-season game of the season is still scheduled, in progress or postponed, league-wide; its last game, for the correction window (STA-20), is the season's last regular-season game, league-wide.
  - The postseason is finished for a player when his team is eliminated (from the play-in or the playoffs) or the Finals are over; its last game is his team's last postseason game. A team that never enters the postseason has no postseason baseline.
  - SEN-14's play-in test reads the game phase; cases show the baseline phase.
- **Why:** STA-18 and STA-20 already imply two notions; naming them avoids one ambiguous "phase" field.
- **Owner review:** no

### CL-STA-03 — Number of overtimes

- **Affects:** STA-05, STA-09
- **Problem:** the minutes check needs the number of overtimes, which no game attribute holds.
- **Ruling:** A game stores its number of overtimes: for the chosen source, the final period of a final game minus 4 (evaluation, test T11). When that period is missing, the game's overtime count is unknown and the upper bound of the minutes check is not applied to its sheets; the other checks still apply.
- **Why:** derivable from the source; an unknown bound must not make a sheet suspect.
- **Owner review:** no

### CL-STA-04 — Whether the player played, and games without a box score

- **Affects:** STA-08, STA-10, STA-13, STA-24, STA-27, STA-35, STA-46, SEN-03, SEN-07, SEN-13
- **Problem:** "played" needs time on court from a sheet, but some games have no box score at all (the chosen source lists a few games of older seasons without player lines), so their participation is unknown, while attachment, absence counts and the partial-baseline share all need it.
- **Ruling:**
  - For each final official game of a team the player belongs to (CL-STA-05), his participation is:
    - played: his line shows minutes above zero, or any non-zero element whatever its minutes (CL-STA-06);
    - not played: the source has player lines for his team in that game and he has a did-not-play line, no line, or a line with zero minutes and no non-zero element;
    - unknown: the source has no player lines for his team in that game, or has not published them yet.
  - An unknown participation lasts while the sheet is missing and ends as "unavailable" under STA-35 (CL-STA-11). A game of a past season listed without player lines is therefore unavailable at once.
  - Attachment (SEN-03) stops at the first game of unknown participation: the case waits, reason "statistics pending", and once that sheet is unavailable it is not measurable, reason "box score unavailable" (SEN-07). It never slides past such a game to a later one.
  - A game without a box score has no index and enters no baseline and no average of minutes.
  - Absence counts (SEN-13, STA-46) count games of unknown participation as missed.
  - The partial share of STA-24 counts them on both sides: played games without index plus unknown games, out of played games plus unknown games.
  - The did-not-play reason the source gives is dropped at once and never stored (JOU-21, DSN-15).
- **Why:** a published box score lists everyone who played, so absence from it means not played. An unknown game may be the true measured game; skipping it could measure the wrong one, which SEN-03 forbids.
- **Owner review:** yes — a case whose first game after the event has no box score is not measurable, even if the player may not have played that game.

### CL-STA-05 — Which games are the player's team games

- **Affects:** STA-27, STA-46, SEN-03, SEN-13, « Cas limites » (joueur transféré), JOU-13
- **Problem:** absences are counted on "his team's" games, but the spec does not say when a player joins or leaves a team, and the source gives no date for a trade or a release.
- **Ruling:** A team's official game is one of the player's team games when he belongs to that team at its scheduled start. Membership comes from his box-score lines: it starts at his first game played for a team — his arrival — and ends at his first game played for another team, or earlier at a team change or release the app recorded from the source while it was current (STA-25, kept with its date in the team history of JOU-13) — his departure. Before his first NBA game, and while he belongs to no team (CL-JOU-20), he has no team games. Hence, after a trade or release the app did not record, the old team's games up to his first game for a new team count as missed, and the new team's earlier games do not count. The current team (STA-25) never rewrites past membership. This is "the team he belonged to at each game date" of CL-JOU-15 (missed games) and CL-TAX-18 (calendar derivation).
- **Why:** follows JOU-13, which dates a team change at the first game with the new team, and the « Cas limites » rule that a team's games before the player's arrival or after his departure are not absences; it uses stored data only, so it is reproducible.
- **Owner review:** no

### CL-STA-06 — Whole minutes from the source

- **Affects:** STA-08, STA-09, STA-12, STA-14, STA-15, STA-46, SEN-12, service sheet (Risks, item 4)
- **Problem:** the chosen source gives playing time in whole minutes, rounded to the nearest minute, never seconds, while the spec computes the index on decimal minutes and compares minutes with a threshold.
- **Ruling:**
  - The minutes of a line are the whole number the source gives (26 stands for 25 min 30 s to 26 min 29 s); decimal minutes are that number (26.0). Every line of a whole-minutes source carries the mention "rounded minutes" (STA-12).
  - Index = Game Score ÷ those minutes. A line with zero minutes, or with no minutes, but a non-zero element is played and has no index: it is incomplete (STA-10), not suspect, because a statistic next to 0 rounded minutes means less than 30 seconds on court. With a source in seconds, STA-09's "no non-zero statistic for a player with no minutes" applies as written.
  - Usable game (STA-14): the whole minutes are compared with the threshold as they are, usable when at least the threshold. With a 17.5-minute threshold this is exact (18 or more means at least 17 min 30 s); with the 15-minute floor, games of 14 min 30 s to 14 min 59 s show 15 and are usable.
  - The average minutes behind the 50 % rule is the mean of the whole minutes (CL-STA-07).
  - Minutes check (STA-09): 0 to 48 + 5 per overtime on the whole minutes, with no tolerance, since rounding to the nearest minute can never exceed the game's length.
  - The mention changes no state (neither doubtful nor partial). Lists that show minutes or indices (case list, case detail) state once that the source rounds minutes to the nearest minute; the Method and limits page says it too.
  - The provider-neutral core keeps seconds: a source in seconds (the service sheet's first replacement) gives exact decimal minutes, and the criteria written with seconds (`CA-STA-01`, 34 min 30 s) remain tests of the core.
- **Why:** STA-12 already provides for whole minutes; comparing the stored value with the threshold needs no invented tolerance.
- **Owner review:** yes — every index carries up to 30 seconds of rounding, and games of 14 min 30 s to 14 min 59 s pass the 15-minute floor.

### CL-STA-07 — The playing-time threshold of a season moves while its average moves

- **Affects:** STA-14, STA-15, STA-21, SEN-12, SEN-34
- **Problem:** the threshold uses the player's average minutes in the same regular season, which changes after each game of the current season, so games can move in and out of "usable"; the spec does not say whether the measured game is in that average or when the status is fixed.
- **Ruling:**
  - One threshold per player and season: the larger of the floor and the fraction of his average minutes. The average is the mean minutes of his regular-season games of that season that he played with known minutes above zero and a sheet that is not suspect (incomplete sheets with known minutes count). With no such game, the threshold is the floor.
  - The same threshold applies to every game of that season — regular season, play-in and playoffs — and the measured game stays in the average (STA-15's "same threshold").
  - It is recomputed from stored data at every recalculation. Until the season's last regular-season game is consolidated, every usable status of the season may change; each recalculation of the season (SEN-34, item b, after each new game) therefore re-derives the usable statuses, then the baselines, gaps and cases. Once that game is consolidated, the threshold changes only through a correction found by a manual refetch (STA-34).
- **Why:** taking the measured game out of the average would give each case its own threshold, against STA-15.
- **Owner review:** no

### CL-STA-08 — A standard deviation of zero

- **Affects:** STA-19, STA-21
- **Problem:** STA-19 makes a baseline insufficient when its standard deviation is zero, without saying whether this holds while its phase is still running.
- **Ruling:** As written: a zero standard deviation makes the baseline insufficient at that computation, whatever the phase. A provisional baseline is recomputed after each new game (STA-21), so it can become provisional again when the deviation is no longer zero, and the case follows.
- **Why:** the text is unconditional, and provisional states are recomputed anyway.
- **Owner review:** no

### CL-STA-09 — Arithmetic precision, display rounding, order of sums

- **Affects:** STA-12, STA-16, SEN-09, SEN-20, SEN-36
- **Problem:** STA-12 forbids rounding in calculations, while decimal minutes and means are often non-terminating, and sums over many values must stay reproducible.
- **Ruling:** Calculations use IEEE 754 double precision with no intermediate rounding. Displayed values round half away from zero to the number of decimals their owning requirement sets (index 3, STA-12; normalized gap 2, SEN-09; other means and ranges 2); a value that rounds to zero is shown without a sign. Sums and means over games or cases are taken in a fixed order — by scheduled start, ties by game or case identifier — so the same data always give the same bits (SEN-36). Tests compare raw values with a tolerance of 1e-9 and displayed strings exactly; tests built from the worked examples feed the rounded values they print (CL-SEN-24).
- **Why:** "sans arrondi" forbids rounding to display precision, not floating point; a fixed order makes results deterministic.
- **Owner review:** no

### CL-STA-10 — When the daily update runs

- **Affects:** STA-32, STA-36, STA-37, H-STA-12, TRV-25, TRV-30, service sheet ("Daily task timing"); CL-TRV-03, CL-TRV-23 (file 14 rulings)
- **Problem:** STA-32's earliest time moves with each day's last tip-off, the host has no fine scheduler, and the chosen source publishes the previous night about eight to nine hours after its last tip-off.
- **Ruling:** The timing is CL-TRV-23's, applied as it is; in this file's terms:
  - The competition day D is the league's US date of the games (CL-TRV-03).
  - The daily update for D starts at the start hour (15:00 in the owner's time zone by default, CL-TRV-23) and fetches as soon as the source shows a refresh made after D's last scheduled tip-off plus STA-32's delay (3 hours); it checks every probe interval (60 minutes) until the cut-off (20:00), then fetches what is published, missing sheets following STA-35. After a competition day without games it does not wait.
  - A late source is not a failed request: STA-36's retries do not apply to it. Lateness on consecutive competition days opens the "statistics source unavailable" incident of STA-37, as CL-TRV-23 rules.
  - The external trigger (ADR 0002) runs the scheduler often enough for these steps; the update runs once per D and resumes where it stopped (TRV-30).
- **Why:** STA-32 sets an earliest time; waiting for the publication avoids ingesting each night a day late; file 14 owns the task calendar.
- **Owner review:** no

### CL-STA-11 — The 30 days before a sheet is "unavailable"

- **Affects:** STA-35, STA-36, STA-39, SEN-07, CA-STA-14
- **Problem:** days when the source is down do not count toward the 30 days, but no rule says what such a day is, and quota stops are not mentioned.
- **Ruling:** A sheet missing while the source answers normally becomes unavailable at the first daily update when more than 30 (parameter) counted days have passed since the game's US date. A day, in the owner's time zone (TRV-72), counts unless a "statistics source unavailable" incident (STA-37) or a "quota reached" incident (STA-39) was open at some moment of it. A game already older than that when first requested — a past-season game listed without player lines — is unavailable at once. The days are counted from the stored incident periods; no other record is kept.
- **Why:** STA-36's principle — no case changes state because the app could not ask — extends to days blocked by the quota.
- **Owner review:** no

### CL-STA-12 — When the first NBA game is known

- **Affects:** STA-47, STA-45, BKT-08, IMP-12, H-BKT-01
- **Problem:** the date may be deduced from box scores, but seasons are fetched in priority order, not chronologically, so an early deduction could be wrong while BKT-08 and IMP-12 use it as a hard bound.
- **Ruling:** With the chosen source the date is deduced: the earliest official game in which the player played (CL-STA-04). It is known only once the box scores of the earliest season in which the source lists him are stored; until then it is "date unknown" (STA-47). It also stays unknown when that earliest season is the source's first covered season (1993-94), since his career may start before it. A deduction from later seasons is never used. The date is the game's US date. Once known, it bounds new requests and imports; events already imported before it stay as they are.
- **Why:** a hard bound must never come from a partial fetch.
- **Owner review:** no

### CL-STA-13 — Indicative comparison: which "previous regular season" (lot 2)

- **Affects:** STA-23, H-STA-09, SUI-20
- **Problem:** STA-23 always compares with the previous regular season's final baseline, even for a play-in or playoff game whose own baseline is building.
- **Ruling:** "The previous regular season" is the most recent regular season whose baseline is final at the time of the comparison and that precedes the measured game: for a play-in or playoff game, the same season's regular season once final, otherwise the previous season's; for a regular-season game, the previous season's. Its baseline uses all usable games of that regular season. The comparison stays labeled indicative and never enters a calculation (as written).
- **Why:** « précédente » reads as "preceding the measured game", the closest normal play.
- **Owner review:** no

### CL-STA-14 — Venue local date and times to be determined

- **Affects:** STA-31, SEN-02, BKT-16, BKT-18, ADR 0015 (birthday games), CA-STA-08; CL-TRV-03 (file 14 ruling)
- **Problem:** several rules need the game's date at the venue, which the source does not give, and STA-31's deemed start at the beginning of the local day would show as midnight.
- **Ruling:**
  - Venue local date: the calendar date of the scheduled start in the venue's time zone, as CL-TRV-03 rules: the zone of the venue's city when the source names a venue of the fixed table kept with the source adapter (every NBA arena, past and present, and the international venues found in the schedules), otherwise the zone of the home team's arena, otherwise US Eastern time. A venue missing from the table is recorded in the journal (no player data) so the table can be completed.
  - Time to be determined (the source's flag that the time is not valid): the game keeps its date, the mark "time TBD" and a deemed start at 00:00 at the venue on that date, in the zone found as above (H-STA-11). Every comparison — precedence, SEN-03's "strictly after", SEN-04's window, orderings, BKT-18's urgency — uses the deemed start. Screens and messages show the date with "time TBD", never 00:00. When the time is published, it replaces the deemed start and dependent cases are recalculated (STA-28, SEN-34).
  - A placeholder game whose teams are still to be determined is no team's game until its teams are set.
- **Why:** derives what the source does not give; the deemed start is a cautious bound for comparisons, not information to show.
- **Owner review:** no

### CL-STA-15 — Outage, quota and normal answers

- **Affects:** STA-02, STA-36, STA-37, STA-39, STA-41, service sheet ("What happens when a quota is hit")
- **Problem:** the quota is "known or observed" without saying how it is observed, and the chosen source publishes none.
- **Ruling:**
  - Each answer is an outage (network error, timeout, HTTP 5xx, unreadable file), a quota answer (HTTP 429, or 403 with rate-limit headers) or a normal answer (anything else, a missing resource included, since it is data). A missing current-season file or changed columns open the schema incident of the service sheet and ingest nothing.
  - After an outage the source is failing: the next request goes 1 hour later, then every 4 hours, until one succeeds (STA-36); after 12 hours of continuous failure the incident opens (STA-37).
  - The known quota is the limit the service sheet states: the provider's, or, for the chosen source, which publishes none, the app's own ceilings (200 downloads and 2 GB a day, one download at a time, warning at 80 %). The app counts against it and keeps the 10 % reserve for priority levels 1 and 2 (STA-39). A quota answer stops requests until the reset the answer or the service sheet gives, otherwise until the next period of those ceilings, and opens "quota reached".
  - The end-date estimate of STA-41 uses the known quota.
- **Why:** turns "observed" into tested answer classes and gives the reserve a number to apply to.
- **Owner review:** no

### CL-STA-16 — Games the source files under the regular season but which never count

- **Affects:** STA-04, STA-06, STA-14, STA-26, SEN-03, H-STA-02, « Cas limites » (match ignoré par STA-04), ADR 0015
- **Problem:** the chosen source files All-Star games and the NBA Cup final as regular-season games, while STA-04 ignores every game the official statistics do not count.
- **Ruling:** The adapter flags as never counting: All-Star games (labeled as such, or whose teams are not both NBA franchises) and the NBA Cup final (labeled as such); preseason and exhibition games are absent from the files. A flagged game is never a measured game, a baseline game, a team-record game, an absence, a next game (STA-26), a game of the average minutes, or a calendar-derived game. NBA Cup group and knockout games before the final are regular-season games and count. The team test needs no label, so the rule holds for every season.
- **Why:** STA-04 as written, applied to how the source files these games.
- **Owner review:** no

### CL-STA-17 — Postponed games and their make-up

- **Affects:** STA-05, STA-26, STA-28, « Cas limites » (match reporté), SUI-03
- **Problem:** in the spec a postponed game keeps its identity and comes back scheduled at its new date; the chosen source keeps the original as postponed and publishes the make-up as a new game labeled "Makeup from" the original date.
- **Ruling:** The app keeps one game. When the adapter links a make-up to its postponed original (same two teams, same season, the make-up label), the original takes the make-up's date, instant and status, and stores the make-up's source identifier as an alias. When no link can be made, the make-up is an ordinary game and the original stays postponed, which no rule counts: it is never final, so never a team game, an absence, a next game or a measured game. Canceled games are ignored (as written).
- **Why:** STA-05's single identity lets derived events and lot-2 tracked cases follow a rescheduled game.
- **Owner review:** no

### CL-STA-18 — Playoff series and elimination games

- **Affects:** STA-05, STA-07, SEN-14
- **Problem:** STA-05 stores each postseason game's series, game number and wins before it, and STA-07 whether a loss eliminates a team, but the source gives round labels only from 2003-04 and game numbers only from 2008-09.
- **Ruling:**
  - A series is the set of a season's playoff games between the same two teams (two teams meet at most once in a postseason). Its round is the source's round label when present, otherwise the number of series each of the two teams has played before it in that postseason (the first one is the first round).
  - Game numbers and wins before each game come from the chronological order of the series' final games in the schedule; from 2008-09 they are checked against the source's game numbers.
  - The length of each round per season comes from a fixed table (best of five in the first round up to 2001-02, best of seven otherwise), tested against the labeled seasons.
  - A playoff game is an elimination game when a team's wins before it equal the wins needed minus one. A play-in game is always unusual stakes through its phase (SEN-14), whatever this flag.
  - When a series cannot be rebuilt — a game of it missing from the schedule, game numbers that disagree, or a series ending without a team reaching the wins needed — the elimination flag of its games is unknown, and SEN-14's calculated condition is "not evaluable" for their cases (CL-SEN-10).
- **Why:** derives STA-05 and STA-07 for every covered season, and says what happens when the old files do not allow it.
- **Owner review:** yes — in older playoffs whose series cannot be rebuilt, elimination games are not excluded automatically; their cases say the stakes could not be evaluated.

### CL-STA-19 — Team records

- **Affects:** STA-06, SEN-15
- **Problem:** the source's schedule carries record columns, and the spec does not say which games a record counts.
- **Ruling:** A team record is computed from the stored schedule's final regular-season results (scores), the games of CL-STA-16 excluded; a game listed without a result is not counted. The source's own record columns are never used: they give the record on the day the file was written. Which games SEN-15 takes from these records is ruled in CL-SEN-10 (the measured game's whole season, as written).
- **Why:** STA-06 says the app computes records from results.
- **Owner review:** no

### CL-STA-20 — Reasons for "no game scheduled"

- **Affects:** STA-26, BKT-16, CA-STA-09, CA-BKT-17
- **Problem:** STA-26 lists four reasons without saying when each applies, and the chosen source is not refreshed from mid-July to mid-October, so the next season's schedule may be missing for months.
- **Ruling:** When the player has no next game, the reason is the first of these that applies:
  1. « joueur sans équipe »: he has no current team (STA-25);
  2. « équipe éliminée »: the league's postseason is still under way (a play-in or playoff game is scheduled, or the Finals are not over) and his team's season is over (eliminated, or not in the postseason);
  3. « intersaison »: the season's Finals are over and the next season's first game is not in the stored schedule;
  4. « calendrier non publié »: any other case, for example his team is still in the playoffs but its next game is not yet in the schedule.
- **Why:** gives each reason a testable condition; `CA-STA-09` and `CA-BKT-17` hold.
- **Owner review:** no

### CL-STA-21 — "Current season" during the off-season

- **Affects:** STA-46, JOU-02, JOU-21, STA-48; CL-JOU-15 (file 01 ruling)
- **Problem:** STA-46 gives the games played and average minutes of the current season, which the off-season leaves undefined.
- **Ruling:** As CL-JOU-15 rules for the indicators of the player sheet: STA-46 gives the games played and average minutes of the season in progress (from its first regular-season game to its last playoff game, STA-48) and, between seasons, of the last season played, naming the season it covers. The consecutive games missed since the last game played are counted across seasons, on the team games of CL-STA-05. Every other rule that speaks of the current season (provisional baselines, STA-21) means the season today's date belongs to under STA-48.
- **Why:** file 01 owns the display of these indicators; an empty coming season would tell the owner nothing in summer.
- **Owner review:** no

### CL-STA-22 — When a season is not covered

- **Affects:** STA-45, H-STA-16, SEN-07, register row STA-45
- **Problem:** STA-45 speaks of a season the source "does not cover at all" without saying how the app knows.
- **Ruling:** The chosen source covers the regular season and the playoffs from 1993-94 (service sheet). A season is not covered when it is earlier than the first season the service sheet states, or when the source holds no player lines for any of its official games. A covered season with some games missing stays covered; those games are unavailable (CL-STA-04). A case whose reference instant falls in an uncovered season (STA-48) is not measurable, reason "season not covered by the source" (CL-SEN-05). No current player's career starts before 1993-94 (evaluation, test T20).
- **Why:** the service sheet states the first season covered (ADR 0012).
- **Owner review:** no

### CL-STA-23 — One source per season

- **Affects:** STA-03, STA-16, STA-42, JOU-10, JOU-12, TRV-12, ADR 0012 (open point), register row STA-03; CL-JOU-21, CL-TRV-14 (file 01 and 14 rulings)
- **Problem:** combining two sources clashes with one source identity per player (STA-03) and with baselines computed season by season.
- **Ruling:**
  - The source chosen on 2026-11-11 is used alone (statistics-source evaluation, section 1): one source, one confirmed identity per player, STA-03 as written.
  - One source per season, always: the service sheet assigns each season to exactly one source. All data of a season — schedule, results, series, box scores, team records — comes from that source and the other is never queried for it, so no rule ever chooses between two sources for one game, and no baseline, threshold, team record or opponent percentage mixes sources.
  - Two combined sources: the player has one mapping per source, each confirmed by the owner (CL-JOU-21); until a source's mapping is confirmed, its seasons are not fetched and their cases wait (stats match not confirmed).
  - Replacement (TRV-12): as CL-TRV-14 rules — stored seasons keep the data and identifiers of the source they came from; players are mapped by the published crosswalk where it exists, otherwise by a new JOU-10 confirmation; teams and games are matched by date, home team and away team. One difference: the season in progress at the replacement is fetched again whole from the new source, its consolidated games included (an exception to STA-42 and to CL-TRV-14's "never fetches a consolidated game again"), and its games are matched to the stored ones the same way, so that its baseline never mixes two sources. A full recalculation follows (SEN-34, item d).
- **Why:** ADR 0012's recommended handling, one source per season; a season half from each source would mix, for example, rounded and exact minutes inside one baseline.
- **Owner review:** yes — at a replacement, the season in progress is fetched again whole from the new source, consolidated games included, so that no season's numbers come from two sources.

### CL-STA-24 — Former teams from seasons the source does not cover

- **Affects:** STA-08, STA-45, JOU-13, ADR 0015 (open point 4), register rows JOU-11, JOU-13, STA-08; CL-JOU-16, CL-JOU-18, CL-TAX-18 (file 01 and 02 rulings)
- **Problem:** former teams come only from box scores of covered seasons, so a team the player left before the first covered season is unknown and his first game against it is silently missed, against the exhaustive count of H-01.
- **Ruling:**
  - What the app derives, as CL-JOU-18 and CL-TAX-18 rule: only from stored box scores of covered seasons. Birthday games only in covered seasons. A former team is a team for which the player played (CL-STA-04) at least one official game in a covered season; each stint with it ends at his last game played for it in that stint. A first meeting is derived only when every season from that departure to the meeting is covered. Former teams are never entered by hand and never taken from the source's player files, whose team is a later snapshot (evaluation, test T16).
  - Missed by construction: games in uncovered seasons; first games against a team the player played for only in uncovered seasons, even when that game falls in a covered season; first games against a team for which all his games lack box scores.
  - What the owner sees, among the profile warnings of SEN-46, which never change a verdict: on every former-team profile, the permanent mention of CL-JOU-18 that its team history starts with the first covered season, which it names; on a birthday profile, "birthday not recorded: no birthday events" when the day and month are missing (CL-JOU-16), and, when the player's career may start before the first covered season (his first NBA game earlier than it, or unknown, CL-STA-12), the mention that birthday games are counted from that season on. With the chosen source, from 1993-94, no current player's career starts earlier (evaluation, test T20).
- **Why:** H-01 cannot be met for these games; saying where the count stops keeps the profile from looking complete.
- **Owner review:** yes — the birthday and former-team profiles can miss games the app cannot see, and say so instead of looking complete.

### CL-STA-25 — Calendar-derived events and the schedule

- **Affects:** STA-26, STA-28, STA-32, STA-42, SUI-03, ADR 0015 (open points 1 and 2); CL-TAX-18, CL-TAX-19 (file 02 rulings), CL-SUI-14 (file 10 ruling)
- **Problem:** nothing says when a calendar-derived event is created, nor how it follows schedule and team changes.
- **Ruling:** When the derivation runs, which games it turns into events, upcoming events and drops are ruled by CL-TAX-18 and CL-TAX-19 (a Lot 1 function) and, for the Lot 2 flow, by CL-SUI-14; file 07 supplies their inputs:
  - "his team" at a past game is the membership of CL-STA-05, and at his next game his current team (STA-25, CL-STA-27);
  - every change of stored games or box scores that CL-TAX-19 lists — the daily update, each season of history stored by the career fetch, a refetch, a correction (STA-33, STA-34), a schedule change of the current season (STA-28) — starts the derivation for the players concerned, so a season stored late or a corrected box score is taken into account;
  - an upcoming event exists only for the player's next game (STA-26) and follows each recomputation of STA-28; the derived game is its expected and measured game (CL-SUI-14).
  - What a dropped event leaves in the count: CL-SEN-25.
- **Why:** one rule for the derivation, the one files 02 and 10 already give; file 07 only says which of its own events start it.
- **Owner review:** no

### CL-STA-26 — Two correction histories

- **Affects:** STA-33, STA-34, IMP-32
- **Problem:** the statistics correction log keeps old values, while corrections of events must not.
- **Ruling:** As written: the statistics correction log (element, old value, new value, date, origin) and the trace of event corrections (date and fields changed, never the old value, D-20) are two separate stores with separate rules; no generic history serves both.
- **Why:** statistics are not sensitive; event texts are.
- **Owner review:** no

### CL-STA-27 — Where the current team comes from

- **Affects:** STA-25, JOU-13, H-JOU-03; CL-JOU-02 (file 01 ruling)
- **Problem:** STA-25 and JOU-13 both describe the current team; read literally, old box scores fetched later could rewrite it.
- **Ruling:** As written, and as CL-JOU-02 rules: file 01 owns the current team (JOU-13); file 07 supplies two observations. They are the team of his most recent game played, by scheduled start, and the current team of the source's current-season player file, which is how the chosen source reports a trade, signing or release. When they differ, the player file wins if it was refreshed after that game. Box scores of older games, fetched later, never change the current team; past-season player files are never used.
- **Why:** STA-25 speaks of the last game played; the source's past files are later snapshots (evaluation, test T16).
- **Owner review:** no

### CL-STA-28 — The season of a game or a date

- **Affects:** STA-48, IMP-22, H-STA-17, CA-STA-17
- **Problem:** the source names files by season but some files overlap (1998-99 games also sit in the 1999-2000 files), and the off-season rule needs a season even when its schedule is not stored.
- **Ruling:** Each game gets its season from its date and the seasons' start dates, never from the file it came from, and is kept once per game identifier. To file any date by season (IMP-22): a date from a season's first regular-season game to its last playoff game belongs to that season; any other date belongs to the next season (H-STA-17), even when that season's schedule is not yet stored. Seasons are written "2024-2025" in data; their display follows the glossary.
- **Why:** STA-48 defines seasons by their games, not by files.
- **Owner review:** no

## Passed to the glossary

- Game statuses « prévu », « en cours », « terminé », « reporté », « annulé »; phases « saison régulière », « tournoi de qualification », « phases finales », and the baseline phase "postseason".
- Sheet states « complète », « incomplète », « douteuse », « indisponible »; the mentions « minutes arrondies », « heure à déterminer », « partielle »; « correspondance à établir ».
- Baseline states « définitive », « provisoire », « en constitution », « insuffisante »; game classes « non joué », « joué non exploitable », « exploitable ».
- Reasons « aucun match prévu », « intersaison », « équipe éliminée », « joueur sans équipe », « calendrier non publié »; « statistiques en attente »; « saison non couverte par la source »; « date inconnue ».
- Incidents « source de statistiques indisponible », « quota atteint »; the progress label « 9 saisons sur 14 »; the correction-log origins « fenêtre de correction », « relance manuelle »; « indicative ».
- The birthday-profile mention of CL-STA-24 (birthday games counted from the first covered season on), the "rounded minutes" note of CL-STA-06, and "no longer derived from the calendar".

## Ruled elsewhere

- The start hour, wait and cut-off of the daily statistics task (TRV-25, file 14): ruled by CL-TRV-23, which CL-STA-10 follows.
- The day of a game and the venue's zone (TRV-72, file 14): ruled by CL-TRV-03, which CL-STA-10 and CL-STA-14 follow.
- The calendar derivation and the Lot 2 flow of upcoming calendar-derived events (ADR 0015, open points 1 and 2): ruled by CL-TAX-18, CL-TAX-19, CL-VUE-13, CL-SUI-14, CL-ALE-13 and CL-TEL-21, which CL-STA-25 follows.
- A birthday on 29 February (ADR 0015, open point 5): ruled by CL-JOU-17.
- Missed games across trades and seasons (STA-46): CL-JOU-15's count, which CL-STA-05 and CL-STA-21 define in this file's terms.
