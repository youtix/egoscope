# Clarifications — 01 Joueurs suivis

Rulings on the unclear points of the French spec [`docs/01-joueurs-suivis.md`](../../01-joueurs-suivis.md), numbered `CL-JOU-nn`.
The decision records (`docs/adr/`, with the register `docs/engineering/spec-deviations.md`) and these rulings override the spec text where they say so; the French spec is authoritative everywhere else.

### CL-JOU-01 — Acceptance-criterion IDs

- **Affects:** the seventeen acceptance criteria of 01
- **Problem:** the criteria are numbered without IDs.
- **Ruling:** as ruled in planning: `CA-JOU-01` to `CA-JOU-17` in document order; each keeps the requirement IDs written in its parentheses.
- **Why:** one citation scheme for every file without IDs.
- **Owner review:** no

### CL-JOU-02 — Current team: only the most recent evidence counts

- **Affects:** JOU-13, JOU-14, CA-JOU-09, STA-25, H-JOU-03
- **Problem:** read literally, JOU-13 changes the current team whenever the statistics task sees a game played for another team, and backtests fetch whole careers, so old box scores would rewrite the current team.
- **Ruling:** the current team changes only on evidence more recent than the latest entry of the team history: the player's most recent official game played, by scheduled start, or a later team change that the source reports (STA-25). A box score of an older game never changes the current team and never adds a team-history entry, whatever order the seasons are fetched in. The team history therefore records changes from the day the player is followed, starting from the team chosen at addition; the career's former teams are read from the box scores directly (CL-JOU-18). CA-JOU-09 applies to a game more recent than the latest change.
- **Why:** STA-25 already reads "the team of the last game played"; the history must not depend on fetch order.
- **Owner review:** no

### CL-JOU-03 — A team change entered by hand, and its confirmation

- **Affects:** JOU-13, 01 « Données manipulées » (Historique des équipes)
- **Problem:** an entered change is "confirmed" by the first game with the new team, but the history has no place for that, and the date to store for an entered change is not given.
- **Ruling:** an entered change records its entry instant as its date, the previous team, the new team, the origin "entered" and the mark "unconfirmed". At the first official game the player plays after the entry: if it is for the entered team, the change gets "confirmed by the game of <date>"; if it is for another team, an observed change to that team is recorded, dated by that game, and the entered change stays "unconfirmed". An observed change is dated by the first game played with the new team, as written.
- **Why:** the minimum that makes "confirmed" visible without a new state.
- **Owner review:** no

### CL-JOU-04 — Duplicates while the mapping is pending

- **Affects:** JOU-10, JOU-12, CA-JOU-08, 01 « Cas limites » (Joueur déjà suivi)
- **Problem:** uniqueness rests on the confirmed mapping, so two records of the same player can coexist while both are "mapping to establish"; the refusal is described only at addition.
- **Ruling:** confirming a statistics identity already linked to another followed player is refused at any moment — at addition, from the to-do list, or after a JOU-12 change — whatever that player's state; the message names him and opens his page (CA-JOU-08). Candidate lists show such an identity as "already followed as <name>", and it cannot be confirmed. The refused record keeps "mapping to establish"; the owner can withdraw it and delete its data (JOU-24). At addition, the usual name typed is compared with every followed player's name variants (CL-JOU-13) and a match shows the shared-variant warning of JOU-09 before saving.
- **Why:** the mapping is the only reliable identity; the refusal must not depend on when the owner confirms it.
- **Owner review:** no

### CL-JOU-05 — What still runs for paused and withdrawn players

