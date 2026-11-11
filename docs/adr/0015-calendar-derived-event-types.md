# 0015. Birthday and former-team events derived from the calendar

- Status: Accepted
- Date: 2026-11-11

## Context

- Q-TAX-01 ([02](../02-taxonomie-des-evenements.md)): the birthday and the game against a former team rest on the calendar and the player's career rather than on a fact the press reports. Should they be found like other types, through the press and deep research, or deduced from the calendar? In the second case, the player's identity would carry the birthday and the former teams (JOU-11), detection would need a mechanism that does not start from articles, and the prompt would stop requiring a press source the research may not find (Q-BKT-03). Without an answer, the common rule applies: an event rests on a dated press source, so only the birthdays and reunions the press noticed are kept.
- Q-BKT-03 ([05](../05-demande-de-backtest-et-prompt.md)): if Q-TAX-01 goes to the calendar, these types leave the prompt and the backtest coverage.
- Q-SEN-04 ([08](../08-sensibilite-et-verdict.md)): for a type whose measured game is by nature one precise game, SEN-02 attaches the event to that game; if the player does not play it, should the case be « non mesurable » rather than attached, as SEN-02 does, to the next game played, which has nothing to do with the event?
- Related rules: JOU-11 forbids storing a date of birth; TAX-01 and TAX-33 carry the "known in advance" mark of the dating rule; TAX-05 and TAX-12 require a reference date established by a dated press source, as D-10 and DSN-01 require of every event; SEN-02 measures a known-in-advance event on the first game played on or after its date, local date at the venue (H-SEN-02); the annex drafts « anniversaire » and « ancienne-equipe » require a press article and leave open whether every meeting with a former team counts or only the first.

## Decision

Birthday games and former-team games are deduced from the calendar, not found in the press. The app creates these events itself from the schedule: a game played on the player's birthday — only the day and month of birth are stored, an agreed exception to JOU-11 — and the first game against a former team, the team history coming from the box scores. Every such game counts. Both types leave the research prompt and the backtest coverage. If the player misses that game, the case is « non mesurable » instead of sliding to the next game played.

## Consequences

### Data

- The player's identity gains the day and month of birth (JOU-08), taken from the statistics source when it gives them, or entered by the owner. The year is never stored. A player without a recorded birthday has no birthday events, and his birthday profile says why.
- Former teams are never entered. They are the teams for which the player has a box score in a covered season (STA-08), other than his current team; his departure from a team is his last official game for it (JOU-13 history).
- Events get a third origin, calendar-derived, beside detected and historical. Such an event refers to its scheduled game instead of press sources, carries neither a research nor a detection confidence, has no precedence check, and gets a description the app writes under the rules of [13](../13-donnees-sensibles.md), for example "Player A plays on his birthday."

### Taxonomy

- The two drafts loaded at first start (TAX-15) drop the press-article criterion and get the dating rule "derived from the calendar"; the former-team draft counts the first meeting since departure only. The owner still validates both (D-12); in the TAX-12 checklist, the item on a press-dated reference date reads "established by the schedule".
- Validating or reactivating such a type derives its events over the covered seasons for every active or paused tracked player — the players who may still receive a backtest (JOU-17, JOU-19); a substantive change of its sheet re-runs the derivation. No complementary request is ever proposed for these types (TAX-20, TAX-24, TAX-32, BKT-05).

### Derivation and measurement

- Birthday: every official game of the player's team whose day — its date in US Eastern time, which stands for the local date at the venue of SEN-02 and H-SEN-02 (see Amendments) — has the player's day and month of birth. Former team: the first official game of the player's team against a former team after his departure. Preseason, exhibition and non-NBA games never count (STA-04).
- The measured game is that game, and the reference instant is its day, before tip-off. If the player does not play it, the case is « non mesurable » with a reason of its own; the skipping of SEN-03 and the delay of SEN-04 do not apply.
- Context indicators start « inconnu », so only the computed conditions of SEN-13 and SEN-14 apply unless the owner sets the indicators (H-09). Type, player and date are derived and cannot be edited.
- These events never take part in duplicate matching (IMP-25, DET-58): a calendar fact is never the same fact as a press report.

### Research, detection and screens

