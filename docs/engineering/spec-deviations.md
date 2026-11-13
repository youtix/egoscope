# Spec deviations register

This register lists every requirement, hypothesis and question of the French specs in `docs/` that a [decision record](../adr/README.md) changes, extends or settles. Check it before implementing or reviewing a requirement: when its ID is here, the "What we do instead" column and the record apply; when it is not, the French text applies. The closing section, "Read this before implementing", gives the precedence rules.

Kinds:

- **overridden**: the spec text is replaced.
- **exception**: the spec text stands, except in the bounded case described.
- **extended**: the spec text stands, with the additions described.
- **settled**: an open question, a hypothesis to confirm or an option the spec left open is decided; the row names the default that now binds.

IDs are quoted as the specs write them. Acceptance criteria that a spec lists without an ID are cited by document and position, for example `12 AC-8` for the eighth criterion of document 12, in the row of the requirement they test. Record numbers refer to the files `docs/adr/NNNN-*.md`. Rulings (`CL-…`) are those of `docs/engineering/clarifications/`: a row cites the rulings that hold its detail, and where a ruling amends a spec hypothesis that no record covers, the last column names the ruling. French labels stay in « guillemets »; their English form comes from `docs/engineering/glossary.md`.

## 00 — Vue d'ensemble

| ID | What the spec says | What we do instead | Kind | Record |
| --- | --- | --- | --- | --- |
| VUE-06 | Lot 1 works alone, from adding a player to reading the profile, without any Lot 2 function (00 AC-6). | Kept; it gates a tagged Lot 1 milestone, verified end to end on a build without any Lot 2 configuration; Lot 2 work that depends on Lot 1 comes after it. | extended | 0001 |
| VUE-08 | Screens and messages use the glossary terms and common states exactly as 00 writes them. | Use the English terms and state labels that the glossary maps from 00, exactly and consistently. | overridden | 0010 |
| VUE-10 | A detected event of a profiled player goes through steps 8 to 10 — alert sheet, tracking, profile and validation table — with no action of the owner. | Also an upcoming calendar-derived event of an active player, with no backtest condition: alert sheet, tracked case whose forecast is frozen at tip-off, Telegram messages (CL-VUE-14). | extended | 0015 |
| Q-VUE-01 | Open: should the verdict thresholds account for the number of player–type pairs? Default: show expected false signals, no correction. | Settled with the default: no automatic correction; the profile list shows the verdicts chance alone would produce (SEN-41). | settled | 0021 |

## 01 — Joueurs suivis

| ID | What the spec says | What we do instead | Kind | Record |
| --- | --- | --- | --- | --- |
| JOU-06 | The app starts with no player and offers no predefined list (Q-03). | Confirmed: it starts empty; the owner adds 20 to 30 players, each confirmed against the statistics source (JOU-10). | settled | 0020 |
| JOU-08 | Identity: app identifier, usual name, spelling variants, nicknames, current team, stats-source mapping. | Adds the day and month of birth, never the year, used only to derive birthday games, from the source or the owner (CL-JOU-16); a 29 February birthday falls on 28 February in common years (CL-JOU-17). | extended | 0015 |
| JOU-11 | No other personal data, no date of birth; if Q-TAX-01 goes to the calendar, the birthday and the former teams would be added. | Agreed exception: only the day and month of birth are stored; former teams are not entered but derived from box scores (STA-08, JOU-13); a mapping change replaces only a birthday the source gave (CL-JOU-11). | exception | 0015 |
| JOU-13 | Team changes seen by the statistics task are recorded: date of the first game with the new team, previous team, origin. | The team of each box score, over the covered seasons, also gives the former-team history; a first meeting is derived only when every season since the departure is covered, and the former-team profile says where its history starts (CL-JOU-18, CL-STA-24). | extended | 0015 |
| JOU-24 | Deleting a withdrawn player's data applies the withdrawal of 13 to each of his events and feeds the counter. | It creates no fingerprint but one deleted-player entry — a keyed hash of his identifier, with the secret and horizon of fingerprints — so that a restore deletes him again (CL-JOU-24). | extended | 0017 |
| JOU-25 | The player page shows identity, backtest status, a profile summary per type and « type non couvert par le backtest » where coverage lacks the type. | Also shows the day and month of birth; calendar-derived types never carry « type non couvert par le backtest ». | extended | 0015 |
| Q-JOU-01 | Open: is the first game after a team change a confounder? Default: flagged for review by SEN-16, never excluded automatically. | Settled with the default (SEN-16, H-SEN-08). | settled | 0009 |

## 02 — Taxonomie des événements

| ID | What the spec says | What we do instead | Kind | Record |
| --- | --- | --- | --- | --- |
| TAX-01 | Type sheet: identifier, name, definition, criteria, dating rule saying whether events are known in advance, example, caution notes; written in French. | Written in English. The dating rule can also say "derived from the calendar" (birthday, former team); an optional field switches off one doubtful-case criterion for the type, empty by default (CL-TAX-17). | overridden, extended | 0010, 0015, 0016 |
| TAX-02 | Identifier: short, lowercase, unaccented, hyphenated, modeled on the annex (French words); never changes; used as is everywhere. | Same rules with English words; the glossary maps each annex identifier to its English one. | overridden | 0010 |
| TAX-05 | Datable: the dating rule gives a unique reference date, established by a dated press source (D-10). | Calendar-derived types are dated by the schedule: the reference date is the game's day, before tip-off, with no press source. | exception | 0015 |
| TAX-11 | Only validated types serve the research prompt, the import, the calculation and the classification. | A validated calendar-derived type serves the calculation and the calendar derivation only. | exception | 0015 |
| TAX-12 | Validation checklist, including "the dating rule gives a unique reference date established by a dated press source". | For a calendar-derived type that item reads "established by the schedule"; the rest of the checklist applies. | exception | 0015 |
| TAX-15 | First start loads the nine candidate types, proposed, origin « cadrage », with the annex drafts. | Same nine types with English drafts; the « anniversaire » and « ancienne-equipe » drafts drop the press-article criterion and take the calendar dating rule, a mark fixed at seeding (CL-TAX-20); the former-team draft counts the first meeting only. | overridden | 0010, 0015 |
| TAX-16 | Exploration prompt with fixed contents; it requires an answer written in French, in the TAX-17 format only. | Prompt and answer in English; admitted sources stay English- and French-language public press. | overridden | 0010 |
| TAX-17 | Exploration answer in strict JSON, format « egoscope-exploration », following the conventions of 05. | Same format name; English field names and values, following the English conventions of BKT-24. | overridden | 0010 |
| TAX-18 | The classification receives the do-not-repropose list; a fact matching an entry becomes an occurrence of it. | It also receives the list of the types handled by the calendar, which never enter the do-not-repropose list; a fact reported against it gives no event, proposal or occurrence (CL-TAX-21, CL-DET-22). | exception | 0015 |
| TAX-20 | Validation proposes complementary backtest requests; until they are imported, the profile rests on tracked cases, marked « type non couvert par le backtest ». | For a calendar-derived type, validation derives its events for active and paused players instead, over the games already started; upcoming events come from the regular runs (CL-TAX-19); no request, no such mark. | exception | 0015 |
| TAX-24 | A broadening change proposes complementary requests and flags the profiles as incomplete. | For a calendar-derived type, a substantive change re-runs the derivation instead. | exception | 0015 |
| TAX-27 | Two or more validated types can be merged into one. | Calendar-derived types take part in no merge (CL-TAX-20). | exception | 0015 |
| TAX-29 | A validated type can be split into two or more types. | Calendar-derived types take part in no split (CL-TAX-20). | exception | 0015 |
| TAX-32 | Reactivation proposes complementary requests, as a validation does. | For a calendar-derived type, reactivation re-runs the derivation. | exception | 0015 |
| TAX-33 | Validated sheets go in full to the research prompt, the import, the calculation and the classification. | Calendar-derived sheets go to the calculation only. | exception | 0015 |
| Q-TAX-01 | Open: find birthday and former-team games in the press, or deduce them from the calendar? Default: the press rule. | Settled: deduced from the calendar; the app creates these events itself. | settled | 0015 |
| Q-TAX-02 | Points to Q-SEN-01 for types tied to a confounder, including the approach of a record. | Settled by the per-type switch of one doubtful-case criterion. | settled | 0016 |