- **Affects:** JOU-16 to JOU-20, JOU-02, JOU-21, JOU-22, STA-40; record 0015 (reading "active and paused players")
- **Problem:** JOU-16 lists statistics and profiles for active players; nothing says whether baselines, the next game and the indicators keep updating for paused or withdrawn players with open cases.
- **Ruling:** for every followed player with a confirmed mapping, whatever his state, the statistics functions go on: schedule and box scores (career fetch included), season baselines, next game, the JOU-02 and JOU-21 indicators, and the calculation of his profiles. States gate only:
  - detection, detection-born requests and alert sheets: active players only (JOU-18, JOU-19);
  - manual backtest requests: active and paused players (JOU-17, JOU-19);
  - the prolonged-absence suggestion: active players only (JOU-22);
  - the calendar derivation: active and paused players only; a withdrawn player's calendar-derived events are kept, and none is added or dropped until he is reactivated (CL-TAX-19).
- **Why:** open cases and archived profiles need current statistics (JOU-17, JOU-19); the cost is one box-score line per game.
- **Owner review:** no

### CL-JOU-06 — Exact scope of a player's data deletion

- **Affects:** JOU-24, CA-JOU-16, DSN-27, TRV-41, TRV-50
- **Problem:** JOU-24 and its criterion list only part of what designates the player.
- **Ruling:** deleting a withdrawn player's data erases, in one operation:
  - his identity (usual name, variants, nicknames and their marks, current team, statistics mapping or mappings, day and month of birth, date of addition), his status history and his team history;
  - his box-score lines and his exposure counts (schedules and results, shared by all players, stay);
  - every backtest request of any state with its prompt, copy dates and draft, his coverage and his import traces;
  - every one of his events, of every origin and state, with the scope of a withdrawal (DSN-27): cases, sources, descriptions, context, correction history and, in Lot 2, classification results, articles attached to no remaining event (DSN-34), alert sheets with their alert-history entries, tracked cases, and stored Telegram texts with an attempt to delete the messages;
  - his profiles with their verdict-history entries, and the type-proposal occurrences that concern him (the proposal itself stays);
  - in the journal, every reference to him or to his events, which then read "a deleted player" or "an item that no longer exists" (CL-TRV-10).

  The counter grows by the number of his events, all origins and states (CA-JOU-16). No fingerprint is created (CL-JOU-24); one deleted-player entry is kept so that a restore deletes him again (CL-TRV-06). Before the double confirmation the screen shows the counts and these limits: backups keep the data until they rotate out; a restore made within the fingerprint horizon deletes him again; downloaded exports keep it; Telegram messages that can no longer be deleted stay. General trends are then recalculated.
- **Why:** "toutes ses données" leaves no exception; when in doubt the app erases more.
- **Owner review:** yes — deletion also removes his statistics lines, verdict history and journal mentions, and leaves one unreadable entry for the fingerprint horizon.

### CL-JOU-07 — The withdrawn-events counter also counts deleted players

- **Affects:** JOU-24, CA-JOU-16, DSN-29, VUE-09
- **Problem:** the counter mixes sensitivity withdrawals and player deletions.
- **Ruling:** as written: JOU-24 applies the withdrawal of 13 to each event and CA-JOU-16 requires the counter to grow by their number. The page states what the counter counts (CL-DSN-04).
- **Why:** a deletion can embellish trends as much as a withdrawal; the counter exists to show it.
- **Owner review:** no

### CL-JOU-08 — Deletion versus the rationale of H-JOU-07

- **Affects:** H-JOU-07, JOU-24
- **Problem:** H-JOU-07 keeps withdrawn players' cases in trends so trends do not depend on the owner's choices, yet deletion removes them.
- **Ruling:** as written: deletion is the deliberate exception, reserved to withdrawn players, doubly confirmed and counted (JOU-24, CL-JOU-07).
- **Why:** the text states both rules and their order.
- **Owner review:** no

### CL-JOU-09 — Player identifiers are never issued twice

- **Affects:** JOU-08, CA-JOU-17
- **Problem:** an identifier is never reassigned, even after a deletion, which seems to require remembering deleted identifiers.
- **Ruling:** player identifiers are random UUIDs, generated at addition and never derived from the name; no list of deleted identifiers is kept, and a restore can never make the application issue an identifier again. A research result bearing an unknown player identifier follows IMP-07: attachment is offered by name and never made automatically (CA-JOU-17).
- **Why:** a random identifier needs no memory and survives restores of older data without collision.
- **Owner review:** no

