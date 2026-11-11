# Specification clarifications

The French functional specs in `docs/` leave points unclear, contradict one another in places, and were written before the owner's decisions of 2026-11-11. The sixteen files of this folder hold the rulings that settle those points, one file per spec file. Implementation agents read them next to the French specs, the decision records (`docs/adr/`) and the deviations register (`docs/engineering/spec-deviations.md`); French terms map to English through `docs/engineering/glossary.md`.

## How the rulings work

### Ranking

1. **The French specs** in `docs/` are the reference. They are never edited.
2. **The owner's decisions** — the decision records, the deviations register and the planning rulings of the orchestrator — change the specs where they say so and rank above every ruling.
3. **The rulings** settle what the specs leave unclear, inside the specs and the decisions. A ruling overrides a spec's text only where it says so, and only for the point it rules. Where a ruling goes beyond a decision record, it is listed under [Rulings that amend a decision record or a spec hypothesis](#rulings-that-amend-a-decision-record-or-a-spec-hypothesis), and the record is amended from that list.

Between spec files, the file that owns a notion wins over one that uses it, a requirement over an example, a specific rule over a general one (CL-JRN-01).

### One owner per rule

Each rule has one owner: the clarification file of the spec file that defines the requirement. Other files point to the owner's ruling and never restate it differently. The "Ruled elsewhere" section that closes a file lists the points it uses but does not own, each with the owner ruling.

### Citing a ruling

- A ruling is cited by its ID, `CL-<PREFIX>-nn`, with the prefix of its spec file: VUE, JOU, TAX, COL, DET, BKT, IMP, STA, SEN, ALE, SUI, TEL, IHM, DSN, TRV and JRN (file 90).
- Code, tests and pull requests cite the requirement ID and the ruling together, for example `SEN-33, CL-SEN-25`. A test of a ruling names both.
- IDs are never renumbered or reused. A ruling that no longer stands keeps its ID, and its title says "Withdrawn — see CL-…"; none is withdrawn today.

### Words used in the rulings

- **Affects, Problem, Ruling, Why, Owner review**: the fields of every ruling.
- **"As written"**: the spec settles the point; the ruling only states the reading. **"As decided"**: the ruling applies a decision record or a planning ruling.
- **Owner review: yes**: the ruling settles a question the owner may want to decide otherwise; the app is built as ruled meanwhile (list below). **Owner review: no**: nothing to ask.
- **Ruled elsewhere**: points owned by another file, each pointing to its owner ruling. **Passed to the glossary**: terms the glossary must name.
- **Tip-off** is the game's scheduled start as last known (CL-SEN-23, CL-SUI-13). **A game's day** is its date in US Eastern time (CL-TRV-03).

## The files