## 03 — Collecte des actualités

| ID | What the spec says | What we do instead | Kind | Record |
| --- | --- | --- | --- | --- |
| COL-12 | Daily collection at a configurable hour in the owner's time zone, by default 22:00 Paris time (H-COL-01); several hours allowed, one by default. | Two runs by default, at 16:30 and 23:00 Paris time; still configurable, several hours allowed. | overridden | 0019 |
| COL-34 | A deleted article leaves a deduplication trace for 180 days, except when it is erased because of a withdrawal. | Also no trace for an article erased because a fact in it matches a withdrawal fingerprint (CL-COL-16). | exception | 0017 |
| COL-37 | Articles tied only to a withdrawn event are erased at once, without deduplication trace (see Q-DSN-01). | Unchanged; an article whose fact matches a live fingerprint is erased at once too, unless another role keeps it, and collecting it again is accepted (CL-COL-16, CL-DSN-10). | extended | 0017 |
| CA-COL-06 | Expected display « mercredi 11 novembre 2026 à 5 h 10, heure de Paris ». | Expected display "Wednesday 11 November 2026, 05:10 Paris time". | overridden | 0010 |
| H-COL-01 | One collection a day, at 22:00 Paris time (to confirm). | Two, at 16:30 and 23:00 Paris time. | overridden | 0019 |
| Q-COL-01 | Open: search news archives to fill a collection gap? Default: nothing beyond catch-up; the gap stays flagged. | Settled with the default (COL-46, COL-47). | settled | 0009 |
| Q-COL-02 | Open: should the developer propose a starting list of sources? Default: none is preinstalled (COL-01). | Settled with the default: no list preinstalled or proposed; the owner adds every source. | settled | 0009 |

## 04 — Détection des événements

| ID | What the spec says | What we do instead | Kind | Record |
| --- | --- | --- | --- | --- |
| DET-10 | The queue resumes by itself at each run of the resume task, every 6 hours by default while the queue is not empty (H-DET-05), and at the latest at the next daily run. | The queue counts as not empty while an item is eligible; a failed item is never resubmitted automatically and waits for the owner. The six hours count from the end of the last run that processed the queue; the resume task is due earlier at a provider's known quota reset, from its declared boundary or the rate-limit headers of its refusal, and at once, within the quota, when the owner's new attempt or new classification makes an item eligible (CL-DET-04). | extended | CL-DET-04 |
| DET-14 | The model receives the full sheets of the validated types, the do-not-repropose list and recent events. | Calendar-derived types are not sent as types to classify into; the model receives instead the list of the types handled by the calendar, name and definition (CL-DET-22). | exception | 0015 |
| DET-15 | Only validated types classify; other types never give rise to an event. | A calendar-derived type, even validated, never gives rise to a detected event; in the edge case « Deux faits dans un article », only the humiliation event is created. | exception | 0015 |
| DET-16 | Model output per fact, with the context values of 05 (« oui, non, inconnu »; « fort, normal, inconnu ») and short texts. | English values, the same as in the research format, and English texts. | overridden | 0010 |
| DET-21 | The description is written in French whatever the article's language; fallback description and « texte non conservé » mention. | Written in English whatever the article's language; fallback and mentions in English. | overridden | 0010 |
| DET-34 | A fact that touches the ego without a validated type becomes a proposal, or an occurrence of a do-not-repropose entry. | A fact the model reports against the list of the types handled by the calendar is dropped: no proposal, no occurrence, no resubmission (CL-DET-22). | exception | 0015 |
| DET-58 | Before creating an event, look for a corresponding historical event (IMP-25). | First, for a model-origin fact that would create a new event, check the withdrawal fingerprints over the correspondence window of IMP-25: a match creates nothing; the owner's own classifications are not checked (CL-DET-21, CL-IMP-34). Calendar-derived events never take part in correspondences (CL-IMP-29). | extended | 0015, 0017 |
| H-DET-05 | Queue: a priority horizon of 48 hours before tip-off; resumption every 6 hours while the queue is not empty (to confirm). | Both defaults kept. The six hours count from the end of the last run that processed the queue, and a run is due earlier at a provider's known quota reset; the incident's planned resumption is the first run of the resume task or of a collection pass due at or after that reset (CL-DET-04, CL-DET-05). | extended | CL-DET-04, CL-DET-05 |
| Q-DET-01 | Open: may the owner declare an event from a link that was not collected? Default: not provided. | Settled with the default: only collected articles are classified or recovered by hand (DET-13, DET-49). | settled | 0009 |

## 05 — Demande de backtest et prompt