### CL-JOU-10 — Lowering the maximum below the number of active players

- **Affects:** JOU-04, JOU-05
- **Problem:** the cap blocks additions and reactivations only; lowering it below the current count is not addressed.
- **Ruling:** the new value is accepted within its bounds (CL-TRV-16). On saving, the settings screen says "N players are active, above the new maximum M: no player is paused; additions and reactivations are refused until fewer than M are active". The application never pauses anyone by itself.
- **Why:** the application never changes a state on its own (JOU-22); the owner keeps the choice.
- **Owner review:** no

### CL-JOU-11 — Changing the statistics mapping

- **Affects:** JOU-12, JOU-10, STA-03
- **Problem:** nothing says what happens to statistics, baselines and cases computed with the old mapping.
- **Ruling:** changing the mapping reopens the JOU-10 search and confirmation; until a new identity is confirmed the player shows "mapping to establish" and nothing is fetched for him. Once a different identity is confirmed: the box-score lines of the former identity are deleted; the new identity's lines are fetched in the STA-40 order; every case of the player is recalculated (STA-03) and waits with "statistics pending" meanwhile; the current team is observed again from the new identity's latest game played; a day and month of birth taken from the source is replaced by the new identity's, while one the owner entered or edited is kept; the calendar derivation runs again.
- **Why:** the old lines belong to another player; STA-03 already requires the full recalculation.
- **Owner review:** no

### CL-JOU-12 — Reasons offered for each transition

- **Affects:** JOU-15, H-JOU-06
- **Problem:** the optional reason list applies to every change, including reactivation, where only "other" fits.
- **Ruling:** pausing and withdrawing offer the five optional reasons of JOU-15; reactivating offers none, and its history line has no reason.
- **Why:** none of the listed reasons describes a reactivation.
- **Owner review:** no

### CL-JOU-13 — Comparing name variants

- **Affects:** JOU-09, JOU-08, CA-JOU-06
- **Problem:** "a variant appears only once per player" and "identical to another player's" do not say how variants are compared, while JOU-08 treats accented and unaccented forms as distinct variants.
- **Ruling:** two variants are the same when they are equal after Unicode NFC normalization, trimming, collapsing inner spaces to one, and case folding; accents and other diacritics stay significant. A variant equal to one of the same player's is refused at entry with a message; one equal to another player's is accepted with the warning of JOU-09.
- **Why:** case never distinguishes two names in the press; accents can, and JOU-08 keeps both forms on purpose.
- **Owner review:** no

### CL-JOU-14 — Backtest state with a full redo

- **Affects:** JOU-25, BKT-09
- **Problem:** the backtest state lists none, request to do, imported, supplementary request to do, but not the full redo.
- **Ruling:** the backtest state shows the player's to-do request with its kind: "request to do" (initial), "supplementary request to do" or "full redo to do", each with the next-game deadline; after an import it shows "imported" with the date and the covered types, as written.
- **Why:** a player has at most one to-do request, and its kind matters to the owner.
- **Owner review:** no

### CL-JOU-15 — Current season and missed games

- **Affects:** JOU-02, JOU-21, JOU-22, STA-46, STA-48
- **Problem:** the indicators do not say how they behave in the off-season or when a player is traded during an absence.
- **Ruling:**
  - JOU-02 covers the season in progress (from its first regular-season game to its last playoff game, STA-48) and, between seasons, the last season played; the indicator names the season it covers.
  - The date of the last game played covers every official game.
  - The consecutive team games missed are the official games of the team the player belonged to at each game date, counted since his last game played: after a trade the new team's games count from his arrival, games before his arrival or after his departure never count (07 « Cas limites »), the count carries over the off-season, and nothing is added while he has no team. JOU-22's suggestion uses this count.
- **Why:** a long absence often spans a season end or a trade; the indicator must stay meaningful there.
- **Owner review:** no