| Spec file | Clarification file | Rulings | Owner review |
| --- | --- | --- | --- |
| [00 Vue d'ensemble](../../00-vue-d-ensemble.md) | [00-overview.md](00-overview.md) | 15 | 2 |
| [01 Joueurs suivis](../../01-joueurs-suivis.md) | [01-followed-players.md](01-followed-players.md) | 24 | 5 |
| [02 Taxonomie des événements](../../02-taxonomie-des-evenements.md) | [02-event-taxonomy.md](02-event-taxonomy.md) | 22 | 3 |
| [03 Collecte des actualités](../../03-collecte-des-actualites.md) | [03-news-collection.md](03-news-collection.md) | 23 | 4 |
| [04 Détection des événements](../../04-detection-des-evenements.md) | [04-event-detection.md](04-event-detection.md) | 28 | 7 |
| [05 Demande de backtest et prompt](../../05-demande-de-backtest-et-prompt.md) | [05-backtest-request-and-prompt.md](05-backtest-request-and-prompt.md) | 25 | 0 |
| [06 Import des résultats de recherche](../../06-import-des-resultats-de-recherche.md) | [06-research-result-import.md](06-research-result-import.md) | 34 | 5 |
| [07 Statistiques de match](../../07-statistiques-de-match.md) | [07-game-statistics.md](07-game-statistics.md) | 28 | 4 |
| [08 Sensibilité et verdict](../../08-sensibilite-et-verdict.md) | [08-sensitivity-and-verdict.md](08-sensitivity-and-verdict.md) | 27 | 7 |
| [09 Fiche d'alerte](../../09-fiche-d-alerte.md) | [09-alert-sheet.md](09-alert-sheet.md) | 15 | 3 |
| [10 Suivi automatique et validation](../../10-suivi-automatique-et-validation.md) | [10-automatic-tracking-and-validation.md](10-automatic-tracking-and-validation.md) | 15 | 5 |
| [11 Notifications Telegram](../../11-notifications-telegram.md) | [11-telegram-notifications.md](11-telegram-notifications.md) | 23 | 4 |
| [12 Interface et accès](../../12-interface-et-acces.md) | [12-interface-and-access.md](12-interface-and-access.md) | 22 | 1 |
| [13 Données sensibles](../../13-donnees-sensibles.md) | [13-sensitive-data.md](13-sensitive-data.md) | 21 | 5 |
| [14 Exigences transverses](../../14-exigences-transverses.md) | [14-cross-cutting-requirements.md](14-cross-cutting-requirements.md) | 23 | 7 |
| [90 Journal des décisions](../../90-journal-des-decisions.md) | [90-decision-journal.md](90-decision-journal.md) | 11 | 0 |
| **Total** | | **356** | **62** |

## Owner review

The app is built as each ruling says. The owner may answer any row differently; the last column says what changes then.

| Ruling | Question | Meanwhile | If the owner decides otherwise |
| --- | --- | --- | --- |
| CL-VUE-13 | Should birthday and first-reunion games derived before tip-off test the hypothesis as tracked cases? | Tracked when derived before the game's scheduled start, historical otherwise. | They are all historical: they build profiles and never test. |
| CL-VUE-14 | Should upcoming calendar-derived events go through alert sheet, frozen forecast and Telegram with no backtest condition? | They do, for active players. | They get a tracked case only, with no sheet or message. |
| CL-JOU-06 | Should a player-data deletion also erase his box-score lines, verdict history and journal mentions? | It erases all of it and keeps one deleted-player entry. | Those data stay after the deletion. |
| CL-JOU-16 | Should a corrected or removed birthday delete the birthday events it no longer supports, outside the withdrawal counter? | Deleted and journaled; those already played count among the profile's exits, without dates. | They are kept, or withdrawn with fingerprints and the counter. |
| CL-JOU-17 | Should a player born on 29 February have his birthday games on 28 February in common years? | Yes; 29 February in leap years. | Only games played on 29 February count (record 0015's recommendation). |
| CL-JOU-18 | Is it acceptable that reunions with teams left before the first covered season are missed? | Missed, and the former-team profile says so. | Former teams must be entered by hand, against record 0015. |
| CL-JOU-24 | Should a player-data deletion leave a keyed deleted-player entry for the fingerprint horizon? | Yes; a restore deletes him again. | No entry: a restore within the horizon brings him back. |
| CL-TAX-16 | Should the illustration sources of a type proposal be erased at the owner's decision? | Erased when the proposal is validated or rejected. | They stay with the type. |
| CL-TAX-18 | Should every birthday game and first reunion count, a missed one giving a not-measurable case? | Yes, with or without press coverage. | Only games the player played, or the press noticed, give cases. |
| CL-TAX-19 | Is it acceptable that upcoming calendar events appear at the next-game stage and vanish before tip-off if the game moves? | Created by regular runs for the next game, dropped before tip-off. | Created earlier (more churn), or kept after a schedule change. |
| CL-COL-02 | Should an article dated without a time be public at the end of its day in the outlet's zone or at UTC−12, capped at first collection? | Yes; this instant is the detected event's reference. | Another zone, such as Pacific time, moves displayed instants and, rarely, the measured game. |
| CL-COL-05 | When every active source fails in one run, should only "collection impossible" open, without counting the run against any source? | Yes, with two or more active sources. | Each source also counts the failure and can go "down". |
| CL-COL-16 | Should an article matching a withdrawal be erased at once, even if it is then collected and classified again? | Yes; the quota cost is accepted. | A skip trace saves quota but designates the withdrawn event. |
| CL-COL-17 | With two runs a day, should "down" still mean two consecutive failed runs? | Yes, 6.5 to 17.5 hours apart. | The failed-runs parameter (COL-41) is raised to keep two days. |
| CL-DET-01 | Should classification results be kept per article, player and fact, so a part can be rescued while the article is attached for another player? | Yes; the article state follows the strongest outcome. | One state per article, losing such rescues. |
| CL-DET-04 | Should failed classifications stop counting as waiting, so the resume task and the quota incident can end? | Yes; the owner retries them. | They are retried automatically and keep the incident open. |
| CL-DET-06 | Should "dating to verify" compare the article's precedence date with games from 00:00 of that date in the outlet's zone, or US Eastern time? | Yes. | Another frame sets the mark on more or fewer events. |
| CL-DET-10 | Should a "possible duplicate of a historical event" stay in the to-do list until lifted or dismissed? | Yes; the case counts meanwhile. | The mark stays silent, at the risk of a fact counted twice. |
| CL-DET-15 | Should a case dismissed after its expected game's tip-off still be measured, outside every calculation? | Yes, for the table's separate count. | Its gap is lost. |
| CL-DET-21 | Should detection skip the fingerprint check for events the owner creates, and match within the IMP-25 window? | Owner-made events are not checked; ±2 days by default. | Owner-made events are blocked too, or matching is exact-day. |
| CL-DET-22 | Should facts reported against the calendar-handled list be dropped without event, proposal or occurrence? | Yes, with no resubmission. | They are resubmitted, or become proposals to reject. |
| CL-IMP-08 | Should the import accept date forms the format excludes and read every AI midnight as "no time"? | Yes, with warnings. | Those dates are rejected, or midnights are taken literally. |
| CL-IMP-09 | Should an event outside its own type's requested period be ignored, even inside the request's overall period? | Yes. | It is imported though its type's search did not cover it. |
| CL-IMP-12 | Should "2 days apart" be counted in calendar days, every zone allowed for a timed value? | Yes. | A wider reading merges more distinct facts by default. |
| CL-IMP-13 | Should events of different types citing one article be a possible duplicate for the owner, not a duplicate? | Yes. | They are merged by default, losing a fact. |
| CL-IMP-28 | Should the save confirmation count recorded events that match a withdrawal, and recording one erase its fingerprints? | Yes. | The fingerprint stays after the owner records the fact. |
| CL-STA-04 | Should a case whose first game after the event has no box score be not measurable rather than slide? | Yes. | Cases slide past such games and may measure the wrong one. |
| CL-STA-06 | Is it acceptable that whole minutes round every index by up to 30 seconds and let 14 min 30 s pass the 15-minute floor? | Yes. | A tolerance, or a source in seconds, is needed. |
| CL-STA-18 | In older playoffs whose series cannot be rebuilt, should elimination games stay unflagged, stakes "not evaluable"? | Yes. | Such cases are excluded by hand, or whole series count as high stakes. |
| CL-STA-24 | Is it acceptable that birthday and former-team profiles miss games the app cannot see, and say so? | Yes. | Missing data must come from another source or by hand. |
| CL-SEN-02 | Should a detected article without a time keep the cautious instant of collection instead of SEN-01's end of day in Pacific time? | Yes; SEN-01 serves date-only historical events. | Expected and measured games may differ for detected events. |
| CL-SEN-09 | Should return-from-injury absences be counted within the measured game's season only? | Yes. | Absences at the end of the previous season count too. |
| CL-SEN-11 | Is it acceptable that the ejection review flag never appears with the chosen source? | Yes; the Method and limits page says so. | A source that reports ejections is needed. |
| CL-SEN-12 | When a correction changes the measured game, should earlier manual decisions stop applying until confirmed? | Yes, with a review flag. | Decisions carry over to the new game. |
| CL-SEN-17 | Should the verdict history get three causes the spec does not list? | Yes. | Those changes go under an existing cause, often « recalcul ». |
| CL-SEN-18 | Is it acceptable that a verdict-history entry dated at a withdrawal can hint that something left that profile? | Yes; it carries « recalcul » only. | Entries after a withdrawal are hidden, against SEN-37. |
| CL-SEN-22 | Should profiles show the remaining rejections of every request, not only the last import's? | Yes, summed. | Only the last import's rejections show. |
| CL-ALE-02 | Should an article dated today without a time, collected before tonight's tip-off, have tonight's game as expected game? | Yes; CA-ALE-21 is tested with a later first collection. | Tonight's game always gives way to the next one. |
| CL-ALE-03 | Should the direction caveat use one sentence for both directions? | Yes. | ALE-16's two wordings are used. |
| CL-ALE-13 | Should upcoming calendar-derived events get alert sheets, profiled player or not? | Yes, for active players and validated types. | No sheet, or sheets for profiled players only. |
| CL-SUI-02 | Should the overall row hold every testing case, its assessment using the cases with a forecast? | Yes. | It holds forecast cases only. |
| CL-SUI-05 | Should a late forecast wait until the pair's historical data is complete? | Yes. | It may be frozen on a partial import. |
| CL-SUI-06 | Should a game measured for two types count twice in the player and overall rows? | Yes, marked co-occurring. | Each game counts once. |
| CL-SUI-11 | Should withdrawn players' and types' rows stay in an archived part of the table? | Yes; their cases stay in the overall row. | Withdrawing after seeing results changes the table. |
| CL-SUI-14 | Should upcoming calendar-derived events be tracked cases that cannot be dismissed? | Yes. | As for CL-VUE-13. |
| CL-TEL-07 | Once the daily cap is reached, should the day's later messages, urgent ones included, be dropped? | Yes; their facts stay in the app. | They are sent the next day. |
| CL-TEL-08 | Should an incident's end message wait for the recurrence delay? | Yes, 6 hours by default. | It leaves at once, possibly before a new outage. |
| CL-TEL-09 | Should the list of messages Telegram refused to delete be shown once and never kept? | Yes. | A stored list becomes a trace of the withdrawal. |
| CL-TEL-21 | Should the owner get Telegram alerts for upcoming birthday and first-reunion games? | Yes; nothing after his own birthday change. | No message for these events. |
| CL-IHM-19 | Should every link to an erased item open the same "This item no longer exists" page? | Yes. | Some causes are explained, at the risk of designating a withdrawn event. |
| CL-DSN-04 | Is it acceptable that the withdrawn-events counter counts decisions, so one fact can count twice? | Yes; the page says so. | Each fact needs a trace, against DSN-29. |
| CL-DSN-07 | Should fingerprints live as long as the backups that may hold the event, possibly beyond eight weeks? | Yes. | They go at eight weeks, even while an older backup holds the event. |
| CL-DSN-08 | Should fingerprints stay out of backups, so a restore into a new database without the old one cannot re-apply withdrawals? | Yes. | Backups carry fingerprints past their horizon. |
| CL-DSN-09 | Is it acceptable that a withdrawn birthday or reunion event can come back through a full derivation after the horizon? | Yes; excluding its case is the permanent way. | The derivation needs a permanent memory of withdrawals. |
| CL-DSN-19 | Is the list of limits on the withdrawal confirmation acceptable? | The screen states it. | The wording changes. |
| CL-TRV-02 | Is it acceptable that a game's local time at the venue, which TRV-71 and CA-TRV-36 mention, is never shown? | Paris time and the US-date recall only. | A venue time-zone table is needed, which the planning ruling excludes. |
| CL-TRV-05 | After a restore into a new database, should the owner log in with the initial password and set a new one? | Yes; backups hold no password data. | Backups carry the password hash. |
| CL-TRV-06 | Should a restore re-apply withdrawals and deletions by itself and list the ambiguous cases? | Yes. | Restored data can bring withdrawn events back. |
| CL-TRV-11 | Should the owner only hide incidents, never close them? | Yes; incidents close when their cause ends. | A manual close ends an incident whose cause lasts. |
| CL-TRV-14 | At a statistics-source replacement, should the season in progress be fetched again whole, consolidated games included? | Yes; every differing value is traced as a correction. | That season's baselines mix two sources. |
| CL-TRV-16 | Are the parameter bounds acceptable, the password length at least 12? | Values outside are refused. | Bounds are widened. |
| CL-TRV-23 | Should the daily statistics update start at 15:00, probe hourly and stop at 20:00 with "source late"? | Yes; two late days open an incident. | At 12:00 (H-TRV-07) it misses the previous night on most days. |

## Rulings that amend a decision record or a spec hypothesis

Each row is an amendment to make to the record or to read into the hypothesis. "Open point" refers to the numbered open points of a record, which these rulings settle.

| Record or hypothesis | Rulings | What changes |
| --- | --- | --- |
| Record 0010 (register row CA-TRV-36) | CL-TRV-02, CL-IHM-07 | A game's local time at the venue is never shown; CA-TRV-36 expects "Wednesday 11 November 2026, 04:30 Paris time — Tuesday evening in the US". |
| Record 0012, open point | CL-STA-23, CL-JOU-21 | Settled as recommended: one source per season, assigned in the service sheet; one confirmed mapping per player and source. |
| Record 0012 | CL-TRV-14, CL-STA-23 | New: at a source replacement, the season in progress is fetched again whole from the new source, consolidated games included (exception to STA-42), as a forced refetch (STA-44) whose differences are traced as corrections. |
| Record 0013, open point | CL-IMP-07 | Settled as recommended: a citation marker inside a text value gives the warning "possible citation marker in {field}", never a rewrite; in a link the source is dropped; in a limitation, a whole-result warning. |
| Record 0015, Derivation and measurement; H-SEN-02 and register row SEN-02 | CL-TRV-03, CL-TAX-18, CL-STA-14, CL-SEN-04 | "Local date at the venue" is the game's date in US Eastern time, for calendar-derived types and the other types known in advance alike; no venue time zone is stored. |
| Record 0015, open point 1 | CL-VUE-13, CL-VUE-14, CL-SUI-14, CL-ALE-13, CL-TEL-21 | Settled as recommended: tracked when derived before the game's scheduled start; alert sheet for active players with no backtest condition; paused players get the tracked case without sheet; never dismissed; a drop before tip-off cancels the sheet and sends an alert update, except after the owner's own change. |
| Record 0015, open point 2 | CL-TAX-19, CL-STA-25, CL-SUI-14 | Settled as recommended: regular runs at the end of every statistics update and every collection pass derive the games started since the player's previous run and his next game; full derivations cover started games only; an upcoming event whose game no longer qualifies is dropped before tip-off. |
| Record 0015, open point 3 | CL-DET-22, CL-TAX-21 | Settled as recommended: the classifier gets a list of the types handled by the calendar; facts reported against it are dropped. |
| Record 0015, open point 4 | CL-JOU-18, CL-STA-24 | Settled as recommended, plus a birthday-profile mention when the career may start before the first covered season. |
| Record 0015, open point 5 | CL-JOU-17 | Departs from the recommendation: a 29 February birthday falls on 28 February in common years. |
| Record 0015, open point 6; record 0017, open point 6 | CL-DSN-09, CL-DSN-19 | Settled: calendar-derived events can be withdrawn like any event; regular runs never revisit a derived game; only a full derivation after the fingerprint horizon can bring one back, which the withdrawal screen states; excluding the case is the permanent alternative. |
| Record 0015, Taxonomy | CL-TAX-20 | A withdrawn calendar-derived type keeps every event and pending case (TAX-31) and gets no new event; the two types take part in no merge or split; their "derived from the calendar" mark is fixed at seeding. |
| Record 0015, Data | CL-JOU-16, CL-JOU-11, CL-SEN-25, CL-SEN-26 | The birthday comes from the source (year dropped first) or the owner; a mapping change replaces only a source-given one; a correction re-derives and deletes the events that no longer qualify, journaled, those already played counting among the profile's exits; a player without a birthday has an empty birthday profile that says why. |
| Record 0015, "every such game counts" | CL-DSN-06 | The derivation checks fingerprints on the derived game's exact day, so a withdrawal never blocks another qualifying game within the window. |
| Record 0017, Decision ("kept eight weeks") | CL-DSN-07 | The horizon is the backups kept times the backup interval, eight weeks by default; a fingerprint is erased only when older than the horizon and older than every listed backup; nothing is erased while the backup register is in doubt (open point 5, beyond the recommendation). |
| Record 0017, Consequences (key and content) | CL-DSN-06 | HMAC-SHA-256 of the player identifier, type identifier and day; the day is the date as written without a time, otherwise the instant's date in the owner's time zone; created by withdrawals of every origin and nothing else; checked by detection, the derivation, every import preview and every restore; recording a flagged event erases the fingerprints it matches; a new secret makes old fingerprints unmatchable. |
| Record 0017, open point 1 | CL-DSN-06, CL-DET-21, CL-IMP-28, CL-IMP-34 | Settled as recommended: day precision over ±2 days, the IMP-25 window, at import and detection; detection checks only model-origin facts that would create an event, before DET-58. |
| Record 0017, open point 2 | CL-JOU-24 | Settled as recommended (the app's player identifier), plus a deleted-player entry with the same secret and lifetime so a restore deletes the player again. |
| Record 0017, open point 3 | CL-DSN-08, CL-TRV-05 | Settled as recommended: fingerprints and deleted-player entries form the withdrawal ledger, kept out of backups and exports; the counter's value goes into each backup and full export. |
| Record 0017, Consequences ("restoring a backup can still bring the event back"); register rows DSN-28, IHM-68 | CL-TRV-06, CL-DSN-08, CL-DSN-19 | A restore never overwrites the ledger and re-applies it: the single restored event on a fingerprint's day is withdrawn again, deleted players are deleted again, ambiguous matches are listed in the restore summary (a second place, besides the import preview, that points at a withdrawn event); impossible for a restore into a new database without the old one; the counter keeps the larger value. |
| Record 0017, open point 4 | CL-COL-16, CL-DSN-10 | Settled as recommended: a matching article is erased at once, with no skip trace; re-collection costs are accepted. |
| Record 0017, Consequences (import flag, counter) | CL-IMP-28, CL-DSN-04 | The flag reads "matches an event you withdrew" with the choice "don't record — sensitive data"; the save confirmation counts the flagged events recorded; every decline counts, flagged or not; a restore's re-application does not count. |
| Record 0018 (register row TRV-51) | CL-TRV-05 | Settled: backups hold no drafts (server copies included), no withdrawal ledger, no password data, no sessions. |
| H-TRV-07 and TRV-25 (statistics at 12:00) | CL-TRV-23, CL-STA-10 | The update starts at 15:00, probes the source every 60 minutes, at 20:00 fetches what is published and ends "source late"; the "statistics source unavailable" incident opens after 2 consecutive late competition days. Cut-off, probe interval and late days are new parameters. |
| H-STA-11 | CL-STA-14, CL-TRV-03 | A game whose time is to be determined is deemed to start at 00:00 US Eastern time on its date. |
| H-SEN-01 | CL-SEN-02 | The end-of-day Pacific rule serves historical events whose public date has no time; a detected event keeps the instant DET-30 records (CL-COL-02). |
| H-IMP-02 (window) | CL-IMP-34 | The same parameter also sets detection's "possible duplicate" mark and the fingerprint checks at import and detection. |

Register rows whose open point a ruling settles: DET-14 (CL-DET-22), BKT-30 (CL-VUE-14, CL-ALE-13), IMP-04 (CL-IMP-07), STA-03 (CL-STA-23), TRV-51 (CL-TRV-05); and the register's "Open points" table, every row of which is settled above.

## Storage consequences

Each line names something a ruling requires the app to store that the specs do not name.

- CL-VUE-12, CL-DSN-20: the event origin "calendar-derived" and, on such an event, a reference to its scheduled game instead of sources.
- CL-JOU-03: on a team change entered by hand, its entry instant, the origin "entered" and the mark "unconfirmed" or "confirmed by the game of …".
- CL-JOU-16, CL-JOU-11: the optional day and month of birth, never the year, with whether the source or the owner gave it.
- CL-JOU-19: per player and day of the owner's time zone, the number of distinct articles citing him, kept 90 days and surviving the article purge.
- CL-JOU-21: one statistics mapping per source, each with its confirmation state.
- CL-JOU-24: deleted-player entries (keyed hash of the player identifier, creation instant) in the withdrawal ledger.
- CL-TAX-06: per sheet version, its number, date, full content, qualification, reason and effect counts; per saved change, the content before and after, its qualification and reason.
- CL-TAX-08: an event's qualification as a pair (sheet type, version number), which may name another type's sheet.
- CL-TAX-14: an optional coverage threshold on a type sheet (outlets, days).
- CL-TAX-16: illustration sources stored with their proposal until the decision.
- CL-TAX-17: the sheet field "criterion switched off" (record 0016).
- CL-TAX-19: per player, the instant of his previous derivation run.
- CL-TAX-20: the fixed "derived from the calendar" mark of the two seeded types.
- CL-COL-01: per article, the pairs (source, feed item identifier), erased with the article.
- CL-COL-04, CL-COL-14: per source, its last reactivation instant, its consecutive failed runs and the instant of its last read that brought a new article; per article, the run that first recorded it and the instant it last became « non pertinent ».
- CL-COL-07: on a collection-journal entry, the mark "with catch-up" with the sources concerned and their admitted age.
- CL-COL-12: per purge run in the activity journal, the articles deleted, excerpts erased and deduplication traces expired.
- CL-COL-19: on a source, the address a permanent redirect proposes, until the owner accepts it.
- CL-COL-20: one pending on-demand collection request per pass.
- CL-COL-21: per source and day of first collection, three counters (new, kept by the prefilter, exactly dated) that survive the purge.
- CL-DET-01: classification results per article and recognized player (parts), each fact with its outcome; the queue item holds the pending parts.
- CL-DET-03: the mark « classification en échec » per part.
- CL-DET-04: the current cause of the classification incident.
- CL-DET-06: per fact, its precedence date or none; per event, whether the owner lifted « datation à vérifier », which is then never set again.
- CL-DET-07: results of origin « utilisateur » (player, type or no event, instant, origin, the validated types at that instant).
- CL-DET-10: the lift of the « doublon possible d'un événement historique » mark, traced.
- CL-DET-12: the reason « détaché par l'utilisateur » on a detached part.
- CL-DET-14: the (player, article) pairs already counted in the exposure count.
- CL-DET-15: the dismissal instant only; the position against tip-off is derived at each display.
- CL-DET-27: waiting facts of a coverage-threshold type, with the outcome « sous le seuil de couverture », grouped per player and type.
- CL-BKT-05, CL-BKT-06: each covered period with the sheet version it was researched under; periods inherited at a split under version 0; absorbed types' coverage kept as history.
- CL-BKT-07: a request's planned types beside its requested types.
- CL-BKT-11: a yearly sequence for request references.
- CL-BKT-12: the request's "last copied" instant, set by Copy or by a completed Share.
- CL-IMP-09: each public or source date as its calendar date plus, when timed, the absolute instant and the original offset.
- CL-IMP-18: in the import trace, the recovery of a cut result and the number of events recovered.
- CL-IMP-31: with a timed correction, the time zone the owner typed.
- CL-IMP-33: the journal entry of a fully refused attempt: date, request reference, refusal category and size, nothing else.
- CL-STA-03: per game, its number of overtimes, or "unknown".
- CL-STA-16: per game, the flag "never counts" (All-Star games, NBA Cup final).
- CL-STA-17: per game, the source identifier of its make-up, as an alias.
- CL-STA-18: per playoff game, its series, game number, wins before it and an elimination flag that can be "unknown".
- CL-STA-23: per season, the source that serves it (service sheet).
- CL-SEN-12: per manual decision, the measured game it was made on; the review flag "manual decision to review: the measured game changed".
- CL-SEN-16: recalculation jobs (scope, cause, order, progress), written in the same transaction as their change; per profile, its last values and their date while a job is pending.
- CL-SEN-17: three verdict-history causes beyond the spec's seven.
- CL-SEN-25: per player and calendar-derived type, the number of events dropped after their game started, kept with the profile's exit counts, surviving the drop, with no date, game or event reference.
- CL-SEN-26: profiles whose tally holds only exits; an empty birthday profile for a player without a recorded birthday.
- CL-ALE-04: per sheet, its timing instant; each change of the « tardive » mark in the update log.
- CL-ALE-07, CL-ALE-12: frozen snapshots per section; the outcome's profile snapshot frozen at closure; each later change of gap, baseline or category in the update log with its earlier value.
- CL-SUI-03: forecast versions with their instants, from the case's creation to the measured game's scheduled start.
- CL-SUI-10: per case, its post-tip-off decisions with their kind (exit, entry, change of measured game).
- CL-TEL-07: per day of the owner's time zone, the number of messages sent; the cap message, once a day; the status « abandonné » with the reason "daily cap".
- CL-TEL-08: the pending end message of a notified incident until the recurrence delay has passed.
- CL-TEL-09: per sent message, its chat identifier and Telegram's message identifier, erased with its text.
- CL-TEL-12: the status « regroupé » pointing to its catch-up message, and the instant of the last catch-up attempt.
- CL-IHM-05: on each device, the declined time-zone offer and the zone it was declined for.
- CL-IHM-06: on each device, the last screen displayed and its scroll position.
- CL-IHM-12, CL-TRV-17: on each parameter of the register, the mark "influences calculations".
- CL-IHM-13: the hidden state of the "request in progress" banner, kept by the app for every device until the next prompt copy.
- CL-IHM-18: a version on every editable object, changed at each save.
- CL-DSN-06: fingerprints: an HMAC-SHA-256 of player identifier, type identifier and day, with its creation instant only.
- CL-DSN-07, CL-TRV-04: a backup register of the backups stored (kind, creation instant, still listed after a failed deletion) and its "in doubt" state after a failed rotation.
- CL-DSN-08: the withdrawal ledger (fingerprints, deleted-player entries, the withdrawn-events counter), outside backups and exports; the counter's value also written into each backup and full export.
- CL-DSN-17, CL-IHM-10: a draft store outside backups and exports: at most one import draft per request and one exploration draft per screen or targeted proposal, each with its text, last change instant and device.
- CL-DSN-21: journal entries saying that a birthday was entered, changed or removed, without the value.
- CL-TRV-07: per task run, its start, progress marks, end and result (succeeded, failed, interrupted).
- CL-TRV-10: journal entries made of a fixed message and references by identifier, the text being built at display; references removed when their item is erased.
- CL-TRV-12: per quota limit, its unit, period, reset instant and zone; consumption per limit and period instance; whether the warning was given in that instance.
- CL-TRV-22: the instant of the last full export downloaded, and of the first start.
- CL-TRV-23: per competition day, the update's result, "source late" included; the number of consecutive late competition days; the source's last refresh instant seen by the probe.

## Parameters set by rulings

CL-TRV-16 owns the default and the bounds of every parameter, the specs' and the rulings' alike; this table copies it. A parameter influences calculations when it belongs to files 07, 08 or 10, or is the per-type criterion switch (CL-TRV-17): changing one recalculates, moves the date shown on profiles and on the validation table, and asks the confirmation of IHM-37 (CL-IHM-12).

| Parameter | Default | Bounds | Influences calculations | Rulings |
| --- | --- | --- | --- | --- |
| Maximum active players (JOU-04) | 30 | 1 to 100 | no | CL-TRV-16, CL-JOU-10 |
| Indicative minimum (JOU-04) | 20 | 0 to 100, at most the maximum; 0 means no reminder | no | CL-TRV-16 |
| Exposure period (JOU-03) | 30 days | 1 to 90 days | no | CL-TRV-16, CL-JOU-19 |
| Prolonged absence (JOU-22) | 10 games | 1 to 82 games | no | CL-TRV-16 |
| Source-indicator period (COL-11) | 30 days | 1 to 90 days | no | CL-TRV-16, CL-COL-21 |
| Collection times (COL-12) | 16:30 and 23:00 | 1 to 6 distinct times of day, at least 60 minutes apart | no | CL-TRV-16, CL-COL-17, CL-TRV-09 (record 0019) |
| Read attempts (COL-13) | 3 | 1 to 5 | no | CL-TRV-16, CL-COL-09 |
| Maximum article age (COL-24) | 3 days | 1 to 14 days | no | CL-TRV-16 |
| Excerpt length (COL-27) | 500 characters | 100 to 1,000 | no | CL-TRV-16 |
| Title-dedup window (COL-30) | 6 hours | 1 to 72 hours | no | CL-TRV-16 |
| Dedup-trace retention (COL-34) | 180 days | 7 to 365 days, at least the maximum article age | no | CL-TRV-16 |
| Non-relevant article retention (COL-36) | 30 days | 1 to 180 days | no | CL-TRV-16 |
| Failed runs before "down" (COL-41) | 2 | 1 to 10 | no | CL-TRV-16, CL-COL-06, CL-COL-17 |
| Silence delay (COL-42) | 3 days | 1 to 30 days | no | CL-TRV-16 |
| Priority horizon (DET-09) | 48 hours | 1 to 240 hours | no | CL-TRV-16, CL-DET-13 |
| Queue resumption interval (DET-10) | 6 hours | 1 to 24 hours | no | CL-TRV-16, CL-DET-04 |
| Classification attempts (DET-22) | 2 | 1 to 5 | no | CL-TRV-16, CL-DET-03 |
| Detection threshold (DET-24) | 70 | 1 to 100 | no | CL-TRV-16 |
| Grouping window (DET-29) | 72 hours | 1 to 240 hours | no | CL-TRV-16, CL-DET-11 |
| Confidence band width (DET-25, CL-DET-24) | 10 points | 1 to 50 points | no | CL-TRV-16, CL-DET-24 (new) |
| Maximum sources per event (H-BKT-09) | 3 | 1 to 10 | no | CL-TRV-16 |
| Maximum pasted size (IMP-02) | 2 MB | 0.5 to 4 MB, step 0.5 | no | CL-TRV-16, CL-IMP-27 |
| Tolerated source lead (IMP-14) | 1 day | 0 to 7 days | no | CL-TRV-16, CL-IMP-11 |
| Disallowed domains (IMP-14) | list of H-IMP-13 | 0 to 500 domain names, lowercase, without scheme or path | no | CL-TRV-16 |
| Link check (IMP-17) | on | on, off | no | CL-TRV-16 |
| Link-check timeout (IMP-17, CL-IMP-25) | 10 seconds | 1 to 60 seconds | no | CL-TRV-16, CL-IMP-25 (new) |
| Sources offered for sampling (IMP-23) | 3 | 1 to 20 | no | CL-TRV-16 |
| Maximum gap between public dates (IMP-25) | 2 days | 0 to 7 days | no | CL-TRV-16, CL-IMP-12, CL-IMP-34 (one window for every duplicate and fingerprint check) |
| Playing-time floor (STA-14) | 15 minutes | 0 to 48 minutes | yes | CL-TRV-16, CL-STA-06, CL-STA-07 |
| Fraction of average minutes (STA-14) | 50 % | 0 to 100 % | yes | CL-TRV-16, CL-STA-07 |
| Baseline for play-in and playoffs (STA-18) | playoffs | playoffs, regular season | yes | CL-TRV-16 |
| Minimum baseline size (STA-19) | 10 games | 2 to 82 games | yes | CL-TRV-16 |
| Partial-baseline threshold (STA-24) | 20 % | 0 to 100 % | yes | CL-TRV-16 |
| Delay after the last tip-off (STA-32) | 3 hours | 1 to 12 hours | yes | CL-TRV-16, CL-STA-10, CL-TRV-23 |
| Correction window (STA-33) | 7 days | 1 to 30 days | yes | CL-TRV-16 |
| Delay before "unavailable" (STA-35) | 30 days | 1 to 365 days, at least the correction window | yes | CL-TRV-16, CL-STA-11 |
| Retry delays (STA-36) | 1 hour, then every 4 hours | first 0.25 to 24 hours, then 1 to 24 hours, step 0.25 | yes | CL-TRV-16, CL-STA-15 |
| Delay before incident (STA-37) | 12 hours | 1 to 72 hours | yes | CL-TRV-16, CL-STA-15 |
| Quota reserve (STA-39) | 10 % | 0 to 50 % | yes | CL-TRV-16, CL-STA-15 |
| Maximum attachment delay (SEN-04) | 10 days | 1 to 60 days | yes | CL-TRV-16, CL-SEN-05 |
| Concomitant cases as doubtful (SEN-06) | no | yes, no | yes | CL-TRV-16 |
| Return from injury: games missed, first games (SEN-13) | 4, 2 | 1 to 82; 1 to 10 | yes | CL-TRV-16, CL-SEN-09 |
| Every playoff game as unusual stakes (SEN-14) | no | yes, no | yes | CL-TRV-16 |
| Opponent level: low, high (SEN-15) | 25 %, 75 % | 0 to 49 %; 51 to 100 % | yes | CL-TRV-16, CL-SEN-10 |
| Opponent's minimum games (SEN-15) | 10 | 1 to 82 | yes | CL-TRV-16, CL-SEN-10 |
| Valid cases for a player verdict (SEN-23) | 5 | 2 to 100 | yes | CL-TRV-16, CL-SEN-14, CL-SEN-20 |
| Signal-to-noise for "possible", "probable" (SEN-23) | 2, 3 | 0.5 to 10, step 0.1; "probable" at least "possible" | yes | CL-TRV-16, CL-SEN-20, CL-SUI-07 (also the assessment factor) |
| Mean gap for "possible", "probable" (SEN-23) | 0.25, 0.40 | 0 to 5, step 0.01; "probable" at least "possible" | yes | CL-TRV-16 |
| Profile confidence: medium from, high from (SEN-25) | 8, 15 cases | 1 to 200; 2 to 500, above medium | yes | CL-TRV-16 |
| Dispersion drop (SEN-25) | 1.5 | 0.1 to 10, step 0.1 | yes | CL-TRV-16 |
| Doubtful-share drop (SEN-25) | 30 % | 0 to 100 % | yes | CL-TRV-16 |
| Trend: minimum players, top player's share (SEN-29) | 3, 50 % | 1 to 30; 1 to 100 % | yes | CL-TRV-16 |
| Counts instead of proportions below (SEN-39) | 20 cases | 1 to 200 cases | yes | CL-TRV-16, CL-SEN-21 |
| Vigilance margin (ALE-16) | 10 points | 0 to 100 points | no | CL-TRV-16 |
| Category threshold (SUI-22) | 0.25 | 0 to 5, step 0.01 | yes | CL-TRV-16, CL-SUI-15 |
| Minimum tracked cases for an assessment (SUI-26) | 10 | 1 to 200 | yes | CL-TRV-16, CL-SUI-08 |
| Reminder delay (TEL-10) | 6 hours | 1 to 48 hours | no | CL-TRV-16 |
| Incident reminder, incident recurrence delay (TEL-15) | 3 days, 6 hours | 1 to 30 days; 0 to 48 hours | no | CL-TRV-16, CL-TEL-08 |
| Grouping threshold, facts per grouped message (TEL-19) | 3, 10 | 1 to 20; 1 to 50 | no | CL-TRV-16 |
| Quiet hours (TEL-20) | 23:00 to 08:00 | any start and end; equal means none; may span midnight | no | CL-TRV-16 |
| Urgency exception and category switches (TEL-21, TEL-24) | on | on, off | no | CL-TRV-16 |
| Daily cap (TEL-22) | 20 messages | 1 to 200 | no | CL-TRV-16, CL-TEL-07 |
| Link-code validity (TEL-29) | 15 minutes | 5 to 60 minutes | no | CL-TRV-16, CL-TEL-23 |
| Retry intervals (TEL-35) | 1, 5, 15, 30, 60 minutes | 1 to 10 values, strictly increasing, each 1 to 1,440 minutes | no | CL-TRV-16 |
| Catch-up interval (TEL-36, CL-TEL-12) | 60 minutes | 15 to 1,440 minutes | no | CL-TRV-16, CL-TEL-12 (new) |
| Time zone (IHM-14) | Europe/Paris | any zone of the IANA time-zone database | no | CL-TRV-16, CL-IHM-05 |
| List page size (IHM-18) | 50 | 10 to 200 | no | CL-TRV-16 |
| "Deadline near" delay (IHM-20) | 24 hours | 1 to 168 hours | no | CL-TRV-16 |
| Draft lifetime (IHM-42) | 7 days | 1 to 30 days | no | CL-TRV-16, CL-IHM-11 |
| Research tool address (IHM-44) | none | empty, or an https address of at most 2,000 characters | no | CL-TRV-16 |
| Maximum description length (DSN-20) | 200 characters | 80 to 500 | no | CL-TRV-16, CL-DET-18, CL-IMP-26 |
| Quota limits (TRV-03) | none | empty until entered, then an integer of at least 1 | no | CL-TRV-16, CL-TRV-12, CL-STA-15 |
| Quota warning share (TRV-05) | 80 % | 1 to 99 % | no | CL-TRV-16 |
| Volume warning share (TRV-07) | 80 % | 1 to 99 % | no | CL-TRV-16 |
| Statistics update: start, cut-off (TRV-25, CL-TRV-23) | 15:00, 20:00 | any times of day, the cut-off at least one hour after the start | no | CL-TRV-16, CL-TRV-23 (start 15:00 replaces 12:00; cut-off new) |
| Statistics update: probe interval while waiting (CL-TRV-23) | 60 minutes | 15 to 120 minutes | no | CL-TRV-16, CL-TRV-23 (new) |
| Statistics update: late days before the incident (CL-TRV-23) | 2 | 1 to 7 | no | CL-TRV-16, CL-TRV-23 (new) |
| Purge time (TRV-25) | 04:00 | any time of day | no | CL-TRV-16 |
| Backup day and time (TRV-50) | Monday 05:00 | a weekday or "every day", and a time of day | no | CL-TRV-16, CL-DSN-07 (sets the fingerprint horizon) |
| Backups kept (TRV-50) | 8 | 1 to 52 | no | CL-TRV-16, CL-DSN-07 (sets the fingerprint horizon) |
| Missed-run margin (TRV-31) | 2 hours | 0.25 to 24 hours, step 0.25 | no | CL-TRV-16, CL-TRV-08 |
| Journal retention (TRV-48) | 90 days | 7 to 365 days | no | CL-TRV-16 |
| Export reminder delay (TRV-54) | 30 days | 1 to 365 days | no | CL-TRV-16 |
| Minimum password length (TRV-60) | 12 | 12 to 128 | no | CL-TRV-16 |
| Login failures, observation period, lockout (TRV-61) | 5, 15 minutes, 15 minutes | 3 to 20; 1 to 1,440 minutes; 1 to 1,440 minutes | no | CL-TRV-16 |
| Session idle timeout (TRV-62) | 30 days | 1 to 365 days | no | CL-TRV-16 |
| Coverage threshold of a sheet (CL-TAX-14) | 3 outlets in 2 days (media-storm draft) | 2 to 10 outlets; 1 to 7 days | no | CL-TRV-16, CL-TAX-14 (sheet value, new) |
| Criterion switched off (type sheet, record 0016) | empty | at most one of SEN-12 to SEN-15, or SEN-06 while its parameter is on | yes | CL-TAX-17, CL-SEN-13, CL-TRV-17 |

## For the glossary

### Terms used in two ways, now one way in the rulings

- « coup d'envoi »: "kick-off" in CL-VUE-12, CL-VUE-13, CL-VUE-14, CL-TAX-19 and CL-SUI-14, "tip-off" elsewhere; now "tip-off" everywhere, as the glossary has it. The register and record 0015 still say "kick-off".
- The display line of a calendar-derived event: "derived from the schedule" (CL-ALE-13, CL-IHM-21) and "from the schedule" (CL-TEL-21) beside the dating-rule mark "derived from the calendar" (CL-TAX-20, register row TAX-01); now "derived from the calendar" and "from the calendar", as records 0015 and the register name the origin. The glossary (section 10) names the origin "schedule-derived event", code `schedule`, label "From the schedule": one word, calendar or schedule, must be chosen there and the rulings' labels follow it.
- Exploration keys: CL-TAX-04 wrote `overlaps`; now `possible_overlaps`, and the version key `format_version`, both the glossary's (section 6.2). The research-result key is `format_version` too (CL-IMP-06 wrote the French `version_format`), and the reservation is `unverified_note` (CL-IMP-03, CL-IMP-05 wrote `non_verifie`).
- The prompt's type list: `{{TYPE_LIST}}`, the spec's `{{LISTE_TYPES}}` (CL-BKT-03).
- American spelling: canceled, catalog, labeled, honor, player-centered.

### Where the rulings and the glossary branch differ

- « coup d'envoi »: the glossary (section 4.2) calls it "the actual start"; the rulings make every tip-off the scheduled start as last known, actual starts never being fetched (CL-SEN-23, CL-SUI-13).
- Date display: the glossary (section 2) gives "Wednesday 11 November 2026 at 05:10, Paris time" and "Wed 18 Nov at 01:30"; record 0010 and the rulings use "Wednesday 11 November 2026, 05:10 Paris time" and "Wed 18 Nov 2026, 01:30" (CL-COL-22, CL-IHM-04, CL-TRV-02).
- The statistics task: the glossary (section 9.1) keeps 12:00; CL-TRV-23 sets 15:00 with a 20:00 cut-off.
- Withdrawal: CL-VUE-04 and file 12 ask for two different English words for a withdrawn player or type and a withdrawn event; the glossary (section 4.2) keeps "withdraw" for both, told apart by their object, and labels the event's button "Withdraw and erase".
- The reason of a detached article: the glossary's provisional `detached`, "Detached from its event" (section 11, point 2); CL-DET-12 says « détaché par l'utilisateur », "detached by the owner".
- Dismissal timing: the glossary records it with every dismissal; CL-DET-15 stores the dismissal instant only and derives the position at each display.
- The not-measurable reason of a missed derived game: the glossary's `scheduled_game_missed`, "Player did not play that game"; CL-SEN-03 calls it "did not play the derived game".
- Points of the glossary's section 11 that rulings now settle: the case origin of calendar-derived events (CL-VUE-13: tracked when derived before the game's scheduled start, historical otherwise); when "collection impossible" closes (CL-COL-05, as provisional); one quota incident per service, a TRV-06 refusal being one of its causes (CL-TRV-11); the decrease caveat, one sentence for both directions (CL-ALE-03); a historical event's date kept as its calendar date plus, when timed, instant and offset, with the reference-instant provenances of 08 rather than the precisions of COL-20 (CL-IMP-09, CL-SEN-02).

### Items passed to the glossary by the files

- **00:** English terms for every term of the 00 glossary and the common states (VUE-08); two distinct terms for withdrawing an event and the withdrawn state of a player or type; the label of the third origin, calendar-derived; the full names of the three confidences; the title of « Méthode et limites » and the label of the withdrawn-events counter.
- **01:** player states and the five reasons of JOU-15; "mapping to establish", "already followed as …", "without team"; team-change origins "observed" and "entered", the marks "unconfirmed" and "confirmed by the game of …"; "archived"; "a deleted player"; "request to do", "supplementary request to do", "full redo to do", "imported"; "birthday not recorded: no birthday events" and the former-team history mention.
- **02:** identifiers, names and drafts of the nine seeded types; type states, rejection reasons, qualifications, the marks "to requalify" and "to distribute"; "merged into …", "split into …"; documentation difficulty values; the TAX-12 checklist items, "established by the schedule" included; the marks "derived from the calendar", "known in advance", "handled by the calendar"; the exploration keys and values and "this text is not an exploration return"; the coverage-threshold sentence of CL-TAX-14.
- **03:** health states « jamais lue », « fonctionnelle », « en panne », « muette »; activation states « active », « désactivée », « retirée »; run origins « planifiée », « à la demande », the mark « avec rattrapage »; « période non collectée (source désactivée) »; precisions « exacte », « approximative », « absente »; counters « incomplet », « en langue non traitée », « anomalie de date »; « trou de collecte possible », « flux en panne », « collecte impossible », the silent-source and "add a collection time" warnings; « presse sportive publique »; the date display of CA-COL-06.
- **04:** non-relevance reasons « aucun joueur suivi », « aucun fait », « sous le seuil », « fait ancien », « déjà rapporté par un backtest », « type rejeté ou retiré », « proposition rejetée », « détaché par l'utilisateur », « sous le seuil de couverture »; marks « datation à vérifier », « détecté après le coup d'envoi », « doublon possible d'un événement historique »; « description à revoir », « texte non conservé », « classification en échec »; "not the same fact"; dismissal reasons; the three causes of the classification incident; the name of the calendar list; "confidence band width" and the "origin user" row.
- **05:** the English keys and values of format 1.0; the English prompt; the type identifiers of the example; the prefix `REQ`; the prompt's fixed phrases; the request labels, states, kinds and origins, « joueur retiré », « à venir », « joué », the stale-copy and stale-version warnings, the BKT-02 explanation, the coverage-complete and reduction-refused messages, "time TBD".
- **06:** every import message in the structure of CL-IMP-02; the ignore reasons, "type derived from the calendar" included; the warnings "date written in a non-standard form", "time ignored", "may contain statistics or a score", "possible citation marker in {field}", "matches an event you withdrew"; the correction message and its table; the import screen labels, modes, outcomes and precedence values.
- **07:** game statuses and phases, the baseline phase "postseason"; sheet and baseline states; « minutes arrondies », « heure à déterminer », « partielle », « correspondance à établir »; game classes; the no-game reasons, « statistiques en attente », « saison non couverte par la source », « date inconnue »; the two incidents, « 9 saisons sur 14 », the correction-log origins, « indicative »; the birthday-profile mention of CL-STA-24, the "rounded minutes" note, "no longer derived from the calendar".
- **08:** case states and reasons, with "did not play the derived game", "box score unavailable", "box score incomplete", "box score suspect"; the reference-instant provenances and « antériorité incertaine »; criteria, review flags and "manual decision to review: the measured game changed"; manual-decision reasons; verdict words, labels and warnings, the permanent warning of record 0016, "recalculation in progress"; the ten verdict-history causes; the exit reason "no longer derived from the calendar"; the ejection note.
- **09:** the fixed sentences of ALE-10, ALE-12, ALE-13, ALE-16, ALE-17, ALE-24 and the two forms of the direction caveat; the sheet labels; the cancellation reason "event no longer applies" and the "derived from the calendar" line.
- **10:** « pronostic » and its derived terms ("forecast"; the register and record 0015 also say "prognosis"); case categories and row assessments, two lists to keep apart; « enregistré à temps », « enregistré après le coup d'envoi », « concomitant », « archivé », « trop peu de cas suivis pour conclure (k sur 10) »; the reading rules of SUI-28; the labels of the three post-tip-off counts.
- **11:** category names and the first-line labels of every message; message statuses and link states; the closing line and the fixed mentions of the catalog; "catch-up interval".
- **12:** navigation labels, titles, banners, empty states and the short notice; "Times in Paris time", the zone names, the part-of-day words, "This item no longer exists"; the to-do, banner, draft and offline labels; the two words for « retiré ».
- **13:** the English DSN-19 example and the description templates of calendar-derived events; "sensitive event", "sensitive data"; the counter's label and sentence; the limit sentences of the withdrawal screen; the message of the quotation-mark check.
- **14:** task names, incident names, "not refreshed since …", journal levels; the English TRV-42 example; date patterns, zone labels, the US-date recall; run results "succeeded", "failed", "interrupted", "source late"; "on demand"; "an event was withdrawn", "an item that no longer exists", "a deleted player"; the status lines of CL-TRV-23 and the restore summary's warnings.
- **90:** the labels of the three entry kinds; the names of the nine candidate types.