| ID | What the spec says | What we do instead | Kind | Record |
| --- | --- | --- | --- | --- |
| BKT-04 | Detecting a type outside a profiled player's coverage creates a complementary request. | Never for a calendar-derived type, which is outside coverage. | exception | 0015 |
| BKT-05 | Validating, reactivating or broadening a type lists the players already treated whose coverage lacks it and proposes complementary requests; a player with a request to do is offered its update instead. | Not for calendar-derived types; the derivation runs instead (TAX-20). For a research type, the list is not a reaction to the validation: it holds every already-processed player whose coverage has no counting period for the type, whatever the order of his imports and of the validation, for as long as that gap lasts, computed when shown and never stored; a player with a request to do is offered its update only when the update would add the type, and otherwise stays listed with a mention that the proposal waits until that request is imported or canceled (CL-BKT-26). | exception, extended | 0015, CL-BKT-26 |
| BKT-08 | An initial request covers every validated type over the whole career. | Every validated type except the calendar-derived ones. | exception | 0015 |
| BKT-10 | Coverage per type; a player is profiled as soon as any research result is imported for him. | Calendar-derived types are never part of coverage; their profiles exist from statistics alone. | exception | 0015 |
| BKT-19 | The prompt suits any research AI able to cite its sources; none is assumed; its quota stays open (Q-BKT-02). | Confirmed: tool-agnostic; no tool is named in code, screens or documentation. | settled | 0013 |
| BKT-21 | The prompt keeps the requirements of the French reference text; rule 2.6 asks for descriptions in French; rule 2.5 cites the birthday as a fact known in advance. | The prompt is in English; rule 2.6 asks for English descriptions, titles copied as published; calendar-derived types never appear, and the birthday example of rule 2.5 goes. | overridden | 0010, 0015 |
| BKT-24 | Format 1.0, with French field names and values, is the only contract; any rename creates a new version. | Format 1.0 is defined with English field names and values, mapped one to one in the glossary; « egoscope-backtest » unchanged; the French-keyed form is never implemented, so no earlier version exists. | overridden | 0010 |
| BKT-30 | Routing of a detected event by coverage: request, alert sheet, or alert sheet marked « type non couvert par le backtest ». | Calendar-derived events are never routed by coverage: an upcoming one of an active player gets an alert sheet with no backtest condition and never a request (CL-VUE-14, CL-ALE-13). | exception | 0015 |
| H-BKT-05 | Free texts in French; article titles in their original language (to confirm). | Free texts in English; titles unchanged. | overridden | 0010 |
| H-BKT-07 | Research confidence in three levels, « haute, moyenne, faible » (to confirm). | The same three levels, with English values from the glossary. | overridden | 0010 |
| H-BKT-08 | Context values « oui, non, inconnu » and « fort, normal, inconnu » (to confirm). | The same values in English, from the glossary. | overridden | 0010 |
| Q-BKT-01 | Open: exclude the events of « faible » research confidence, or count them? Default: count them and show their number (SEN-43). | Settled with the default. | settled | 0022 |
| Q-BKT-02 | Open: which free research AI, and how many searches its quota allows. | Settled: no tool is chosen or assumed; the prompt stays generic (BKT-19). | settled | 0013 |
| Q-BKT-03 | Points to Q-TAX-01; if it goes to the calendar, these types leave the prompt and the backtest coverage. | Settled for the calendar: they leave the prompt and the coverage. | settled | 0015 |

## 06 — Import des résultats de recherche

| ID | What the spec says | What we do instead | Kind | Record |
| --- | --- | --- | --- | --- |
| IMP-04 | Isolate the JSON from surrounding text, code fences and invisible characters; correct nothing else. | Behavior unchanged, tested with fixtures of research-AI quirks: code fences, citation markers, truncated answers. A marker inside a text value is kept as written with the warning "possible citation marker in {field}"; in a link the source is dropped; in a limitation, a whole-result warning (CL-IMP-07). | extended | 0013 |
| IMP-05 | A truncated result: recover its complete events when the header is complete and the events are sorted. | Behavior unchanged, tested with truncated-answer fixtures. | extended | 0013 |
| IMP-13 | Warning when a description seems to hold statistics, such as numbers followed by « points », « rebonds » or « passes ». | The heuristic looks for English statistics words, since descriptions are in English. | overridden | 0010 |
| IMP-18 | Precedence classification; the fate of an « incertaine » precedence belongs to 08, by default the next game (SEN-44, Q-IMP-01). | Settled: the SEN-44 default binds. | settled | 0022 |
| IMP-20 | Error messages in plain French, with French examples. | Plain English, same structure; examples translated. | overridden | 0010 |
| IMP-21 | The correction message for the AI is composed in French. | Composed in English. | overridden | 0010 |
| IMP-25 | Correspondences and possible duplicates among historical events, the same result and detected events. | Calendar-derived events never take part in correspondences or possible duplicates (CL-IMP-29). The correspondence window, 2 days by default, also sets the fingerprint checks (CL-IMP-34). | exception | 0015, 0017 |
| IMP-37 | The preview lets the owner decline an event for « donnée sensible », for example a withdrawn event reported again; each use increases the counter. | The preview also flags an event that matches a withdrawal fingerprint — "matches an event you withdrew", with the choice "don't record — sensitive data", nothing preselected; the save confirmation counts the flagged events recorded, and recording one erases the fingerprints it matches (CL-IMP-28, CL-DSN-06). | extended | 0017 |
| H-IMP-02 | Defaults: 2 MB of pasted text, 2 days between public dates, 1 day of source lead, 3 sources sampled, link check on (to confirm). | The correspondence window, 2 days, also sets detection's "Possible duplicate of a historical event" mark and the fingerprint checks at import and detection: one parameter for them all (CL-IMP-34). | extended | 0017 |
| Q-IMP-01 | Open: a same-day source without a time — doubtful case, valid case, or next game? Default: SEN-44. | Settled: next game, marked « antériorité incertaine ». | settled | 0022 |
| Q-IMP-02 | Open: may the owner add a historical event by hand? Default: not provided. | Settled with the default. | settled | 0009 |

## 07 — Statistiques de match