### CL-JOU-16 — Day and month of birth

- **Affects:** JOU-08, JOU-11, JOU-25; record 0015
- **Problem:** JOU-11 would add "le seul jour anniversaire" if Q-TAX-01 went to the calendar, without saying whether the year is excluded or where the value comes from.
- **Ruling:** the identity gains one optional field, the day and month of birth, never the year (record 0015).
  - It is filled from the statistics source when a mapping is confirmed and the source gives a date of birth, only if the field is empty: the adapter keeps the day and month and drops the year before anything is stored, shown or logged. The application never overwrites it afterwards, except as CL-JOU-11 says.
  - The owner can enter, correct or remove it. Before saving, the screen shows how many birthday events and cases the change adds and drops; the derivation then runs again (CL-TAX-19). Events of games that no longer qualify are deleted with their cases; this is not a withdrawal: no fingerprint, no counter.
  - The player page shows it as day and month ("14 March"); when it is missing, the page and the birthday profile say "birthday not recorded: no birthday events".
- **Why:** the owner agreed to this one exception to JOU-11; removing the value must not leave events whose dates reveal it.
- **Owner review:** yes — removing or correcting the birthday deletes the birthday cases it no longer supports, without counting them as withdrawals.

### CL-JOU-17 — Birthday on 29 February

- **Affects:** JOU-08, CL-TAX-18; register open point "Birthday on 29 February"
- **Problem:** a 29 February birthday has no date in three years out of four.
- **Ruling:** a player born on 29 February has birthday events only for games played on 29 February, local date at the venue; in other years he has none.
- **Why:** the simplest rule that never invents a birthday; recommended handling of record 0015.
- **Owner review:** yes — such a player has a birthday case at most once every four years.

### CL-JOU-18 — Former teams come from box scores of covered seasons

- **Affects:** JOU-11, JOU-13, STA-08, STA-45; record 0015; register open point "Former teams known only from seasons the source does not cover"
- **Problem:** former teams were to be added to the identity; record 0015 derives them from box scores, which exist only for covered seasons.
- **Ruling:** former teams are never entered nor stored in the identity. At each derivation they are read from the stored box scores of covered seasons: a team for which the player played at least one official game with minutes, his stint with it ending at his last official game played for it. Teams are identified by the statistics source's stable team identifier, so a franchise that moved or was renamed stays one team when the source keeps its identifier. A team the player left during a season the source does not cover stays unknown and its reunions are missed; a first meeting is derived only when every season from the departure to that game is covered. The former-team profile carries a permanent mention that its team history starts with the first covered season, which it names.
- **Why:** the box scores are the only automatic evidence of a player's teams; the mention keeps the limit visible.
- **Owner review:** yes — reunions with teams left before the first covered season are missed, and the profile says so.

### CL-JOU-19 — Storing the exposure indicator

- **Affects:** JOU-03, DET-57, H-JOU-08
- **Problem:** the indicator must survive the article purge, which needs counts stored apart from articles.
- **Ruling:** per player and per day of the owner's time zone, the prefilter (04) stores the number of distinct collected articles that cite him; an article counts once per player whatever the number of variants matched or prefilter passes. These daily counts hold no title, link or article reference, survive the purge, are kept 90 days (the upper bound of the period parameter, CL-TRV-16) and are erased with the player's data. The indicator adds up the days of the configured period ending today.
- **Why:** counts alone carry no press content (DSN-09) and are enough for the indicator.
- **Owner review:** no

### CL-JOU-20 — A player without a team

- **Affects:** JOU-08, STA-25, STA-26
- **Problem:** JOU-08 makes the current team mandatory, while 07 knows a "player without a team".
- **Ruling:** at addition the current team is required, chosen among the NBA teams. Afterwards it can become "without team", when the source reports a release (STA-25) or when the owner sets it; the page then shows "without team", the next game is none with the reason "player without a team" (STA-26) and the missed-games count stops growing (CL-JOU-15).
- **Why:** a followed player can be released mid-season; the data must be able to say so.
- **Owner review:** no

