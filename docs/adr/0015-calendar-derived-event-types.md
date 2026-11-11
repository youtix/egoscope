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

- Birthday: every official game of the player's team whose local date at the venue (SEN-02, H-SEN-02) has the player's day and month of birth. Former team: the first official game of the player's team against a former team after his departure. Preseason, exhibition and non-NBA games never count (STA-04).
- The measured game is that game, and the reference instant is its day, before kick-off. If the player does not play it, the case is « non mesurable » with a reason of its own; the skipping of SEN-03 and the delay of SEN-04 do not apply.
- Context indicators start « inconnu », so only the computed conditions of SEN-13 and SEN-14 apply unless the owner sets the indicators (H-09). Type, player and date are derived and cannot be edited.
- These events never take part in duplicate matching (IMP-25, DET-58): a calendar fact is never the same fact as a press report.

### Research, detection and screens

- These types never appear in a request, a prompt or a coverage (BKT-04, BKT-05, BKT-08, BKT-10, BKT-21, BKT-30); rule 2.5 of the prompt loses its birthday example.
- Their profiles exist from the statistics alone and never carry « type non couvert par le backtest » (SEN-46, JOU-25, IHM-23, ALE-14); their limits come from the statistics coverage ([0012](0012-statistics-coverage-gives-way.md)).
- Detection never creates an event of these types (DET-15), and the classifier does not receive them as types to classify into (DET-14, TAX-33).

## Open points

Not settled by the decision; the recommended handling is in brackets.

1. Lot 2 flow of upcoming calendar events — tracked case, frozen prognosis, alert sheet, Telegram alert (SUI-01, SUI-05, SUI-06, ALE-01, TEL-11, VUE-10). [An event created before the kick-off of its game is a tracked case recorded on time; a player who has a profile for the type gets an alert sheet, with no backtest condition; an event derived for a game already started is historical.]
2. When an upcoming event is created, and how it follows schedule and team changes. [When the game becomes the player's next game (STA-26); derivation re-runs on every change of STA-28; an upcoming event whose game no longer involves the player's team is dropped before kick-off.]
3. Articles that report a birthday or a reunion must create neither an event nor a new-type proposal (DET-16, DET-34). [Tell the classifier that these types are handled by the calendar, so that such facts count as no event.]
4. A former team known only from seasons the source does not cover stays unknown, and its reunions are missed. [The former-team profile states that the team history is limited to the covered seasons.]
5. A birthday on 29 February. [Only games played on 29 February count.]
6. Withdrawing a calendar-derived event: the derivation recreates it once its fingerprint expires ([0017](0017-temporary-fingerprint-of-withdrawn-events.md)). Needs a decision.

## Alternatives considered

- The press rule, the default of Q-TAX-01: only the birthdays and reunions that a press source published before the game. Not retained.
- Sliding to the next game played when the player misses the game, as SEN-02 is written. Not retained.
- Counting every meeting with a former team, the variant left open by the annex draft. Not retained: the first game only.