| ID | What the spec says | What we do instead | Kind | Record |
| --- | --- | --- | --- | --- |
| STA-02 | The source must, without human action, reach far enough back to cover the tracked players' careers (H-06). | Coverage gives way: only sources that permit automated access, with no undocumented endpoints. The chosen source, the SportsDataverse releases, covers 1993-94 onward and is used alone. | overridden | 0012, 0023 |
| STA-03 | Each tracked player is linked to one and only one identity in the source, confirmed per JOU-10. | Settled: the chosen source is used alone, one established mapping per player; every season comes from one source only, and with two sources each player has one mapping per source, each confirmed by the owner (CL-STA-23, CL-JOU-21). | settled | 0012 |
| STA-08 | The box score gives the team the player played for, which feeds JOU-13. | It also feeds the former-team history of former-team events. | extended | 0015 |
| STA-31 | A game whose time is not yet set is deemed to start at the beginning of its day, local time at the venue (H-STA-11). | Deemed to start at 00:00 US Eastern time on its date for every comparison, shown with "time TBD" (CL-STA-14). | overridden | 0028 |
| STA-32 | Once a day, at least 3 hours after the last tip-off of the past competition day, fetch its results and box scores. | The competition day is the games' US Eastern date. The update is one run per competition day: from 15:00 it probes the source's refresh about every 60 minutes without opening the database, and ends "succeeded" once the refresh is ingested or, at the 20:00 cut-off, fetches what is published and ends "source late" (CL-STA-10, CL-TRV-23). | extended | 0023, 0028 |
| STA-42 | Consolidated data is never fetched again. | Exception: at a source replacement, the season in progress is fetched again whole from the new source, every difference traced as a correction, by the procedure of the statistics service sheet, which has no screen of its own (CL-TRV-14). | exception | 0012 |
| STA-45 | A season the source does not cover makes its cases « non mesurables », reason « saison non couverte par la source », and the profile shows it (to confirm). | Confirmed as the binding rule; birthday and former-team profiles also say from which season their counts start (CL-STA-24). | settled | 0012, 0015 |
| H-STA-11 | A game whose time is not set starts at the beginning of its local day (to confirm). | Read as 00:00 US Eastern time on its date (CL-STA-14, CL-TRV-03). | settled | 0028 |
| H-STA-16 | An uncovered season makes the cases that fall in it non-measurable (to confirm). | Confirmed. | settled | 0012 |
| Q-STA-01 | Open: accept profiles limited to the covered seasons, or revise the indicator? To be decided by the owner when the source is chosen. | Settled: limited profiles, unchanged indicator (H-13), no pause for the owner at source choice. | settled | 0012 |

## 08 — Sensibilité et verdict

| ID | What the spec says | What we do instead | Kind | Record |
| --- | --- | --- | --- | --- |
| SEN-01 | An event known only by its date is public at the end of that day, Pacific time. | That rule serves historical events whose public date has no time; a detected event keeps the instant DET-30 records (CL-SEN-02, CL-COL-02). | settled | CL-SEN-02 |
| SEN-02 | For a type known in advance, the measured game is the first game played on or after the event's date, local date at the venue. | For calendar-derived types, the derived game itself; if the player does not play it, the case is « non mesurable ». Other types known in advance: as written, the local date being the game's US Eastern date and the window ending E + 10 days (CL-TRV-03, CL-SEN-04). | exception | 0015, 0028 |
| SEN-03 | Games the player did not play are skipped; the measured game is the first one he plays after the reference instant. | Not applied to calendar-derived types: no skipping. | exception | 0015 |
| SEN-04 | No game played within 10 days of the reference instant makes the case non-measurable. | Not applied to calendar-derived types, which are non-measurable as soon as the player misses the game. | exception | 0015 |
| SEN-07 | Fixed list of case states and reasons, including the reasons for « non mesurable ». | Adds the reason "did not play the derived game" for calendar-derived types (CL-SEN-03). | extended | 0015 |
| SEN-11 | A case is doubtful as soon as a criterion of SEN-12 to SEN-15, or SEN-06 if enabled, applies. | A type sheet may switch off one of these criteria for its cases; off by default (CL-SEN-13). | extended | 0016 |
| SEN-23 | Verdict thresholds (to confirm, Q-04): 5 valid cases; probable at 3 and 0.40; possible at 2 and 0.25; all configurable. | Confirmed as editable defaults; no correction for the number of pairs. | settled | 0021 |
| SEN-33 | A withdrawal leaves no trace per player or per type; only the global counter counts it; exits from the count follow a closed list. | Agreed exception: the keyed fingerprint, unreadable without the server secret, lives for the backup horizon, eight weeks by default (CL-DSN-07). New exit reason "no longer derived from the calendar", counted without date or game (CL-SEN-25). | exception | 0015, 0017 |
| SEN-41 | Show the evaluated pairs and the verdicts chance alone would produce (4.6%, 0.27%), recomputed when the thresholds change (to confirm). | Confirmed. | settled | 0021 |
| SEN-43 | An event of « faible » research confidence counts like the others; profiles show how many valid cases rest on one; Q-BKT-01 stays open. | Settled: this default binds. | settled | 0022 |
| SEN-44 | Uncertain precedence: the same-day source is deemed published at the end of the day, Pacific time; next game played; mark « antériorité incertaine » (to confirm). | Settled: this default binds. | settled | 0022 |
| SEN-46 | Coverage and version warnings on profiles, such as « type non couvert par le backtest » and « profil incomplet ». | Calendar-derived types never show the coverage warnings; their warnings are "birthday not recorded", the team-history mention and the covered-seasons mention (CL-SEN-03, CL-STA-24). A type with a switched-off criterion shows, on its profiles and general trend, a permanent warning that the effect cannot be separated from the confounder. | extended | 0015, 0016 |
| H-SEN-01 | An event dated without a time is public at the end of its day, Pacific time (to confirm). | Serves historical events whose public date has no time; a detected event keeps its DET-30 instant (CL-SEN-02). | settled | CL-SEN-02 |
| H-SEN-02 | For an event known in advance, the measured game follows from the game's local date (to confirm). | The local date is the game's US Eastern date (CL-TRV-03, CL-STA-14); calendar-derived types never slide. | settled | 0015, 0028 |
| H-SEN-08 | Transfer and ejection are flagged for review, never excluded automatically (to confirm). | Confirmed as the default of Q-JOU-01. | settled | 0009 |
| H-SEN-10 | Retained dispersion at least 1; thresholds 2 and 0.25 for possible, 3 and 0.40 for probable (to confirm). | Confirmed. | settled | 0021 |
| H-SEN-13 | General trend: each case weighs the same, at least 3 players, confidence drops beyond 50% of cases from one player (to confirm). | Confirmed as the default of Q-SEN-02. | settled | 0009 |
| H-SEN-14 | Counts instead of percentages under 20 cases; expected false signals shown rather than verdicts corrected (to confirm). | Confirmed. | settled | 0021 |
| H-SEN-15 | Uncertain precedence: end of day Pacific time, next game; an unestablished or unchecked precedence counts no case (to confirm). | Confirmed. | settled | 0022 |
| H-SEN-16 | A historical event of « faible » research confidence counts like the others, and their number is shown (to confirm). | Confirmed. | settled | 0022 |
| Q-SEN-01 | Open: switch off a criterion per type with a permanent warning, compare with similar games, or add a criterion specific to the type? Common rule meanwhile. | Settled: a type sheet can switch off one criterion, off by default, with a permanent warning. | settled | 0016 |
| Q-SEN-02 | Open: weight the general trend per case or per player? Current rule: per case. | Settled with the default: per case (SEN-28, H-SEN-13). | settled | 0009 |
| Q-SEN-03 | Open: complete the season reference with a recent-form reference? | Settled with the default: the season reference alone (D-07, STA-16). | settled | 0009 |
| Q-SEN-04 | Open: when the player misses the precise game of a type known in advance, non-measurable or the next game played? Meanwhile SEN-02 slides. | Settled: « non mesurable » for the calendar-derived types; SEN-02 as written for any other type known in advance. | settled | 0009, 0015 |