- These types never appear in a request, a prompt or a coverage (BKT-04, BKT-05, BKT-08, BKT-10, BKT-21, BKT-30); rule 2.5 of the prompt loses its birthday example.
- Their profiles exist from the statistics alone and never carry « type non couvert par le backtest » (SEN-46, JOU-25, IHM-23, ALE-14); their limits come from the statistics coverage ([0012](0012-statistics-coverage-gives-way.md)).
- Detection never creates an event of these types (DET-15), and the classifier does not receive them as types to classify into (DET-14, TAX-33).

## Open points

Not settled by the decision; the recommended handling is in brackets. All six were settled on 2026-11-11; the Amendments say how.

1. Lot 2 flow of upcoming calendar events — tracked case, frozen forecast, alert sheet, Telegram alert (SUI-01, SUI-05, SUI-06, ALE-01, TEL-11, VUE-10). [An event created before the tip-off of its game is a tracked case recorded on time; a player who has a profile for the type gets an alert sheet, with no backtest condition; an event derived for a game already started is historical.] **Settled as recommended** (CL-VUE-13, CL-VUE-14, CL-SUI-14, CL-ALE-13, CL-TEL-21).
2. When an upcoming event is created, and how it follows schedule and team changes. [When the game becomes the player's next game (STA-26); derivation re-runs on every change of STA-28; an upcoming event whose game no longer involves the player's team is dropped before tip-off.] **Settled as recommended** (CL-TAX-19, CL-STA-25, CL-SUI-14).
3. Articles that report a birthday or a reunion must create neither an event nor a new-type proposal (DET-16, DET-34). [Tell the classifier that these types are handled by the calendar, so that such facts count as no event.] **Settled as recommended** (CL-DET-22, CL-TAX-21).
4. A former team known only from seasons the source does not cover stays unknown, and its reunions are missed. [The former-team profile states that the team history is limited to the covered seasons.] **Settled as recommended, with a mention added on birthday profiles** (CL-JOU-18, CL-STA-24).
5. A birthday on 29 February. [Only games played on 29 February count.] **Settled otherwise**: 28 February in common years (CL-JOU-17).
6. Withdrawing a calendar-derived event: the derivation recreates it once its fingerprint expires ([0017](0017-temporary-fingerprint-of-withdrawn-events.md)). Needs a decision. **Settled** (CL-DSN-09, CL-DSN-19).

## Alternatives considered

- The press rule, the default of Q-TAX-01: only the birthdays and reunions that a press source published before the game. Not retained.
- Sliding to the next game played when the player misses the game, as SEN-02 is written. Not retained.
- Counting every meeting with a former team, the variant left open by the annex draft. Not retained: the first game only.

## Amendments

### 2026-11-11 — The game's day (CL-TRV-03, CL-TAX-18, CL-STA-14, CL-SEN-04)

- The "local date at the venue" of SEN-02 and H-SEN-02 is the game's date in US Eastern time, for the calendar-derived types and for the other types known in advance alike; no venue time zone is stored or looked up ([0028](0028-a-game-day-is-its-us-eastern-date.md)).
- For a type known in advance that is not calendar-derived — none is seeded — SEN-02 stays as written, made computable: from the event's date E, the measured game is the first game the player played whose day is E or later, if that day is at most E + 10 days (the SEN-04 parameter); otherwise the case is not measurable.

### 2026-11-11 — Which games, and when: open point 2 (CL-TAX-18, CL-TAX-19, CL-STA-25, CL-SUI-14)

- Which games: for each validated calendar-derived type and each active or paused player with a confirmed mapping, over the official games of covered seasons — every game of his team whose day has his recorded day and month of birth; for each stint with a former team, the first official game between his team and that team after his last game played for it, while he belongs to another team, one event per stint. "His team" is the team he belonged to at the game's date; whether he played is not part of the condition.
- Open point 2 is settled as recommended. Regular runs, at the end of every statistics update and, in Lot 2, of every collection-and-detection pass, derive the qualifying games started since the player's previous run, and his next game if it qualifies; each player keeps the instant of his previous run.
- Full derivations — at the validation, reactivation or substantive change of a type, and for one player at a change of his birthday, of his statistics mapping or of his team history — cover games already started only; upcoming events always come from regular runs.
- Every regular run re-checks the upcoming events: one whose game no longer qualifies — date or opponent changed, game canceled, player no longer with that team, birthday or team history corrected — is deleted with its case before tip-off and never counts. A deletion by the derivation is not a withdrawal: no fingerprint, no counter; each creation and deletion is journaled.