### CL-JOU-21 — One mapping per statistics source

- **Affects:** JOU-10, STA-03; record 0012 (open point "Two combined statistics sources")
- **Problem:** if two sources are combined to reach further back, one mapping per player is not enough.
- **Ruling:** when two statistics sources are in use, a player has one mapping per source, each confirmed by the owner through the JOU-10 flow with that source's candidates; uniqueness holds per source; nothing is fetched from a source before that source's mapping is confirmed; "mapping to establish" is shown per source. Which source serves which season is set in the statistics service sheet (record 0012, recommended handling).
- **Why:** each source has its own identifiers; the owner confirms identities, never the application.
- **Owner review:** no

### CL-JOU-22 — No real player in the repository

- **Affects:** JOU-06, CA-JOU-04; records 0006 and 0020
- **Problem:** the list is not designated (Q-03) and the repository is public.
- **Ruling:** as decided: the application starts with no player and offers no suggestion list; seeds, fixtures, tests, examples and screenshots use invented players ("Player A") and `.example` addresses, never a real NBA player.
- **Why:** records 0006 and 0020.
- **Owner review:** no

### CL-JOU-23 — Calendar-derived types on the player page and in the list

- **Affects:** JOU-25, JOU-28; record 0015
- **Problem:** JOU-25 shows "type not covered by the backtest" for every type outside the coverage, which calendar-derived types never enter.
- **Ruling:** the profile summary lists calendar-derived types like the others and never marks them "type not covered by the backtest"; the backtest state's covered types never include them; the total of valid cases in the list (JOU-28) includes calendar-derived cases; the identity shows the day and month of birth (CL-JOU-16).
- **Why:** their history comes from statistics alone (record 0015).
- **Owner review:** no

### CL-JOU-24 — Player key of a fingerprint, and player deletion

- **Affects:** JOU-08, JOU-24; record 0017; register open point "Player key of a fingerprint, and deletion of a player's data"
- **Problem:** the fingerprint of a withdrawn event needs a player key, and a deleted player's events would leave fingerprints nothing can match.
- **Ruling:** the player key of a fingerprint is the application's player identifier (JOU-08, CL-JOU-09), never a name or variant. Deleting a player's data creates no event fingerprint, since no future event can carry his identifier; it creates one deleted-player entry instead — a keyed hash of his identifier with its creation instant, same secret and same lifetime as fingerprints (CL-DSN-06, CL-DSN-07) — used only to delete him again after a restore (CL-TRV-06). Fingerprints left by his earlier withdrawals expire normally.
- **Why:** the recommended handling of record 0017, plus the minimum a restore needs for the deletion to hold.
- **Owner review:** yes — a deletion leaves one unreadable entry for the fingerprint horizon.

## Ruled elsewhere

- **A result bearing a deleted player's identifier** — owned by 06: IMP-07 settles it (lookup by identifier, then by name, attachment offered, never automatic); no change needed.
- **Missed games across trades and seasons** — owned by 07 (STA-46): recommendation, count as CL-JOU-15 says, by the player's team at each game date.
- **Distinct articles in the exposure count** — owned by 04 (DET-57): recommendation, count each article once per player, as CL-JOU-19 says.
- **Profile mentions for calendar-derived types** — owned by 08 (SEN-46): recommendation, add the former-team history mention of CL-JOU-18 and the "birthday not recorded" mention of CL-JOU-16 to the profile warnings.

## Passed to the glossary

- Player states (active, paused, withdrawn) and the five reasons of JOU-15.
- "Mapping to establish", "already followed as …", "without team".
- Team-change origins "observed" and "entered", the marks "unconfirmed" and "confirmed by the game of …".
- "Archived" for profiles of withdrawn players; "a deleted player" in journal entries.
- "Request to do", "supplementary request to do", "full redo to do", "imported".
- "Birthday not recorded: no birthday events" and the former-team history mention.