## 09 — Fiche d'alerte

| ID | What the spec says | What we do instead | Kind | Record |
| --- | --- | --- | --- | --- |
| ALE-01 | A sheet is produced when a detected event concerns a profiled player. | Also for an upcoming calendar-derived event of an active player, profiled or not, of a validated type; its event block shows "derived from the calendar" with the derived game in place of sources (CL-ALE-13). | extended | 0015 |
| ALE-14 | The « type non couvert par le backtest » sheet when coverage lacks the type, with the complementary request. | Never for a calendar-derived type. | exception | 0015 |
| ALE-16 | Fixed list of the reserves the sheet shows. | Adds the permanent confounder warning when the type has a switched-off criterion; the detection-confidence and dating reserves never apply to a calendar-derived event (CL-ALE-13). | extended | 0015, 0016 |
| ALE-17 | Fixed closing sentence in French. | Its English equivalent from the glossary. | overridden | 0010 |
| ALE-18 | Forbidden wording, with French examples, the word « pronostic » being kept to the terms of 10. | The same rules applied to the English wording and the glossary terms, "forecast" for « pronostic ». | overridden | 0010 |

## 10 — Suivi automatique et validation

| ID | What the spec says | What we do instead | Kind | Record |
| --- | --- | --- | --- | --- |
| SUI-01 | A tracked case is created as soon as a detected event is recorded. | Also for a calendar-derived event created before its game's scheduled start (CL-SUI-14). | extended | 0015 |
| SUI-03 | The expected game is the team's first game after the reference instant. | For a calendar-derived event, the derived game itself (CL-SUI-14). | exception | 0015 |
| SUI-05 | A case's origin is historical, from a research result, or tracked, from a detected event, and never changes. | A calendar-derived case is tracked when its event was created before the game's scheduled start, in Lot 1 as in Lot 2, historical otherwise; it can never be dismissed (CL-VUE-13, CL-SUI-14). | extended | 0015 |
| SUI-18 | When the expected game is postponed or missed, the case waits for the first game the player plays within the SEN-04 window. | Not for calendar-derived events: a game that still qualifies after a change of time stays theirs, and if the player misses it the case is « non mesurable » (CL-SUI-14). | exception | 0015 |
| Q-SUI-01 | Open: should the validation board one day revise the verdict thresholds? Only by an explicit decision of the owner (SUI-29). | Settled with the default: never automatically. | settled | 0009 |
| Q-SUI-02 | Open: schedule detection before the North American evening games, maybe twice a day? | Settled: two runs a day, at 16:30 and 23:00 Paris time, configurable. | settled | 0019 |

## 11 — Notifications Telegram

| ID | What the spec says | What we do instead | Kind | Record |
| --- | --- | --- | --- | --- |
| TEL-04 | Messages in French; dates and times in the owner's zone, named (« heure de Paris »), with the US date when it differs. | Messages in English; the same date rules, in the English format. | overridden | 0010 |
| TEL-05 | Fixed French closing mention « Mesure du passé, pas un pronostic. »; the word « pronostic » only in the terms of 10. | English equivalents from the glossary. | overridden | 0010 |
| TEL-11 | The alert designates each event by player, type and press source. | A calendar-derived event is designated "from the calendar", with its derived game in place of a source (CL-TEL-21). | extended | 0015 |
| TEL-12 | An update for a useful change of an open sheet known before tip-off. | Also when a calendar-derived event is dropped before tip-off from a notified sheet, unless the drop follows the owner's own change (CL-TEL-21). | extended | 0015 |
| TEL-15 | Messages for the incidents it names — press source down and collection impossible, quota reached, stats source unavailable, task not run, backup failed — and, under the same rules, the « source muette » warning and the export reminder. | Also "Stats source format changed", an incident no French list names (CL-STA-15), notified like "Stats source unavailable". Nothing else is added: the 80% quota warning, the database-volume warning and "Add a collection time" show only in the app (CL-TEL-17). | extended | CL-TEL-17 |
| TEL-38 | After a withdrawal, the app tries to delete the messages that mention the event; those Telegram no longer lets it delete stay in the chat, and the app points them out to the owner (H-TEL-04). | Each sent message keeps its chat and message identifiers until the withdrawal erases them. On confirmation, unsent messages are abandoned in a first committed step; Telegram is asked once, outside any transaction, to delete each sent message whose facts include the event, a digest whole; the erasure's transaction follows, whatever Telegram answered. The messages refused or not reached are listed, by send date and time and whether each was a digest, only on the screen shown right after the withdrawal, and never stored (CL-TEL-09). | extended | 0017 |

## 12 — Interface et accès

| ID | What the spec says | What we do instead | Kind | Record |
| --- | --- | --- | --- | --- |
| IHM-12 | Everything in French — labels, messages, errors, help; titles and proper names in their own language; the prompt shown as produced. | Everything in English; titles and proper names unchanged; the prompt is English. Covers 12 AC-8 and the server-error message of the edge cases. | overridden | 0010 |
| IHM-13 | French formats: « mer. 18 nov. », « 1 h 30 », decimal comma, explicit sign (+0,62, −0,40). | Day–month–year with month names ("Wed 18 Nov 2026"), 24-hour clock ("01:30"), decimal point, explicit sign (+0.62, −0.40). | overridden | 0010 |
| IHM-14 | Time-zone setting, Paris by default; US date recalled as in « mer. 18 nov. à 1 h 30 — mardi soir aux États-Unis ». | Setting and Paris default kept; the US date follows when it differs, with the part of day of the Eastern start, as in "Wed 18 Nov 2026, 01:30 — Tuesday evening in the US"; the venue's local time is never shown (CL-IHM-07, CL-TRV-02). Covers 12 AC-15. | overridden | 0010 |
| IHM-15 | Glossary terms on screen open their one-sentence definition; states use the labels of 00. | English terms, definitions and labels from the glossary. | overridden | 0010 |
| IHM-23 | Profile block per type, with the SEN-31 labels and « type non couvert par le backtest » where it applies. | Calendar-derived types never show that mark; a type with a switched-off criterion shows the permanent confounder warning. | extended | 0015, 0016 |
| IHM-46 | Each case reads « historique » or « suivi » in full; summaries give the split; case lists filter by origin; « Au lot 1, tous les cas sont historiques, et les écrans le disent ». | Applies in Lot 1 as written for display, except its last sentence: a calendar-derived event created before its game gives a tracked case in Lot 1 too (CL-VUE-13), so no screen says that every case is historical; when they all are, the split says so ("7 valid cases: 7 historical") (CL-IHM-24). | exception | 0015 |
| IHM-50 | Verdicts written exactly « probable », « possible », « non concluant »; fixed French mention on profile and validation screens. | Exact English terms and mention from the glossary; the same prohibitions. | overridden | 0010 |
| IHM-68 | After a withdrawal no screen mentions the event; only the DSN-29 counter grows. | Exception, in two places: an import preview flags an event that matches a fingerprint (CL-IMP-28), and a restore summary lists the ambiguous matches to check (CL-TRV-06). The withdrawal screen states the limits of CL-DSN-19. | exception | 0017 |
| H-IHM-02 | Paris by default, because the interface is French and game times come from the US (to confirm). | Paris confirmed as default, since dates are shown in Paris time; the French-interface reason no longer applies. | settled | 0010 |