### 2026-11-11 — Lot 2 flow of upcoming events: open point 1 (CL-VUE-13, CL-VUE-14, CL-SUI-14, CL-ALE-13, CL-TEL-21)

- Settled as recommended: a calendar-derived event created before its game's scheduled start gives a tracked case, recorded on time; one created at or after that start gives a historical case, which builds profiles and never tests.
- In Lot 2, an upcoming event of an active player goes through steps 8 to 10 with no backtest condition and no coverage mention: an alert sheet, whether or not the player is profiled; a forecast frozen at tip-off; the measured case in the profile and the validation table; the Telegram messages, which designate the event "from the calendar" with its game. A paused player gets the tracked case without a sheet.
- These cases cannot be dismissed, and their type, player and date cannot be edited; the other post-tip-off decisions of SUI-17 can touch them.
- An upcoming event dropped before tip-off cancels its sheet when no other event remains, with the reason "event no longer applies", and the Telegram alert gets an update, except when the drop follows the owner's own change, such as a corrected birthday.

### 2026-11-11 — Articles about a birthday or a reunion: open point 3 (CL-DET-22, CL-TAX-21)

- Settled as recommended: the classifier also receives the list of the types handled by the calendar (name and definition, whatever their state), which never enter the do-not-repropose list; a fact the model reports against that list is dropped, with no event, proposal or occurrence.

### 2026-11-11 — Former teams and covered seasons: open point 4 (CL-JOU-18, CL-STA-24)

- Settled as recommended: former teams come only from the stored box scores of covered seasons, identified by the source's stable team identifier; a first meeting is derived only when every season from the departure to that game is covered. The former-team profile carries a permanent mention that its team history starts with the first covered season, which it names.
- Added: a birthday profile says that birthday games are counted from the first covered season when the player's career may start before it.

### 2026-11-11 — Birthday on 29 February: open point 5 (CL-JOU-17)

- Departs from the recommendation: for a player born on 29 February, the birthday falls on 29 February in a leap year and on 28 February in any other year.

### 2026-11-11 — Withdrawing a calendar-derived event: open point 6 (CL-DSN-09, CL-DSN-19)

- Settled: a calendar-derived event can be withdrawn like any event (DSN-26), with a fingerprint ([0017](0017-temporary-fingerprint-of-withdrawn-events.md)). Regular runs never revisit a derived game and every derivation checks the fingerprints first, so only a full derivation run after the fingerprint's horizon can bring a withdrawn event back. The withdrawal screen says so, and names the permanent alternative: excluding its case by hand (SEN-17).

### 2026-11-11 — The type lifecycle (CL-TAX-20)

- The "derived from the calendar" mark of the two seeded types is fixed at seeding: it cannot be removed from them or given to another type. These types take part in no merge and no split.
- Withdrawing such a type stops the derivation from creating its events; every existing event and pending case is kept, still measured, and counts only in the type's archived profiles and trend (TAX-31). Reactivation runs a full derivation.

### 2026-11-11 — The birthday and the profiles (CL-JOU-16, CL-JOU-11, CL-SEN-25, CL-SEN-26)

- The birthday comes from the statistics source when a mapping is confirmed and the field is empty — the adapter drops the year before anything is stored, shown or logged — or from the owner, who can enter, correct or remove it. A mapping change replaces only a birthday the source gave.
- A correction re-derives the player's birthday events: those that no longer qualify are deleted with their cases and journaled, and those whose game had already started count among the profile's exits, as a number without date or game, with the reason "no longer derived from the calendar".
- While the birthday type is validated, a player without a recorded birthday has a birthday profile with an empty tally that says why.

### 2026-11-11 — Every such game counts (CL-DSN-06)

- The derivation checks the fingerprints on the derived game's exact day, never over a window, so a withdrawal never keeps another qualifying game of the same player and type from being derived.