## 13 — Données sensibles

| ID | What the spec says | What we do instead | Kind | Record |
| --- | --- | --- | --- | --- |
| DSN-01 | Every source of an event is a dated, public press or news-archive article. | Exception: calendar-derived events rest on the schedule and the box scores, with no article. | exception | 0015 |
| DSN-06 | Exhaustive list of event data, with press sources, a detection or research confidence, and the origin detected or historical. | Calendar-derived events carry a reference to their scheduled game instead of press sources, no confidence, a description written by the app and the origin calendar (CL-VUE-12). | extended | 0015 |
| DSN-23 | A description is written in French, even when the source is English. | Written in English, even when the source is French. | overridden | 0010 |
| DSN-26 | Any event can be withdrawn, at any time, for a sensitivity reason. | As written, calendar-derived events included; only a full derivation run after the fingerprint's horizon can bring one back, which the withdrawal screen says, excluding its case being the permanent alternative (CL-DSN-09). | extended | 0015, 0017 |
| DSN-27 | A withdrawal erases the event and every trace of it. | It also creates a fingerprint: an HMAC-SHA-256 of player, type and day, under the fingerprint secret (CL-DSN-06). It discards the import draft of every backtest request of the event's player, which its list does not name: the server copy in the withdrawal's transaction, each device's copy at its next contact with the server and at the latest at the draft's expiry, with no journal entry; exploration drafts are untouched (CL-DSN-22). Telegram messages are handled in the order of CL-TEL-09 (TEL-38). | extended | 0017 |
| DSN-28 | The confirmation lists the limits of a withdrawal, among them that re-collection or a later backtest can bring the event back. | The limits of CL-DSN-19: during the horizon, detection does not recreate the event and a later import flags it; a restore within it withdraws it again, except into a new database without the old one; for a calendar-derived event, a later full derivation can bring it back. When the player has an import draft, the confirmation says that the withdrawal discards it, a device's copy remaining until that device's next contact with the server, at the latest until it expires (CL-DSN-22). | extended | 0017 |
| DSN-29 | The global counter is the only trace a withdrawal leaves; nothing designates the event, even in reduced form. | Agreed, time-limited exception: the withdrawal ledger — fingerprints and deleted-player entries, kept out of backups and exports — lives for the backup horizon, eight weeks by default, each entry erased once older than the horizon and than every listed backup (CL-DSN-06, CL-DSN-07, CL-DSN-08, CL-JOU-24). | exception | 0017 |
| DSN-34 | Articles of a withdrawn event are erased without deduplication trace; a feed can then bring the event back. | Same erasure; the fingerprint stops detection from recreating the event during the horizon, and an article whose fact matches it is erased at once too (CL-COL-16, CL-DSN-10). | extended | 0017 |
| H-DSN-07 | A global counter, with no player, type or date, is the only trace of a withdrawal (to confirm). | Exception as in DSN-29. | exception | 0017 |
| H-DSN-08 | Descriptions in French, because the interface is French (to confirm). | Descriptions in English. | overridden | 0010 |
| H-DSN-10 | Accepted limit: an article still in a feed can bring a withdrawn event back (to confirm). | Mitigated by the fingerprint during the horizon; collecting the article again costs some classifications, accepted (CL-DSN-10). | extended | 0017 |
| Q-DSN-01 | Open: keep a minimal fingerprint (player, type, date) of a withdrawn event? Default: none. | Settled: a temporary keyed fingerprint, kept for the backup horizon, eight weeks by default. | settled | 0017 |

## 14 — Exigences transverses

| ID | What the spec says | What we do instead | Kind | Record |
| --- | --- | --- | --- | --- |
| TRV-01 | Every service in a free offer, with no paid option or time-limited trial; the host's free address suffices. | Vercel Hobby and Neon Postgres free plans; every other service free as well. | settled | 0002 |
| TRV-02 | A service that needs a payment card is excluded by default; the owner may lift the exclusion case by case. | No service that needs a payment card, and no case-by-case waiver. | overridden | 0002 |
| TRV-09 | Each chosen service is documented: role, offer, limits, date checked, where to read the terms, behavior at a limit, replacement. | Terms checked on the day of choice; a failing service is replaced by the closest free equivalent, the reason recorded in its sheet. | extended | 0011 |
| TRV-11 | Selection criteria: permanent free tier with a margin, usable from JS or TS, compatible terms including automated access, no deletion for inactivity, data recoverable. | Applied fewest accounts first. For statistics, the app downloads a licensed release and calls no undocumented endpoint; the release's upstream provenance awaits the owner's review (0023). | extended | 0011, 0012, 0023 |
| TRV-13 | The host runs JS or TS and either runs the scheduled tasks or accepts an external free trigger; long work may be split. | Vercel Hobby. All scheduled work goes through the secret-protected tick, called by a Cloudflare Worker every 5 minutes and, as backstop, by Vercel Schedules every 15 minutes, as chunked, resumable jobs; the app keeps the schedule, and an idle tick never opens the database. | settled | 0002, 0024, 0025 |
| TRV-14 | Hosted relational database on a free tier, encrypted connection, full export and restore. | Neon Free, in AWS Frankfurt, compute fixed at 0.25 CU. | settled | 0002, 0024 |
| TRV-15 | The statistics source covers every season of the tracked players' careers (H-06), with automated access permitted. | Coverage gives way, as in STA-02; the SportsDataverse releases, from 1993-94. | overridden | 0012, 0023 |
| TRV-16 | Language model on a permanent free tier covering the classifications with a margin, reading English and French, answering in a reliable structure. | Cloudflare Workers AI as primary; Groq as an optional fallback, used only when its key is set. | settled | 0024 |
| TRV-20 | One language, JavaScript or TypeScript, for every part of the application; the choice is left to technical design. | TypeScript with the strictest settings; Bun for install, scripts and tests; Node.js 22 in production, the host's Bun runtime being beta, moved at the end of the build to the newest LTS line that passes the gate. | settled | 0002, 0004, 0026 |
| TRV-24 | Interface, messages, logs and documentation in French; French date usage with the zone always given; decimal comma. | English everywhere, American spelling; dates in Paris time by default, day–month–year with month names, 24-hour clock, zone always given; decimal point. | overridden | 0010 |
| TRV-25 | Task calendar; collection by default at 22:00 (H-COL-01); statistics at 12:00 (H-TRV-07); tasks run by the host's scheduler or by a trigger. | Collection and detection at 16:30 and 23:00 Paris time by default; the statistics update, one run per competition day, from 15:00, waiting for the source until 20:00 (CL-TRV-23); every task starts from the secret-protected tick, and the app decides what is due from its own settings. | overridden | 0002, 0019, 0023, 0025 |
| TRV-26 | Each task has a name in plain French. | Plain English names. | overridden | 0010 |
| TRV-37 | The deployment configuration (service addresses, keys, Telegram token, initial password, trigger secret) stays out of the settings screen. | It also holds the fingerprint secret, the backup encryption key, the backup storage token, the Telegram webhook secret and the Cloudflare credentials. | extended | 0017, 0018, 0024 |
| TRV-42 | Every message in plain French, answering four questions, with a French example. | Plain English, the same four questions. | overridden | 0010 |
| TRV-50 | A full weekly backup kept outside the database service (Q-TRV-01); eight kept; a withdrawn event leaves the backups as they rotate. | Weekly backups encrypted with a key from the deployment configuration, each one asset of a draft release in a separate private GitHub repository; rotation keeps the configured number and really deletes, which the adapter verifies (CL-TRV-04). | extended | 0018, 0024 |
| TRV-51 | The backup holds everything needed to rebuild identically, with no deployment configuration value and no pasted text. | Settled: all application data and the counter's value, encrypted; never drafts, the withdrawal ledger, password data or sessions (CL-TRV-05, CL-DSN-08). | settled | 0017, 0018 |
| TRV-53 | A backup or full export restores into an empty database, following the documentation, without programming. | Restoring a backup needs the key from the deployment configuration; without it there is no restore. A restore re-applies the withdrawal ledger and lists the ambiguous matches (CL-TRV-06). Exports are unaffected. | extended | 0017, 0018 |
| TRV-56 | Backups and exports are for the owner alone and reachable only after login. | Read as "never public": off-site backups sit in the owner's private storage, readable only with that account and the key. | extended | 0018 |
| TRV-64 | Secrets stay in the host's configuration, never in the code, and are never displayed, logged or exported. | Same rule for the new secrets; the repository is public, so the configuration is documented by placeholders only. | extended | 0006, 0017, 0018 |
| TRV-65 | If a task is triggered from outside, the trigger is protected by a secret; an unauthenticated trigger is refused and logged. | Every task is triggered from outside, so the secret check guards every trigger, GET or POST. | settled | 0002, 0025 |
| TRV-71 | Instants in the owner's zone, named; a game also shows its US date and its local time. | The venue's local time is never shown; "et son heure locale" is read as the recall of the US date with its part of day (CL-TRV-02, CL-IHM-07). | overridden | 0010 |
| TRV-72 | Every rule speaking of a day names its zone; the day of a game is its US date (H-TRV-11). | The day of a game is its US Eastern date, for every rule and display (CL-TRV-03). | settled | 0028 |
| TRV-74 | Guide for an unknown level: no programming skill, commands with expected results, each step explained, a duration per step, every technical term defined. | Written for a developer: the TRV-75 steps as a checklist, each item with its action and its check, exact commands where needed, no definitions of basic terms, no durations. | overridden | 0014 |
| TRV-75 | Sixteen steps, in order, from prerequisites to first steps. | Kept as a developer checklist naming the decided services and values (Vercel, Neon, external trigger, fingerprint secret, backup space with one access token created at the end, encryption key), the public repository, and the owner's single list of accounts and values (CL-TRV-20). | extended | 0002, 0006, 0008, 0014, 0018 |
| TRV-77 | The guide also covers updates with rollback, replacing a service and resetting the password. | The same procedures, written for a developer. | overridden | 0014 |
| TRV-79 | Documentation in French, for a non-specialist, kept current and reachable in the app, with a fixed list of contents. | In English; deployment and operations parts written for a developer; same contents; the requirement status reports each requirement replaced through this register with its record. The app reaches it from Help by a link that opens outside the app (CL-IHM-09, H-TRV-13). | overridden | 0010, 0014 |
| CA-TRV-13 | The incident message says in plain French what happened, since when, the consequence and what to do. | The same, in plain English. | overridden | 0010 |
| CA-TRV-24 | A person who has never put an application online succeeds with the documentation alone. | A developer with the repository and the owner's accounts, following the checklist, gets an application whose installation check passes entirely, without touching the database directly. | overridden | 0014 |
| CA-TRV-36 | Expected display « mercredi 11 novembre 2026 à 4 h 30, heure de Paris », plus the US date and local time. | Expected display "Wednesday 11 November 2026, 04:30 Paris time — Tuesday evening in the US"; the venue's local time is not shown (CL-TRV-02, CL-IHM-07). | overridden | 0010 |
| CA-TRV-40 | Switching to New York time announces collection at 22:00 New York time, and its effect on tracked cases. | With the new defaults, the English announcement names 16:30 and 23:00 New York time. | overridden | 0010, 0019 |
| H-TRV-01 | A service that needs a payment card is not retained by default (to confirm). | Confirmed, without the case-by-case waiver of TRV-02. | settled | 0002 |
| H-TRV-07 | Default task hours: statistics at 12:00 Paris time, never before the STA-32 delay; purge at 04:00; a 2-hour margin before "task not run" (to confirm). | The statistics update is one run per competition day: it starts at 15:00 in the owner's zone, probes the source about every 60 minutes without opening the database, and ends "succeeded" when the refresh is ingested or, at the 20:00 cut-off, fetches what is published and ends "source late"; the "Stats source unavailable" incident opens after 2 consecutive late competition days; cut-off, probe interval and late days are new settings (CL-TRV-23, CL-STA-10). | overridden | 0023 |
| H-TRV-11 | The day of a game is its US date (to confirm). | Its US Eastern date (CL-TRV-03). | settled | 0028 |
| H-TRV-13 | The documentation can be consulted from the app, besides being delivered with the code (to confirm). | Help links to the documentation kept with the code in the public repository, which opens outside the app; offline, Help says that the link needs a connection (CL-IHM-09). | settled | CL-IHM-09 |
| Q-TRV-01 | Open: where to keep the automatic backups — manual exports only, or an extra service? | Settled: encrypted weekly backups as release assets of a private GitHub repository of the owner. | settled | 0018, 0024 |

## 90 — Journal des décisions

| ID | What the spec says | What we do instead | Kind | Record |
| --- | --- | --- | --- | --- |
| D-02 | Personal tool, single user, no diffusion or commercialization planned. | The tool stays personal and single-user; its code and specs are public, without license (all rights reserved), with no real player name. | exception | 0006 |
| D-07 bis | Everything free: information gathering, technologies, hosting, services. | Confirmed strictly: no paid tier, no payment card. | settled | 0002 |
| D-10 | Dated, verifiable press sources guarantee that the event was known before the game. | Calendar-derived events are known in advance from the schedule, without a press source. | exception | 0015 |
| D-28 | One language, JavaScript or TypeScript, on the server and the interface. | TypeScript. | settled | 0002 |
| H-02 | The effect is measured on the first game the player plays after the event became public (to confirm). | For calendar-derived types, on the derived game itself; non-measurable if the player misses it. | exception | 0015 |
| H-03 | At least 5 valid cases for a per-player verdict, as a parameter (to confirm). | Confirmed: default 5, editable. | settled | 0021 |
| H-11 | Interface in French; collection and classification handle English and French. | The product is in English: screens, messages, descriptions, prompt and keys, log, documentation. The press stays English and French. | overridden | 0010 |
| H-12 | Two lots: Lot 1 the minimal app; Lot 2 collection, detection, alert, tracking, validation, Telegram (to confirm). | Confirmed, with the manual trigger of Lot 1 requests; both lots built in one run, Lot 1 to a tagged milestone verified end to end, then Lot 2. | settled | 0001 |
| H-13 | Game Score formula; the performance index is the score divided by the minutes played (to confirm). | Confirmed: the indicator does not change, whatever the statistics coverage. | settled | 0012 |
| Q-01 | The owner's development level is unknown, so deployment and operations are described very explicitly. | Settled: the deployment guide is written for a developer. | settled | 0014 |
| Q-02 | Host, database, language model, statistics source and feeds are unchosen; their terms are checked at technical design. | Settled: Vercel Hobby and Neon; the statistics source and the trigger, detection model and backup storage chosen under TRV-11 and TRV-12, fewest accounts first, with service sheets; a failing service is replaced, the reason recorded. | settled | 0002, 0011, 0023, 0024 |
| Q-03 | The 20 to 30 players are not designated. | Settled: the app starts empty and the owner adds them. | settled | 0020 |
| Q-04 | The verdict thresholds are not fixed. | Settled: the H-SEN-10 defaults, as editable settings. | settled | 0021 |

## Open points

None remain. The thirteen open points of the register's first version were settled by rulings on 2026-11-11, and each now sits in the rows above:

- Lot 2 flow of upcoming calendar-derived events, and their tracked cases in Lot 1: VUE-10, ALE-01, SUI-01, SUI-05, TEL-11, TEL-12, IHM-46 (CL-VUE-13, CL-VUE-14, CL-SUI-14, CL-ALE-13, CL-TEL-21, CL-IHM-24).
- When an upcoming calendar-derived event is created, and how it follows changes: TAX-20, SUI-03, SUI-18 (CL-TAX-19, CL-STA-25, CL-SUI-14).
- Articles that report a birthday or a reunion: TAX-18, DET-14, DET-34 (CL-DET-22, CL-TAX-21).
- Former teams known only from uncovered seasons: JOU-13, STA-45, SEN-46 (CL-JOU-18, CL-STA-24).
- Birthday on 29 February: JOU-08 (CL-JOU-17).
- Withdrawing a calendar-derived event: DSN-26, DSN-28 (CL-DSN-09, CL-DSN-19).
- Date tolerance when matching a fingerprint: DET-58, IMP-25, H-IMP-02 (CL-DSN-06, CL-DET-21, CL-IMP-28, CL-IMP-34).
- Player key of a fingerprint, and deletion of a player's data: JOU-24 (CL-JOU-24).
- Whether backups hold the fingerprints: TRV-51, DSN-29 (CL-DSN-08, CL-TRV-05).
- A collected article that matches a fingerprint: COL-34, COL-37, DSN-34 (CL-COL-16, CL-DSN-10).
- Fingerprint horizon when the owner changes the backup retention: DSN-29, SEN-33 (CL-DSN-07).
- Citation marker inside a text value of a research result: IMP-04 (CL-IMP-07).
- Two combined statistics sources: STA-03 (CL-STA-23, CL-JOU-21).

A point that no record, row or ruling settles is never settled inside a pull request: the orchestrator decides, and the answer goes into a record and this register first.

## Readings applied

Where a decision's wording left room, the first version of this register applied the readings below. Rulings have since confirmed all but one.

- Paris time is the default time zone, and the time-zone setting of IHM-14 stays ([0010](../adr/0010-english-product.md)); confirmed by CL-TRV-02 and CL-TRV-16.
- English number format: decimal point, comma for thousands ([0010](../adr/0010-english-product.md)); confirmed by CL-TRV-01.
- The developer level covers the deployment guide, TRV-77 and the operations guide; in-app help, the getting-started guide and empty states still assume no technical knowledge ([0014](../adr/0014-developer-level-deployment-guide.md)); the checklist is CL-TRV-20, the rest stays a reading.
- Calendar derivation runs for active and paused players, the players who may still receive a backtest ([0015](../adr/0015-calendar-derived-event-types.md)); confirmed by CL-JOU-05 and CL-TAX-18.
- Calendar-derived events never take part in correspondences or possible duplicates ([0015](../adr/0015-calendar-derived-event-types.md)); confirmed by CL-IMP-29.
- The doubtful-criterion switch names at most one automatic criterion and creates no new sheet version ([0016](../adr/0016-per-type-doubtful-criterion-switch.md)); confirmed by CL-TAX-17.

## Read this before implementing

1. **Precedence.** For an ID listed in this register, the "What we do instead" column and its record override the French text — and the decision journal too, which otherwise prevails over the other spec documents. The rulings of `docs/engineering/clarifications/` settle what the specs and the records leave unclear, inside them; a row that cites a ruling takes its detail from it. Everywhere else the French spec is authoritative, including every hypothesis marked « à confirmer », which is implemented as written.
2. **Language.** The specs quote French labels, states, messages and examples throughout. Render each with the English term of `docs/engineering/glossary.md`. Only the requirements that prescribe French are listed here; translating a quoted label never changes behavior.
3. **Open points.** Never settle one inside a pull request. Raise it with the orchestrator; the answer is recorded before the affected requirement is implemented.
4. **Tests.** A test of an acceptance criterion changed here asserts the value given here and cites both the criterion and the record, or the ruling the row names.
5. **Changes.** The French specs are frozen. A new deviation needs a record and a row here, in the same pull request as the code that relies on it, or earlier.
