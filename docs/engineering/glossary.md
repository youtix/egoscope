# French–English glossary

The functional specifications in `docs/` are written in French and stay the reference. The product is built in English: screens, Telegram messages, event descriptions, the research and exploration prompts with their JSON keys, the journals, the documentation and the code. This file is the single naming authority between the two.

## 1. How to use this file

- One English name per French term. Look a term up by searching for the French word exactly as the specs spell it, accents and guillemets included.
- Distinct French terms never share an English name. When the specs use one French word for two things, this file gives two English terms and says how to tell them apart (section 4.2). When the specs use two French words for one thing, the second is listed as a synonym in the same row.
- A term that is missing is added to this file in the same pull request that needs it, in the right domain table, with its spec IDs.
- This file wins over any other English rendering: the spec digests, comments, earlier code, an agent's own translation. Code, UI strings, messages and documentation use the names below and no variant of them.
- Columns of the domain tables: **French** as written in the specs; **English** term used in prose and documentation; **Code** identifier (type, property, function or enumeration value); **UI label** in sentence case, when the term is shown; **Meaning** in one line; **IDs** of the owning requirements. "—" means not applicable.
- Wherever the specs require French text in the product ("en français", H-11, TRV-24, TEL-04, IHM-12, DSN-23, DET-21, prompt rule 2.6, H-BKT-05), read "in English": the owner overrode H-11 on 2026-11-11. The press itself is still read in English and in French (COL-05).

## 2. Naming conventions

**Language.** American English: canceled, cancellation, analyze, behavior, catalog, color, labeled, judgment. Plain words over jargon in the interface (TRV-42, IHM-37).

**NBA vocabulary.** Where the NBA has its own English word, use it: game (never "match"), tip-off (never "kickoff"), box score, regular season, play-in tournament, playoffs, postseason, the Finals, series, game number (Game 7), preseason, exhibition game, All-Star Game, offseason, home and away, overtime, ejection, elimination game, trade, signing, release, roster, rookie, win-loss record, minutes. Box-score abbreviations follow NBA.com: PTS, FGM, FGA, 3PM, FTM, FTA, OREB, DREB, AST, STL, BLK, TOV, PF, MIN. A season is labeled `2024-25` (STA-48 says « 2024-2025 »).

**Code.**

- Types, interfaces, classes and enumeration type names in PascalCase: `FollowedPlayer`, `CaseStatus`.
- Properties, variables and functions in camelCase: `displayName`, `withdrawEvent()`.
- Acronyms are written as words: `NbaTeam`, `statsSourceId`, `pwaManifest`.
- Enumeration values are lowercase `snake_case` strings, stored as text: `awaiting_game`, `to_do`. Use string-literal unions, never numeric enums.
- The French word « état » and its synonym « statut » are rendered "status": property `status`, type suffix `Status` (`PlayerStatus`, `GameStatus`, `HealthStatus`).
- Time (decision of 2026-11-11): a property holding an absolute instant (epoch milliseconds, `timestamptz`) ends in `At` (`createdAt`); a property holding a calendar date (`YYYY-MM-DD`, `date`) ends in `On` (`lastGamePlayedOn`); a property that the specs define as "a date, or a date and time" ends in `Date` and travels with its precision (`referenceDate`, `publicDate`, `publicationDate`).
- A foreign key is the camelCase entity name plus `Id`: `eventTypeId`, `alertSheetId`. Every stored player is a followed player, so the key to a `FollowedPlayer` is `playerId`.
- French words never appear in identifiers. Requirement IDs (`JOU-08`, `CA-SEN-03`, `D-12`, `H-SEN-04`, `Q-DSN-01`) keep their French prefixes everywhere, including test names.

**Exchange formats.** JSON keys of the research-result and exploration formats are `snake_case` (section 6). Placeholders in prompts are `{{UPPER_SNAKE_CASE}}`.

**Identifiers with a fixed shape.**

- Event-type identifiers are kebab-case slugs (lowercase ASCII letters, digits and hyphens), immutable once seeded (TAX-02, section 5).
- Route segments are kebab-case: `/backtest-requests/[requestId]`, `/validation-table`.
- Scheduled-task keys, incident kinds and parameter keys are listed in section 9.
- The human-readable backtest-request reference is `REQ-YYYY-NNNN` (the specs' indicative « DEM-2026-0007 » becomes `REQ-2026-0007`, BKT-12).

**Interface.**

- UI labels in sentence case: "Backtest requests", "Request a backtest", "Method and limits". Proper nouns keep their capitals: Egoscope, NBA, Telegram, Game Score, the Finals, All-Star Game.
- Dates shown to the owner (decision of 2026-11-11): Paris time by default, English, day–month–year with month names, 24-hour clock, zone named. Long form "Wednesday 11 November 2026 at 05:10, Paris time"; short form "Wed 18 Nov at 01:30". When a game's US date differs, add it: "Tuesday evening in the US" (IHM-14, TRV-71).
- Numbers use a decimal point and a thousands comma: "+0.80", "1,000". Normalized gaps carry their sign and two decimals (SEN-09); the performance index shows three decimals (STA-12). Below 20 cases, proportions are counts, never percentages: "5 of 7 cases above zero" (SEN-39).

## 3. Terms by domain

### 3.1 Players

| French | English | Code | UI label | Meaning | IDs |
| --- | --- | --- | --- | --- | --- |
| joueur suivi | followed player | `FollowedPlayer`; key `playerId` | Player | NBA player the owner put on the follow list; every event concerns exactly one. | VUE-04, JOU-08 |
| joueur | player | `playerId` | Player | In the specs, a followed player unless the context says otherwise (opponent, candidate). | — |
| liste de suivi, liste des joueurs suivis | follow list | `listFollowedPlayers()` | Followed players | The 20 to 30 followed players. | D-17, JOU-04 |
| identifiant (du joueur) | player ID | `FollowedPlayer.id` | — | Opaque, assigned at addition, never changes, never reused, even after deletion. | JOU-08 |
| nom d'usage | display name | `displayName` | Name | Name as the press most often writes it; on change the old one stays as a variant. | JOU-08, JOU-12 |
| variantes de nom | name variants | `nameVariants` | Name variants | Display name, spelling variants and nicknames searched by detection. | JOU-08, JOU-09 |
| variantes d'écriture | spelling variants | `NameVariantKind` `spelling` | Spelling variants | Forms with or without accents, transliterations, suffix, first name alone. | JOU-08 |
| surnoms | nicknames | `NameVariantKind` `nickname` | Nicknames | Nicknames used by the press. | JOU-08 |
| variante ambiguë, marque « ambiguë » | ambiguous variant | `isAmbiguous` | Ambiguous | Variant also naming other people or a common word; detection needs a corroborating clue. | JOU-09, DET-04 |
| variante partagée | shared variant | — | Shared with {player} | Variant identical to another followed player's; accepted and flagged at entry. | JOU-09, DET-04 |
| homonyme | namesake | — | — | Other person with the same name; the player marker in the prompt prevents confusion. | BKT-29, STA-03 |
| équipe actuelle | current team | `currentTeamId` | Current team | NBA team of the player now; updated from box scores or by hand. | JOU-08, JOU-13, STA-25 |
| historique des équipes | team history | `PlayerTeamChange` | Team history | Dated list of team changes with their origin. | JOU-13 |
| changement d'équipe | team change | `PlayerTeamChange` | Team change | Move to another team; changes no existing event or case. | JOU-13, JOU-14 |
| constaté (origine) | observed | `TeamChangeOrigin` `observed` | Observed | Change seen by the stats update in a box score. | JOU-13 |
| saisi (origine) | entered | `TeamChangeOrigin` `entered` | Entered | Change entered by the owner, confirmed by the first game with the new team. | JOU-13 |
| transfert, échange | trade | — | Trade | Player moved to another team by a trade. | JOU-13, STA-25 |
| signature | signing | — | Signing | Player signed by a team. | STA-25 |
| libération | release | — | Release | Player released by his team. | STA-25 |
| anciennes équipes | former teams | `formerTeamIds` | Former teams | Teams the player played at least one official game for, from team history and box scores (decision Q-TAX-01). | Q-TAX-01, JOU-11 |
| jour anniversaire | birthday | `birthday` (`{ month, day }`) | Birthday | Day and month only, no year: agreed exception to JOU-11 (decision Q-TAX-01). | JOU-11, Q-TAX-01 |
| correspondance statistique, correspondance avec la source de statistiques | stats-source mapping | `StatsSourceMapping` | Stats-source mapping | User-confirmed link between a followed player and his record in the stats source; one per player. | JOU-10, STA-03 |
| « correspondance à établir » | mapping to establish | `StatsSourceMappingStatus` `to_establish` | Mapping to establish | Mention while no candidate is confirmed; no statistics are fetched meanwhile. | JOU-10, IHM-66 |
| candidat (de correspondance) | mapping candidate | `MappingCandidate` | Candidates | Stats-source identity offered for confirmation. | JOU-10, STA-03 |
| état (du joueur) | player status | `PlayerStatus` | Status | active, paused or withdrawn; changed only by the owner. | JOU-15, JOU-22 |
| actif | active | `active` | Active | Counts toward the maximum; detected, alerted, tracked. | JOU-16 |
| en pause, mise en pause | paused, pause | `paused`; `pausePlayer()` | Paused; Pause | Temporarily out of detection and alerts; data and open cases kept. | JOU-17, JOU-18 |
| retiré, retrait (d'un joueur) | withdrawn, player withdrawal | `withdrawn`; `withdrawPlayer()` | Withdrawn; Withdraw | Status change that erases nothing; profiles shown as archived. Not an event withdrawal (4.2). | JOU-19 |
| réactivation, reprise | reactivation | `reactivatePlayer()` | Reactivate | Back to active, subject to the maximum; creates no request. | JOU-20, JOU-18 |
| historique des états | status history | `PlayerStatusChange` | Status history | Dated changes with optional reason. | JOU-15 |
| motif (du changement d'état) | status-change reason | `PlayerStatusChangeReason` | Reason | Optional reason of a status change (section 4). | JOU-15, H-JOU-06 |
| absence prolongée | prolonged absence | `prolonged_absence`; `prolongedAbsenceThreshold` | Prolonged absence | At least N consecutive team games missed (default 10); reason value and parameter. | JOU-22 |
| suggestion de pause | pause suggestion | `PauseSuggestion` | Suggest pausing | To-do item offered after a prolonged absence; refused once, it waits for a new absence. | JOU-22, IHM-20 |
| fin de carrière | end of career | `end_of_career` | End of career | Reason value. | JOU-15 |
| départ de la NBA | left the NBA | `left_nba` | Left the NBA | Reason value. | JOU-15 |
| exposition insuffisante | insufficient exposure | `insufficient_exposure` | Insufficient exposure | Reason value. | JOU-15 |
| critères de choix | selection criteria | — | — | What makes a player worth following (media exposure, playing time). | JOU-01 |
| indicateurs d'aide au choix | selection indicators | — | — | Games played, minutes and exposure shown to help choose. | JOU-02, JOU-03 |
| indicateur d'exposition | exposure indicator | `exposureCount` | Exposure | Collected articles citing the player over the last N days (default 30); survives purge. | JOU-03, DET-57 |
| nombre de matchs joués (saison en cours) | games played this season | `gamesPlayedThisSeason` | Games played | Shown once the mapping is confirmed. | JOU-02, STA-46 |
| temps de jeu moyen | average minutes | `averageMinutesThisSeason` | Minutes per game | Average playing time per game played, current season. | JOU-02, STA-46 |
| date du dernier match joué | last game played | `lastGamePlayedOn` | Last game played | Date of the player's last game played. | JOU-21, STA-46 |
| matchs consécutifs (de son équipe) manqués | consecutive team games missed | `consecutiveTeamGamesMissed` | Consecutive games missed | Team games missed since the last game played; the cause is never stored. | JOU-21, STA-46 |
| blessure longue, suspension, choix de l'entraîneur, raison personnelle | causes of absence | — | — | Never recorded (JOU-21, DSN-15). | JOU-21, STA-13 |
| recrue | rookie | — | Rookie | Player in his first NBA season. | JOU-05 |
| nombre maximal de joueurs actifs | maximum active players | `maxActivePlayers` | Maximum active players | Parameter; blocks additions and reactivations beyond it. | JOU-04 |
| nombre indicatif minimal, minimum indicatif | indicative minimum | `indicativeMinimumPlayers` | Indicative minimum | Parameter; below it the to-do list reminds the owner. | JOU-04, IHM-20 |
| suppression des données (d'un joueur) | player data deletion | `deletePlayerData()` | Delete player data | Irreversible, only for a withdrawn player, after double confirmation; applies event withdrawal to each event. | JOU-24 |
| double confirmation | double confirmation | — | — | Two explicit confirmations before deleting a player's data. | JOU-24 |
| état du backtest (du joueur) | player backtest status | `PlayerBacktestStatus` | Backtest | Derived summary on the player page (section 4). | JOU-25, IHM-21 |
| fiche joueur | player page | route `/players/[playerId]` | — (player's name) | Screen of one followed player. | IHM-22 |
| archivé | archived | `isArchived` | Archived | Display of the profiles of a withdrawn player or type; still recalculated, feed no alert. | SEN-19, TAX-31 |

Merged into other rows: « mise en pause » and « reprise » (into paused and reactivation); « échange » and « transfert » (into trade); « liste des joueurs suivis » (into follow list).

Decisions:

- « correspondance » is "mapping", never "match" (a match is a game) and never "link" (a link is a URL or the Telegram link).
- The confirmed state of a mapping is labeled "Mapping established", not "Confirmed": IHM-50 keeps "confirmed" for the validation table.
- « fiche joueur » is a screen, so "player page"; « fiche » is "sheet" only for documents with their own content (type sheet, alert sheet, service sheet).

### 3.2 Event types

| French | English | Code | UI label | Meaning | IDs |
| --- | --- | --- | --- | --- | --- |
| taxonomie | taxonomy | — | Types | The set of event types and their sheets. | TAX-01–TAX-33 |
| type d'événement | event type | `EventType`; key `eventTypeId` | Type | Category of event defined by a sheet; only validated types serve. | TAX-01, TAX-11 |
| fiche de type, fiche | type sheet | `TypeSheet` | Type sheet | Name, definition, inclusion and exclusion criteria, dating rule, example, caution notes. | TAX-01 |
| identifiant (du type) | type ID | `EventType.id` (slug) | — | Kebab-case slug, immutable, never reused; carried by every research-result event. | TAX-02 |
| nom (du type) | type name | `name` | Name | Display name; changing it is a formal change. | TAX-01, TAX-22 |
| définition | definition | `definition` | Definition | Short sentences an AI can apply without interpretation. | TAX-01 |
| critères d'inclusion | inclusion criteria | `inclusionCriteria` | Inclusion criteria | Allow a yes or no decision from reading an article. | TAX-01, TAX-04 |
| critères d'exclusion | exclusion criteria | `exclusionCriteria` | Exclusion criteria | Say which neighboring type prevails. | TAX-01, TAX-06 |
| règle de datation | dating rule | `datingRule` | Dating rule | How to set the reference date, and whether events are known in advance. | TAX-01, TAX-05 |
| connu à l'avance | known in advance | `knownInAdvance` | Known in advance | Event read from the schedule (birthday, former team); measured on that day's game. | TAX-01, SEN-02 |
| exemple générique | generic example | `genericExample` | Example | Names no real person; uses the placeholders below. | TAX-03 |
| « le joueur A », « l'équipe X », « un média national » | "player A", "team X", "a national outlet" | — | — | Placeholders of every example. | TAX-03 |
| points de vigilance | caution notes | `cautionNotes` | Caution notes | Optional notes on a type's risks; also the methodological notes of the overview. | TAX-01, VUE-09 |
| difficulté de documentation | documentation difficulty | `DocumentationDifficulty` | Documentation difficulty | easy, medium or hard: how completely a backtest can find the type's events. | TAX-01, TAX-08 |
| mention « sujet intime » | intimate subject | `isIntimateSubject` | Intimate subject | Type within the intimate subjects of 13 (bereavement, racism); Telegram never names it. | TAX-01, DSN-35 |
| net | clean | — | Clean | Recognized from a public fact by yes-or-no criteria, names one player, overlaps no type. | TAX-04 |
| datable | datable | — | Datable | Gives each event one reference date, at least to the day. | TAX-05 |
| liste de contrôle « net et datable » | clean-and-datable checklist | `ValidationChecklist` | Clean and datable checklist | Eight points confirmed one by one before validation. | TAX-12 |
| fait public et observable | public, observable fact | — | — | What a type is recognized by, never a state of mind. | TAX-04 |
| état d'esprit | state of mind | — | — | Never measured or supposed. | TAX-04 |
| belles histoires | feel-good stories | — | — | What a type defined by its outcome would retain. | TAX-07, SUI-06 |
| état (du type) | event-type status | `EventTypeStatus` | Status | proposed, validated, rejected or withdrawn. | TAX-10 |
| proposition de type, proposition | type proposal | `EventType` with status `proposed` | Proposal | Type in proposed status, used in no calculation. | TAX-15–TAX-18 |
| type candidat | candidate type | — | — | One of the nine types of the journal, seeded as proposals. | TAX-15, D-12 |
| ébauche, ébauches des types candidats, ébauches de départ | starter sheet | `starterSheets` (seed data) | — | Annex content loaded at first start-up for the nine candidates. | TAX-15, H-TAX-05 |
| origine (du type) | type origin | `EventTypeOrigin` | Origin | scoping, exploration or detection. | TAX-15 |
| cadrage | scoping | `scoping` | Scoping | The design interviews that produced the nine candidates. | TAX-15 |
| validation, valider | validation, validate | `validateEventType()` | Validate | Explicit act of the owner after a complete sheet and the checklist; creates version 1. | TAX-12, TAX-20 |
| rejet, rejeter | rejection, reject | `rejectEventType()` | Reject | Ends a proposal with a reason; kept so it is not proposed again. | TAX-13 |
| motif de rejet | rejection reason | `TypeRejectionReason` | Reason | Closed list (section 4). | TAX-13, H-TAX-04 |
| réouverture, rouvrir | reopening, reopen | `reopenEventType()` | Reopen | Rejected back to proposed, with its sheet. | TAX-14 |
| retrait (d'un type) | type withdrawal | `withdrawEventType()` | Withdraw | Validated to withdrawn; erases no event; profiles archived. | TAX-31 |
| motif de retrait | withdrawal reason | `withdrawalReason` | Reason | Free text, required; automatic for merge and split. | TAX-31 |
| « fusionné dans » | "merged into" | `merged_into` | Merged into {type} | Automatic withdrawal reason of absorbed types. | TAX-27 |
| « scindé en » | "split into" | `split_into` | Split into {types} | Automatic withdrawal reason of a split type. | TAX-29 |
| réactivation (d'un type) | type reactivation | `reactivateEventType()` | Reactivate | Withdrawn back to validated, through the checklist again. | TAX-32 |
| prompt d'exploration | exploration prompt | `ExplorationPrompt` | Explore new types | Text the owner pastes into a deep-research AI to get type proposals. | TAX-16 |
| général, ciblé (mode) | general, targeted | `ExplorationMode` | General; Targeted | Find new types, or deepen one proposal or idea. | TAX-16 |
| retour d'exploration | exploration response | `ExplorationResponse` | — | JSON pasted back, format `egoscope-exploration`; kept only as a draft. | TAX-17, DSN-32 |
| aperçu (d'exploration) | exploration preview | `ExplorationPreview` | Preview | Proposed types with missing items and possible duplicates; the owner ticks what to create. | TAX-17 |
| doublon possible (d'un type) | possible duplicate type | — | Possible duplicate | Name or definition close to an existing type, whatever its status. | TAX-17 |
| recouvrements possibles | possible overlaps | JSON `possible_overlaps` | Possible overlaps | Existing types a proposed type may overlap. | TAX-16 |
| sources d'illustration | illustration sources | `IllustrationSource` | Illustration sources | Real articles an AI cites to justify a proposal; kept apart from the sheet. | TAX-03 |
| liste « à ne pas reproposer » | do-not-repropose list | `doNotReproposeList` | Do not propose again | Pending proposals, rejected and withdrawn types, reduced to name and definition. | TAX-11, TAX-18, DET-14 |
| occurrence | occurrence | `TypeOccurrence` | Occurrences | New fact matching an entry of the do-not-repropose list, added instead of a new proposal. | TAX-18 |
| nombre d'occurrences | occurrence count | `occurrenceCount` | Occurrences | Shown on the sheet of a pending proposal, rejected or withdrawn type. | TAX-18 |
| propositions proches | similar proposals | — | Similar proposals | Proposals close enough to be grouped as occurrences. | TAX-18, H-TAX-12 |
| rattacher, détacher (une occurrence) | attach, detach | — | Attach; Detach | Group a proposal into another, or split an occurrence off. | TAX-18 |
| version de fiche | sheet version | `TypeSheetVersion`; `sheetVersion` | Version | Dated content of a sheet; every event keeps the version it was qualified under. | TAX-20–TAX-23 |
| historique des modifications | sheet change history | `TypeSheetChange` | Change history | Every change of a validated sheet: date, before, after, qualification, reason. | TAX-21 |
| qualification de la modification | change qualification | `SheetChangeQualification` | Kind of change | formal or substantive. | TAX-22 |
| modification de forme | formal change | `formal` | Formal | Does not change which facts belong; no new version. | TAX-22 |
| modification de fond | substantive change | `substantive` | Substantive | Changes which facts belong; new version; broadens, narrows or both. | TAX-22 |
| élargit, restreint, les deux | broadens, narrows, both | `SubstantiveChangeScope` | Broadens; Narrows; Both | Scope of a substantive change. | TAX-22, TAX-24, TAX-25 |
| requalification, requalifier, « à requalifier » | requalification, requalify, to requalify | `to_requalify` | To requalify | After a narrowing, each older event is judged against the new version. | TAX-25 |
| conforme à la nouvelle version | conforms to the new version | `conforms` | Conforms | Requalification choice. | TAX-25 |
| réaffecté à un autre type validé | reassigned to another validated type | `reassigned` | Reassign to another type | Requalification choice. | TAX-25 |
| non conforme | non-conforming | `non_conforming` | Does not conform | Requalification choice: the event is erased with its case, counted on the type sheet. | TAX-25, TAX-26 |
| effacé, effacement (requalification, scission) | erased, erasure | `erased` | Erased | Removal with a withdrawal's scope, counted on the type sheet, not in the withdrawn-events counter. | TAX-25, TAX-29 |
| fusion, fusionner | type merge, merge | `mergeEventTypes()` | Merge | Two or more validated types into a surviving one. | TAX-27 |
| type subsistant | surviving type | `survivingTypeId` | Surviving type | Type kept by a merge; its sheet gets a new version. | TAX-27 |
| type absorbé | absorbed type | `mergedIntoTypeId` | — | Type withdrawn by a merge; its ID is attached to the survivor at import. | TAX-27, TAX-28 |
| scission, scinder, type scindé | split, split type | `splitEventType()`; `splitIntoTypeIds` | Split | One validated type into several validated in one act. | TAX-29, TAX-30 |
| répartir, « à répartir », répartition | distribute, to distribute, distribution | `to_distribute` | To distribute | Assigning a split type's events one by one to the new types. | TAX-29 |
| fiches transmises | transmitted sheets | — | — | Current versions of validated sheets, in full, sent to prompt, import, calculation, classification. | TAX-33 |
| statut particulier (ébauche) | special status | — | — | Note on the former-team draft: proposed in scoping, not taken up by the owner. | Annex |

Type-sheet vocabulary used by the starter sheets:

| French | English | Code | UI label | Meaning | IDs |
| --- | --- | --- | --- | --- | --- |
| record de la ligue, record de l'histoire de l'équipe | league record, franchise record | — | — | Records that qualify for the record-approach type. | Annex |
| jalon de carrière | career milestone | — | — | Milestone the press presents as historic. | Annex |
| série record de défaites | record losing streak | — | — | Example of a negative record. | Annex |
| balayage | sweep | — | — | Series lost 4-0. | Annex, D-34 |
| match à fort enjeu | high-stakes game | — | — | Game whose outcome decides a qualification, an elimination, a title or a final ranking. | SEN-14, D-19 |
| tourmente médiatique | media storm | — | Media storm | Wave of negative coverage centered on the player. | Annex |
| fait déclencheur | triggering fact | — | — | Public fact that starts a media storm. | Annex |
| seuil de couverture | coverage threshold | — | — | Outlets and days needed for a media storm (sheet value). | Annex, TRV-38 |
| retrouvailles | reunion | — | — | First game against a former team. | Annex |

Merged into other rows: « proposition » (into type proposal); « fiche » (into type sheet when it means a type sheet); « ébauches de départ » (into starter sheet).

Decisions:

- « ébauche » is "starter sheet" because "draft" is taken by « brouillon » (import draft).
- « retour d'exploration » is "exploration response", distinct from "research result" (« résultat de recherche »).
- « net » keeps its literal rendering "clean" as a term of art, always paired with "datable".

### 3.3 Events and cases

| French | English | Code | UI label | Meaning | IDs |
| --- | --- | --- | --- | --- | --- |
| événement | event | `Event`; key `eventId` | Event | Public, dated fact about one followed player, likely to touch his ego, of one event type. | VUE-04, DSN-06 |
| fait | fact | — | — | What an article or a source reports; one fact gives one event. | TAX-06, BKT prompt 2.9 |
| fait public et daté | public, dated fact | — | — | The only kind of fact an event may rest on. | DSN-01 |
| événement détecté | detected event | `Event` with origin `detected` | Detected event | Event found by daily detection from collected articles (Lot 2). | DET-24, DET-37 |
| événement historique | historical event | `Event` with origin `historical` | Historical event | Past event reported by a backtest and saved at import. | IMP-30 |
| origine (de l'événement) | event origin | `EventOrigin` | Origin | detected or historical; fixed by the first recording. | DSN-06, IMP-27 |
| date de référence | reference date | `referenceDate` (+ `referenceDatePrecision`) | Reference date | Moment the fact became public, with its precision. | TAX-05, DET-30, DSN-06 |
| précision (de la date de référence, de l'instant retenu) | precision | `DatePrecision` | Precision | exact, approximate or none (section 4). | COL-20, DET-30, DSN-06 |
| date publique | public date | `publicDate`; JSON `public_date` | Public date | A historical event's reference date as the research reports it (date, or date and time). | BKT format, IMP-12 |
| instant de référence | reference instant | `referenceInstant` | — | Instant the event is deemed public, used to find the measured game; date-only means end of day, Pacific time. | SEN-01, SEN-02 |
| provenance de l'instant de référence | reference-instant origin | `ReferenceInstantOrigin` | — | known instant, date only, known in advance, or uncertain-precedence shift (section 4). | SEN-01, SEN-02, SEN-44 |
| devenu public | became public | — | — | The moment that dates an event; never the moment the fact happened, if earlier. | TAX-05 |
| source (d'un événement) | event source | `EventSource` | Sources | Press article cited for an event: link, outlet, title, publication date; nothing else. | DSN-06, DSN-08 |
| lien | link | `url`; JSON `url` | Link | Address of the article, kept exactly as published. | DSN-08, H-DSN-04 |
| média | outlet | `outlet`; JSON `outlet` | Outlet | Name of the media outlet. | DSN-08 |
| titre | title | `title`; JSON `title` | Title | Article title as published, in its own language. | DSN-08, H-BKT-05 |
| date de publication | publication date | `publicationDate`; JSON `publication_date` | Published | Date, or date and time, of the article. | DSN-08 |
| article de référence | reference article | `referenceArticleId` | Reference article | Article that gives a detected event its reference date. | DET-30, DSN-06 |
| description courte et neutre, description | description | `description` | Description | One factual, neutral sentence under the wording rules of 13 (max 200 characters). | DSN-19–DSN-23 |
| indications de contexte, champs de contexte | context indications | `ContextIndications`; JSON `context` | Context | Return from injury and game stakes, closed values, never a narrative. | H-09, D-19, DSN-07 |
| retour de blessure | return from injury | `injuryReturn`; JSON `injury_return` | Return from injury | yes, no or unknown: the press presents the game as a return from an injury absence. | SEN-13, DSN-07 |
| enjeu du match | game stakes | `gameStakes`; JSON `game_stakes` | Game stakes | high, normal or unknown: the outcome decides a qualification, elimination, title or final ranking. | SEN-14 |
| provenance, origine (d'une indication de contexte) | indication origin | `ContextIndicationOrigin` | Origin | research, classification, user or calculation. | SEN-18, H-09, ALE-08 |
| confiance de détection | detection confidence | `detectionConfidence` | Detection confidence | Score 0–100 the classifier gives a fact; a self-assessment, not a probability. | DET-16, DET-25 |
| confiance de la recherche | research confidence | `researchConfidence`; JSON `confidence` | Research confidence | high, medium or low, set by the research AI per prompt rule 2.8. | BKT prompt 2.8, IMP-15 |
| version de fiche (de l'événement) | sheet version | `sheetVersion` | Sheet version | Version of the type sheet the event was qualified under. | TAX-23, DET-53, IMP-30 |
| qualifier, qualifié (sous une version) | qualify, qualified | — | — | Recognize a fact as an event of a type under one sheet version. | TAX-23 |
| marque | mark | `EventMark` | — | Flag set on an event and later lifted or confirmed (section 4). | DET-32, DET-33, DET-58 |
| « datation à vérifier » | dating to verify | `dating_to_verify` | Dating to verify | The article places the fact before its own publication and a game may have been played in between. | DET-32, SEN-45 |
| « détecté après le coup d'envoi » | detected after tip-off | `detected_after_tip_off` | Detected after tip-off | The expected game's tip-off had passed when the event was created. | DET-33 |
| antériorité | precedence | `Precedence` | Precedence | Of a historical event: its oldest source compared with the measured game's tip-off. | IMP-18, SEN-44 |
| écarter, écartement, écarté | dismiss, dismissal, dismissed | `dismissEvent()`; status `dismissed` | Dismiss; Dismissed | Owner corrects a wrong detection; the event is kept, leaves all calculations, reversible. | DET-43–DET-46, H-08 |
| réintégrer, réintégration (d'un événement) | reinstate, event reinstatement | `reinstateEvent()` | Reinstate | Undo a dismissal; the event re-enters calculations. | DET-45 |
| retirer, retrait (d'un événement) | withdraw, event withdrawal | `withdrawEvent()` | Withdraw | Permanent erasure of an event and its traces for a sensitivity reason; only the counter remains. | DSN-26–DSN-29 |
| compteur des événements retirés, compteur global des événements retirés | withdrawn-events counter | `withdrawnEventCount` | Withdrawn events | Global, anonymous count since go-live; also counts events declined for sensitive data. | DSN-29, VUE-09 |
| supprimer, suppression (d'un événement historique) | delete, deletion | `deleteHistoricalEvent()` | Delete | Removal of a historical event for an error, with a reason; traced. | IMP-33 |
| corriger, correction (d'un événement) | correct, correction | `correctEvent()` | Correct | Change of type, date, description, sources, context, confidence or note. | IMP-32, DET-47, DET-48 |
| historique des corrections | correction history | `correctionHistory` | Correction history | What changed and when; never the old value of a description. | DET-52, IMP-32, D-20 |
| cas | case | `Case`; key `caseId` | Case | One event (or several of the same type) and its measured game; the unit of calculation. | SEN-05, SEN-07 |
| match mesuré | measured game | `measuredGameId` | Measured game | First game the player plays after the event became public. | H-02, SEN-03 |
| rattacher, rattachement (au match mesuré) | attach, attachment | `attachToMeasuredGame()` | — | Linking an event to its measured game. | SEN-01–SEN-05 |
| délai (maximal) de rattachement | attachment window | `attachmentWindowDays` | Attachment window | Days after the reference instant within which a game must be played (default 10). | SEN-04 |
| absence | absence | — | — | Team game the player did not play; skipped and counted for the injury-return criterion. | SEN-03, SEN-13 |
| origine (du cas) | case origin | `CaseOrigin` | Origin | historical or tracked; written in full on screen. | SEN-21, IHM-46 |
| cas historique | historical case | `historical` | Historical | Case born from a historical event. | SEN-21 |
| cas suivi | tracked case | `tracked` | Tracked | Case born from a detected event, observed in real conditions. | SUI-01 |
| état (du cas) | case status | `CaseStatus` | Status | awaiting game, measured, excluded or not measurable, always with a reason. | SEN-07 |
| motif (de l'état) | status reason | `CaseStatusReason` | Reason | Why a case is in its status (section 4). | SEN-07, SEN-47 |
| cas valide | valid case | `isValid` (status `measured`) | Valid case | Measured case with its gap computed and no doubtful-case criterion triggered; only these enter a verdict. | SEN-07 |
| cas douteux | doubtful case | status `excluded` | Doubtful case | Case excluded because of a confounding factor. | SEN-11 |
| exclu, exclure, exclusion | excluded, exclude, exclusion | status `excluded`; `excludeCase()` | Excluded; Exclude | A doubtful case, automatically or by hand; reversible. | SEN-11, SEN-17 |
| facteur parasite | confounding factor | — | Confounding factor | Circumstance that may imitate an ego effect (playing time, injury return, stakes, opponent). | D-19, SEN-11 |
| critère (de cas douteux) | doubtful-case criterion | `DoubtfulCaseCriterion` | Criterion | Condition that makes a case doubtful (section 4). | SEN-11–SEN-15 |
| critère retenu | triggered criterion | `triggeredCriteria` | Criteria met | Criterion that applies to the case, listed with its triggering values. | SEN-11 |
| signalée, calculée (condition) | flagged, calculated | `CriterionCondition` | Flagged; Calculated | Whether a criterion fired from a context indication or from statistics. | SEN-13, SEN-14 |
| non évaluable | not evaluable | `opponentStrengthNotEvaluable` | Not evaluable | Opponent criterion that cannot be computed; not triggered, mentioned on the case. | SEN-15 |
| signalé pour revue, signalement | flagged for review, review flag | `ReviewFlag` | Flagged for review | Situation shown to the owner without automatic exclusion. | SEN-16 |
| décision manuelle | manual decision | `ManualDecision` | Manual decision | Owner excludes a measured case or reinstates an excluded one, with a closed-list reason. | SEN-17 |
| exclusion manuelle | manual exclusion | `exclude` | Exclude | Manual decision of kind exclude. | SEN-17 |
| réintégrer, réintégration (d'un cas) | reinstate, case reinstatement | `reinstate` | Reinstate | Manual decision of kind reinstate. | SEN-17 |
| cas concomitant, « concomitant » | co-occurring case | `isCoOccurring`; `coOccurringTypeIds` | Co-occurring | Case whose measured game is also another type's; one case per type, each marked. | SEN-06 |
| événements regroupés (dans un cas existant) | grouped events | `groupedEventCount` | Grouped events | Same-type events on the same game, joined into one case. | SEN-05, SEN-32 |
| comptage exhaustif | exhaustive counting | — | — | Every event of a validated type yields a case, whatever the game result. | SEN-32, H-01 |
| décompte | tally | `ProfileTally` | Tally | Counts of events and cases by status and reason, with invariants. | SEN-20, SEN-32 |
| sortie du décompte | tally exit | `TallyExitReason` | Left the tally | Event that left the tally, by reason; withdrawals are never shown. | SEN-33 |
| historique (du cas) | case history | `CaseHistoryEntry` | History | Append-only status, measured-game and gap changes. | SEN-08, Données manipulées 08 |

Merged into other rows: « description courte », « description factuelle » (into description); « champs de contexte » (into context indications); « provenance » (into origin); « cas regroupé » (into grouped events); « mesuré » (status value, section 4).

Decisions:

- « concomitant » is "co-occurring", not "concurrent", which reads as a programming term.
- « critère retenu » is "triggered criterion": "retained" is kept for « dispersion retenue », « couverture retenue » and « instant de publication retenu », where it means "chosen".
- « marque » (a flag with a lifecycle) is "mark"; « mention » (a displayed note) is "notice" (section 3.16); they are different things.

### 3.4 Backtest requests and the research prompt

| French | English | Code | UI label | Meaning | IDs |
| --- | --- | --- | --- | --- | --- |
| backtest | backtest | — | Backtest | Reconstruction of all past events of a player, then measurement of his games after them. | 00 glossary |
| demande de backtest | backtest request | `BacktestRequest`; key `backtestRequestId` | Backtest request | Request to the owner to run a deep research for one player; at most one to do per player. | BKT-01, BKT-07 |
| référence (de la demande) | request reference | `reference`; JSON `request_reference` | Reference | Unique, stable, readable code `REQ-YYYY-NNNN`, copied into the prompt and the result. | BKT-12 |
| nature (de la demande) | request kind | `BacktestRequestKind` | Kind | initial, supplement or full redo. | BKT-01, BKT-08, BKT-09 |
| demande initiale, initiale | initial request | `initial` | Initial request | First request of an unprofiled player: all validated types over his whole career. | BKT-08, H-05 |
| complément, demande complémentaire | supplementary request | `supplement` | Supplementary request | Covers only what the player's coverage lacks: a type validated since, elapsed time, an import's gap. | BKT-04–BKT-06, BKT-09 |
| reprise complète | full redo | `full_redo` | Full redo | Redoes every validated type over the whole career; the import may replace existing events. | BKT-09, IMP-29 |
| « compléter » (action) | fill gaps | — | Fill gaps | Default choice for a profiled player: creates a supplementary request. | BKT-01, IHM-22 |
| « refaire » (action) | redo | — | Redo | Choice for a profiled player: creates a full redo. | BKT-01, IHM-22 |
| « Demander un backtest » | request a backtest | `createBacktestRequest()` | Request a backtest | Manual creation from the player page. | BKT-01, IHM-22 |
| déclencheur | request trigger | `BacktestRequestTrigger` | Trigger | What created the request (section 4). | BKT-01, BKT-03–BKT-06 |
| origine (de la demande) | request origin | `BacktestRequestOrigin` | Origin | Derived from trigger and kind: from detection, manual or supplementary. | BKT Données manipulées |
| types demandés | requested types | `requestedTypes` | Requested types | Each with its sheet version and requested period. | BKT-08, BKT-09 |
| période demandée | requested period | `periodStart`, `periodEnd` | Period | Per requested type. | BKT-09 |
| période globale | overall period | `overallPeriod` | Period | Earliest start to latest end of the requested types. | BKT Données manipulées |
| état (de la demande) | request status | `BacktestRequestStatus` | Status | to do, imported or canceled. | BKT-13, BKT-14 |
| motif d'annulation | cancellation reason | `cancellationReason` | Reason | Optional free text; system value « joueur retiré ». | BKT-14 |
| imports rattachés | linked imports | `importIds` | Imports | Every import that referenced the request. | BKT Données manipulées |
| refus restants | remaining refusals | `remainingRefusals` | Remaining refusals | Events refused at the request's last import, missing until corrected and re-imported. | IMP-24, H-IMP-12 |
| échéance, échéance du prochain match | deadline | `deadline` (computed) | Deadline | Next game, or for an urgent request the nearest upcoming measured game. | BKT-16, BKT-18, H-07 |
| urgence, urgente | urgency, urgent | `isUrgent` (computed) | Urgent | Lot 2: an attached detected event's measured game is upcoming. | BKT-18 |
| rang | rank | `rank` (computed) | — | Position in the to-do list. | BKT-17, BKT-18 |
| « à venir », « joué » (match mesuré d'un événement rattaché) | upcoming, played | `MeasuredGameTiming` | Upcoming; Played | Whether an attached event's measured game is still ahead. | BKT-18 |
| mise à jour, réduction (d'une demande) | update, reduction | `updateRequest()`, `reduceRequest()` | Update; Reduce | Regenerate the prompt under the same reference, or shorten its period. | BKT-15 |
| couverture, couverture de backtest | coverage | `BacktestCoverage` | Coverage | Per player, types and periods covered by an imported result, even an empty one. | BKT-10 |
| période couverte | covered period | `coveredPeriods` | Covered period | One per import, with the sheet version it was researched under. | BKT-10 |
| types non couverts | uncovered types | `uncoveredTypes` | Not covered | Validated types with no covered period. | BKT-04, BKT-30 |
| premier jour non couvert | first uncovered day | `firstUncoveredOn` | — | Start of a supplement's period for an already covered type. | BKT-09 |
| joueur profilé, déjà traité, déjà profilé | profiled player | `isProfiled` | Profiled | At least one research result imported, even empty. | H-VUE-02, BKT-10, D-29 |
| joueur non profilé, sans backtest, pas encore de backtest | unprofiled player | `!isProfiled` | No backtest yet | No research result ever imported. | BKT-10, TEL-09, D-24 |
| aiguillage | routing | `routeDetectedEvent()` | — | Lot 2: what a detected event triggers depending on profile and coverage. | DET-37–DET-40, BKT-30 |
| besoin de backtest | backtest need | `BacktestNeed` | — | Signal from detection; this domain decides whether to create a request. | DET-38, DET-40 |
| recherche approfondie | deep research | — | Deep research | Mode of an AI that explores the web at length and returns a sourced answer, used outside the app. | 00 glossary, VUE-07 |
| IA de recherche, IA de recherche approfondie | deep-research AI | — | Research AI | Any tool the owner chooses; the app never calls it. | BKT-19, VUE-07 |
| prompt de recherche | research prompt | `ResearchPrompt` | Prompt | Text produced for the request and pasted by the owner into the research AI. | BKT-20–BKT-22 |
| texte de référence (du prompt) | reference text | — | — | The prompt wording the product renders; English version owned by the prompt module. | BKT-21 |
| « Copier », « Partager » | copy, share | — | Copy; Share | Put the whole prompt on the clipboard, or open the phone's share sheet. | BKT-20 |
| date de la dernière copie | last copied at | `lastCopiedAt` | — | A prompt changed after a copy triggers a stale-copy warning. | BKT-20 |
| parties variables | placeholders | `{{...}}` | — | Variable parts, all replaced before display (section 6). | BKT-22 |
| « non renseigné » | not provided | — | not provided | Replaces an empty sheet item in the prompt. | BKT-22 |
| repère du joueur | player marker | `{{PLAYER_MARKER}}` | — | First NBA game date, or that it is unknown, to avoid namesakes. | BKT prompt, BKT-29 |
| résultat de recherche | research result | `ResearchResult` | Research result | JSON returned by the AI and pasted into the app; events only, never statistics. | D-27, BKT-23 |
| résultat vide | empty result | — | — | Valid result with no event; counts as a full backtest. | BKT-23 |
| format de retour, version du format | return format, format version | `formatVersion`; JSON `format_version` | Format version | `egoscope-backtest`, version `1.0` for the English contract. | BKT-24 |
| piste non vérifiée | unverified lead | `UnverifiedLead`; JSON `unverified_leads` | Unverified leads | Fact glimpsed but not substantiated; never counted; only its count per type is kept. | BKT format, H-IMP-10 |
| limites (déclarées par l'IA) | declared limitations | `declaredLimitations`; JSON `limitations` | Limitations | Seasons, types or sources the research could not explore properly. | BKT format, H-IMP-10 |
| réserve (`non_verifie`), réserve sur ce qui n'a pas pu être vérifié | unverified note | `unverifiedNote`; JSON `unverified_note` | Not verified | What the AI could not verify for one event. | BKT format, DSN-06 |
| précision (`contexte.precision`), précision facultative | context detail | JSON `context.detail` | Detail | One optional sentence to help check the context; shown in the preview, never stored. | BKT format, DSN-07 |
| contexte (du match suivant) | next-game context | `ContextIndications` | Context | Context of the first NBA game after the event; « inconnu » until it is played. | BKT prompt 2.7, H-BKT-08 |
| un fait, un événement | one fact, one event | — | — | A fact reported by several articles is one event with up to N sources. | BKT prompt 2.9, H-BKT-06 |
| hors champ | out of scope | — | — | Facts outside the period, about the whole team, or of an undefined type. | BKT prompt 2.10 |
| nombre maximal de sources par événement | maximum sources per event | `maxSourcesPerEvent` | Maximum sources per event | Parameter, default 3. | H-BKT-09 |
| période réellement couverte | actually covered period | JSON `covered_period` | — | What the AI really processed; an earlier end signals a cut answer. | BKT prompt 2.11 |

Merged into other rows: « complément » (into supplementary request); « déjà traité », « déjà profilé » (into profiled player); « sans backtest », « non profilé », « pas encore de backtest » (into unprofiled player); « IA de recherche » (into deep-research AI).

Decisions:

- The request kind « complément » is "supplement" and the import mode « complément » is "addition" (section 3.5): one French word, two things.
- « compléter » is "Fill gaps", not "Complete", which would read as "mark as done".
- « nature » is "kind" in code, never "type", which is reserved for event types.

### 3.5 Import

| French | English | Code | UI label | Meaning | IDs |
| --- | --- | --- | --- | --- | --- |
| import, importer | import | `Import`; key `importId` | Import | Pasting, checking and saving a research result for a request. | IMP-01–IMP-37 |
| « Coller le résultat » | paste result | — | Paste result | Entry action from the request screen or the in-progress banner. | IMP-01, IHM-27 |
| écran d'import | import screen | route `/backtest-requests/[requestId]/import` | Import | Always tied to one request. | IHM-28 |
| brouillon d'import, brouillon | import draft | `ImportDraft` | Draft | The only copy of the pasted text, on the device and in the app; never saved data, trace, journal or backup. | IMP-03, IHM-42, DSN-32 |
| texte collé | pasted text | `pastedText` | — | The JSON as pasted, kept only in the draft. | IHM-42, DSN-32 |
| « Vérifier » | check | — | Check | Runs the checks and opens the preview or the blocking error. | IHM-28 |
| erreur bloquante | blocking error | `BlockingError` | — | Whole result refused; nothing saved; explanation and correction message offered. | IMP-09, IHM-29 |
| aperçu (d'import) | import preview | `ImportPreview` | Preview | Summary then detail of what saving would do. | IMP-22 |
| « Enregistrer » | save | `saveImport()` | Save | Atomic save of the accepted events, coverage and trace. | IMP-30 |
| « Abandonner » | discard | — | Discard | Leaves the import; nothing is saved, the draft is erased. | IMP-03 |
| bilan (de l'import) | import summary | `ImportSummary` | Summary | Tally shown after saving, with the supplement and correction message if needed. | IMP-35 |
| décompte (de l'import) | import tally | `ImportTally` | — | Events added, of which with warning; duplicates; sources attached; ignored; refused; deleted. | IMP-22, IMP-31 |
| trace (de l'import) | import trace | `ImportTrace` | Import history | What an import did; keeps no withdrawn event and no pasted text. | IMP-31, DSN-32 |
| numéro d'ordre (de l'import) | import sequence number | `sequenceNumber` | No. | Given to each saved import. | IMP-31 |
| mode (d'import) | import mode | `ImportMode` | Mode | first import, addition or replacement. | IMP-22, IMP-28, IMP-29 |
| premier import | first import | `first_import` | First import | No historical event yet in the result's types and period. | IMP-22 |
| complément (mode d'import) | addition | `addition` | Add to existing | Default mode: only events without a correspondence are added; nothing deleted. | IMP-28, H-IMP-06 |
| remplacement | replacement | `replacement` | Replace existing | Explicit: deletes earlier historical events of the covered types and period, then adds. | IMP-29 |
| issue (d'un événement à l'import) | import outcome | `ImportOutcome` | — | Exactly one per event of the result (section 4). | IMP-19 |
| ajouté, ajouté avec avertissement | added, added with warning | `added`, `added_with_warning` | Added; Added with warning | Import outcomes. | IMP-19 |
| doublon, non ajouté | duplicate, not added | `duplicate_not_added` | Duplicate, not added | Import outcome; new sources go to the existing event. | IMP-19, IMP-26 |
| ignoré | ignored | `ignored` | Ignored | Import outcome: outside the request's scope; not a refusal. | IMP-19, IMP-10–IMP-12 |
| refusé, refus | refused, refusal | `refused` | Refused | Import outcome: a defect the AI can correct. | IMP-19, H-IMP-01 |
| non enregistré pour donnée sensible | not recorded: sensitive data | `not_recorded_sensitive_data` | Not recorded: sensitive data | Import outcome chosen by the owner; increments the withdrawn-events counter. | IMP-37, DSN-29 |
| avertissement (d'import) | import warning | `ImportWarning` | Warning | Kept on the saved event and visible on its page. | IMP-19 |
| avertissements d'ensemble | result warnings | `resultWarnings` | — | Missing format, ignored types, clamped period, unknown fields. | IMP-06–IMP-16 |
| motif (de refus, d'ignorance) | reason | `reason` | Reason | Why an event was refused or ignored; kept with position, type and date only. | IMP-19, IMP Données manipulées |
| rang (d'un événement dans le résultat) | position | `position` | — | "4th event"; not the request's rank. | IMP-20 |
| résultat coupé, récupération | truncated result, recovery | `truncationRecovery` | — | Text cut before the end; complete sorted events can be recovered. | IMP-05, H-IMP-04 |
| couverture déclarée | declared coverage | — | Declared coverage | Types and period the result says it covered. | IMP-10 |
| couverture retenue | retained coverage | `retainedCoverage` | Covered | Per type: requested period intersected with the declared period. | IMP-10 |
| manques, manques constatés | coverage gaps | `coverageGaps` | Gaps | Requested types not declared and missing periods. | IMP-10, BKT-06 |
| correspondance (entre événements), se correspondre | correspondence, correspond | `eventsCorrespond()` | — | Same type within 2 days, or a shared cleaned link. | IMP-25, H-IMP-03 |
| doublon possible (à l'import) | possible duplicate | `PossibleDuplicate` | Possible duplicate | Correspondence the owner must judge before saving. | IMP-25 |
| « même fait », « faits distincts » | same fact, distinct facts | `PossibleDuplicateAnswer` | Same fact; Distinct facts | Answers to a possible duplicate. | IMP-25 |
| « événements distincts » | distinct events | `keep_as_distinct` | Distinct events | Override that adds an event matching an existing historical event. | IMP-26 |
| doublon d'un événement historique (import) | duplicate of a historical event | — | — | Not added; its new sources attach to the existing event. | IMP-26 |
| doublon d'un événement détecté | duplicate of a detected event | — | — | Never added; a dismissed one is reinstated instead. | IMP-27 |
| sondage des sources | source spot check | `SourceSpotCheck` | Spot-check sources | Optional: open 3 random sources and judge each. | IMP-23, H-IMP-09 |
| « conforme », « non conforme », « inaccessible » | consistent, inconsistent, inaccessible | `SpotCheckVerdict` | Consistent; Inconsistent; Inaccessible | Spot-check verdict on a source. | IMP-23 |
| vérification des liens, « introuvable » | link check, not found | `LinkStatus` `not_found` | Not found | After saving, each link is opened; a dead page is marked, nothing deleted. | IMP-17, H-IMP-08 |
| domaines non admis | disallowed domains | `disallowedDomains` | Disallowed domains | Social networks, forums, collaborative encyclopedias, video platforms (parameter). | IMP-14, H-IMP-13 |
| avance tolérée (d'une source sur la date publique) | tolerated source lead | `toleratedSourceLeadDays` | — | How much earlier than the public date a source may be. | IMP-14, TRV-38 |
| taille maximale du texte collé | maximum pasted size | `maxPastedSize` | — | Parameter (default 2 MB). | IMP-02 |
| texte non sûr | untrusted text | — | — | Result texts shown as plain text; links open only on tap. | IMP-16 |
| champs inconnus | unknown fields | — | — | Ignored, never stored, signaled once. | IMP-16 |
| message de correction | correction message | `CorrectionMessage` | Copy the correction message | Ready-to-copy message asking the AI to fix and resend the full JSON. | IMP-21, IHM-43 |
| import partiel | partial import | — | Save accepted events | Saving accepted events while some are refused, after a confirmation. | IMP-24 |
| correction manuelle | manual correction | `correctHistoricalEvent()` | Correct | Edit of a historical event under the import checks. | IMP-32 |
| suppression manuelle, motif de suppression | manual deletion, deletion reason | `HistoricalEventDeletionReason` | Delete; Reason | Closed list (section 4); never because of the game that followed. | IMP-33 |
| trace de suppression | deletion trace | `EventDeletionTrace` | — | Date, reason, type and public date of a deleted event. | IMP-33 |
| import d'origine | origin import | `originImportId` | Origin import | Import that brought a historical event. | IMP-31 |
| « Backtest en cours » (bandeau) | backtest in progress | — | Backtest in progress | Home banner of a request whose prompt was copied (section 3.13). | IHM-40 |

Merged into other rows: « refus » (into refused); « manques constatés » (into coverage gaps).

Decisions:

- « refusé » (import) is "refused" and « rejeté » (type) is "rejected": they never share a word. « refus restants » is "remaining refusals".
- « conforme » in a spot check is "consistent", so the spot check never says "matches" (a match is a game) or "confirms" (restricted, IHM-50).
- « trace » is "trace" in every compound (import trace, dedup trace, deletion trace): "record" is taken by sports records and the win-loss record.

### 3.6 Games and statistics

| French | English | Code | UI label | Meaning | IDs |
| --- | --- | --- | --- | --- | --- |
| statistiques de match, statistiques | game statistics | — | Statistics | Schedules, results and box scores fetched from the stats source. | STA-01–STA-48 |
| source de statistiques | stats source | `StatsSource` | Stats source | External service providing NBA schedules and box scores, swappable. | STA-01, STA-02, TRV-12 |
| match | game | `Game`; key `gameId` | Game | Dated official NBA game. | STA-04, STA-05 |
| match officiel | official game | — | — | Regular season, play-in or playoffs; nothing else counts. | STA-04, VUE-01 |
| présaison, match d'exhibition, match des étoiles, sélection nationale | preseason, exhibition game, All-Star Game, national team | — | — | Never retained, never a measured game nor an absence. | STA-04 |
| saison | season | `season` (`"2024-25"`) | Season | From the first regular-season game to the last playoff game; an offseason date belongs to the next season. | STA-48 |
| phase (d'un match) | game phase | `GamePhase` | Phase | regular season, play-in or playoffs (section 4.2). | STA-05 |
| saison régulière | regular season | `regular_season` | Regular season | Game phase and baseline phase. | STA-04, STA-18 |
| tournoi de qualification | play-in tournament | `play_in` | Play-in | Game phase. | STA-04, STA-05 |
| phases finales | playoffs | `playoffs` | Playoffs | Game phase; in a baseline, play-in and playoffs together are "postseason". | STA-04, STA-18 |
| finale | the Finals | — | Finals | Last playoff series; ends the phase for everyone. | STA-20 |
| série | series | `seriesId` | Series | Play-in or playoff pairing. | STA-05 |
| numéro du match dans la série | game number | `gameNumber` | Game {n} | Rank of the game in its series. | STA-05 |
| victoires de chaque équipe avant ce match | series wins before the game | `seriesWinsBefore` | — | Per team, play-in and playoffs only. | STA-05 |
| une défaite élimine une équipe | elimination game | `isEliminationGame` | Elimination game | Computed; feeds the unusual-stakes criterion. | STA-07, SEN-14 |
| statut (du match) | game status | `GameStatus` | Status | scheduled, in progress, final, postponed or canceled. | STA-05 |
| instant prévu de début | scheduled start | `scheduledStartAt` | Tip-off | Absolute instant; the latest known time prevails. | STA-05, STA-29, STA-31 |
| coup d'envoi | tip-off | — | Tip-off | Start of a game; compared as instants, never as local times. | H-02, STA-30, SEN-03 |
| « heure à déterminer » | time TBD | `isStartTimeTbd` | Time TBD | Game with a date only, deemed to start at the beginning of its local day. | STA-31 |
| journée de compétition, date américaine | US date | `usDate` | — | A game's day is its date in the US; shown when it differs from the local date. | STA-32, TRV-72, IHM-14 |
| équipe qui reçoit, équipe qui se déplace | home team, away team | `homeTeamId`, `awayTeamId` | Home; Away | — | STA-05 |
| à domicile, à l'extérieur | home, away | `GameVenue` | Home; Away | Venue of the player's team. | STA-26 |
| score final | final score | `finalScore` | — | Stored, never used as a measure (VUE-03). | STA-05 |
| prolongation | overtime | `overtimeCount` | OT | Bounds minutes at 48 + 5 per overtime. | STA-09 |
| expulsion | ejection | `ejection` (review flag) | Ejection | Flagged for review when the source gives it. | SEN-16 |
| feuille de match | box score | `BoxScore` | Box score | One player's statistics for one game. | STA-08 |
| état (de la feuille) | box-score status | `BoxScoreStatus` | Status | complete, incomplete, suspect or unavailable. | STA-09, STA-10, STA-35 |
| feuille douteuse | suspect box score | `suspect` | Suspect | Fails a consistency check; excluded until a later fetch fixes it. | STA-09 |
| « minutes arrondies » | rounded minutes | `hasRoundedMinutes` | Rounded minutes | Source gives whole minutes only. | STA-12 |
| points | points | `points` | PTS | Box-score element. | STA-08 |
| tirs réussis, tirs tentés | field goals made, field goals attempted | `fieldGoalsMade`, `fieldGoalsAttempted` | FGM; FGA | All field goals, 2 and 3 points, free throws excluded. | STA-08 |
| tirs à trois points réussis | three-pointers made | `threePointersMade` | 3PM | Only for the points consistency check. | STA-08, STA-09 |
| lancers francs réussis, tentés | free throws made, attempted | `freeThrowsMade`, `freeThrowsAttempted` | FTM; FTA | Box-score elements. | STA-08 |
| rebonds offensifs, défensifs | offensive rebounds, defensive rebounds | `offensiveRebounds`, `defensiveRebounds` | OREB; DREB | Box-score elements. | STA-08 |
| passes décisives | assists | `assists` | AST | Box-score element. | STA-08 |
| interceptions | steals | `steals` | STL | Box-score element. | STA-08 |
| contres | blocks | `blocks` | BLK | Box-score element. | STA-08 |
| balles perdues | turnovers | `turnovers` | TOV | Box-score element. | STA-08 |
| fautes personnelles | personal fouls | `personalFouls` | PF | Box-score element. | STA-08 |
| minutes et secondes, minutes jouées | minutes played | `minutes`, `seconds` | MIN | Time on court. | STA-08, H-13 |
| Game Score | Game Score | `gameScore` | Game Score | Hollinger's formula, unchanged. | STA-11, H-13 |
| minutes décimales | decimal minutes | `decimalMinutes` | — | Minutes plus seconds ÷ 60 (34:30 is 34.5). | STA-12 |
| indice de performance, indice | performance index | `performanceIndex` | Index | Game Score ÷ decimal minutes; may be negative; three decimals on screen. | STA-12, H-13 |
| match joué, non joué | played, not played | `GamePlayClassification` | Played; Did not play | Played when time on court is strictly positive; the cause of absence is never stored. | STA-13 |
| match exploitable | usable game | `usable` | Usable | Played, complete and consistent box score, playing-time threshold reached. | STA-14 |
| joué non exploitable | played, not usable | `played_not_usable` | Not usable | Played but box score incomplete or suspect, or under the threshold. | STA-14 |
| seuil de temps de jeu | playing-time threshold | `playingTimeThreshold` | Playing-time threshold | max(15 min, 50 % of regular-season average minutes); same for baselines and measured games. | STA-14, STA-15 |
| plancher (de temps de jeu) | playing-time floor | `playingTimeFloorMinutes` | — | The 15-minute floor. | STA-14 |
| référence de saison | season baseline | `SeasonBaseline` | Season baseline | Mean and standard deviation of the index over the usable games of a season and baseline phase, measured game excluded. | STA-16 |
| phase de la référence | baseline phase | `BaselinePhase` | Baseline | regular season or postseason (section 4.2). | STA-16, STA-18 |
| moyenne (de saison) | season mean | `mean` | Mean | Mean index of the baseline. | STA-16 |
| écart-type (de saison) | season standard deviation | `standardDeviation` | SD | Sample standard deviation (n − 1). | STA-16, H-STA-04 |
| variabilité habituelle | usual variability | — | — | The season standard deviation, in plain words. | D-16 |
| état (de la référence) | baseline status | `SeasonBaselineStatus` | Status | final, provisional, building or insufficient. | STA-19–STA-22 |
| mention « partielle » | partial baseline | `isPartial` | Partial | Over 20 % of played games lack an index; still usable. | STA-24 |
| match mesuré exclu | measured game excluded | `excludedGameId` | — | A baseline never contains its own measured game. | STA-16, STA-17 |
| taille minimale d'une référence | minimum baseline size | `minBaselineGames` | — | 10 usable games. | STA-19 |
| phase terminée | phase over | — | — | Regular season over, or the player's team eliminated or the Finals played. | STA-20 |
| comparaison indicative | indicative comparison | `IndicativeComparison` | Indicative | While a baseline is building, comparison with the previous regular season; never counted. | STA-23 |
| bilan (d'une équipe) | win-loss record | `TeamWinLossRecord` | Record | Regular-season wins and losses, optionally excluding one game; feeds opponent strength. | STA-06 |
| prochain match | next game | `NextGame` | Next game | Next scheduled official game of the current team; the player may miss it. | STA-26, STA-27 |
| « aucun match prévu » | no game scheduled | `NoNextGameReason` | No game scheduled | With its reason (section 4). | STA-26 |
| dernier match joué | last game played | `lastGamePlayedOn` | Last game played | — | STA-26, STA-46 |
| premier match NBA, « date inconnue » | first NBA game, date unknown | `firstNbaGameOn` | First NBA game; Date unknown | Bounds the career for requests and imports. | STA-47 |
| intersaison | offseason | `offseason` | Offseason | Period between seasons. | STA-26, STA-48 |
| mise à jour quotidienne, mise à jour des statistiques | daily stats update | task `stats_update` | Statistics update | Once a day, at least 3 h after the last tip-off of the past game day. | STA-32, TRV-25 |
| fenêtre de correction | correction window | `correctionWindowDays` | — | 7 days during which box scores are re-requested. | STA-33 |
| consolidé | consolidated | `consolidated` | Consolidated | Game past its correction window; never re-requested. | STA-33, STA-42 |
| journal des corrections | stats correction journal | `StatCorrection` | Corrections | Every changed element with old and new values; unlike event corrections, old values are kept. | STA-33, STA-34 |
| relance manuelle, forcer la récupération | manual refetch | `refetch()` | Refetch | Owner forces fetching a game, a season or a career; uses quota. | STA-34, STA-44 |
| file de récupération | fetch queue | `FetchQueueItem` | — | Pending source requests with priority (1 to 5), attempts and waiting reason. | STA-36, STA-40 |
| niveau de priorité | priority level | `priority` (1–5) | — | Order in which requests are served under quota. | STA-40 |
| motif d'attente | waiting reason | `FetchWaitReason` | — | outage or quota. | STA-36, STA-39 |
| récupération, demande (à la source) | fetch, source request | — | — | A call to the stats source, counted against its quota. | STA-39 |
| réserve de quota | quota reserve | `quotaReservePercent` | — | Share kept for priority levels 1 and 2 (default 10 %). | STA-39 |
| « 9 saisons sur 14 » | progress "9 of 14 seasons" | — | 9 of 14 seasons | Progress of a long fetch, with an estimated end date. | STA-41 |
| données en mémoire | stored data | — | — | Everything fetched is kept; recalculations never call the source. | STA-42, STA-43 |
| « statistiques en attente » | statistics pending | `statistics_pending` | Statistics pending | Case waiting reason during fetches, outages or missing sheets. | STA-36, STA-41, SEN-07 |
| « saison non couverte par la source » | season not covered by the source | `season_not_covered` | Season not covered by the source | Not-measurable reason when the source lacks the season. | STA-45, SEN-07 |
| incident « source de statistiques indisponible » | stats source unavailable | `stats_source_unavailable` | Stats source unavailable | Opened after 12 h of failures; closes when the source answers. | STA-37 |
| incident « quota atteint » (statistiques) | quota reached | `quota_reached` | Quota reached | Opened when the source quota (minus reserve) is reached; closes at renewal. | STA-39 |

Merged into other rows: « indice » (into performance index); « journée de compétition » (into US date); « forcer la récupération » (into manual refetch).

Decisions:

- Game phase « phases finales » is "playoffs"; the baseline that pools play-in and playoff games is "postseason". This keeps "playoffs" to one meaning.
- « bilan d'une équipe » is "win-loss record" (NBA usage); the other « bilan » are "assessment", "import summary" and "restore summary".
- Box-score abbreviations follow NBA.com (OREB, DREB), not Basketball-Reference (ORB, DRB).

### 3.7 Sensitivity, verdicts and profiles

| French | English | Code | UI label | Meaning | IDs |
| --- | --- | --- | --- | --- | --- |
| sensibilité | sensitivity | — | Sensitivity | Tendency of a player to play above or below his norm after a type of event; positive or negative. | D-08, H-04 |
| écart normalisé | normalized gap | `normalizedGap` | Gap | (measured-game index − baseline mean) ÷ baseline SD; never rounded in calculations. | SEN-08, SEN-09 |
| statut de l'écart, écart provisoire, écart définitif | gap status, provisional gap, final gap | `GapStatus` | Provisional; Final | Provisional while its baseline is. | SEN-09, SUI-15 |
| profil de sensibilité, profil | sensitivity profile, profile | `SensitivityProfile` | Profile | Calculation for one player and one validated type. | SEN-19, SEN-20 |
| tendance générale | general trend | `GeneralTrend` | General trend | Same calculation for one type, all followed players together, each case weighing the same. | SEN-28–SEN-30 |
| couple joueur-type | player-type pair | — | — | Key of a profile. | SEN-19, SEN-41 |
| couple évalué | evaluated pair | `evaluatedPairCount` | Evaluated pairs | Pair with at least the valid-case threshold, archived included. | SEN-41 |
| vue (tous les cas, cas historiques, cas suivis) | profile view | `ProfileView` | All cases; Historical cases only; Tracked cases only | Lot 2: which cases the profile is computed on. | SEN-21 |
| n, nombre de cas valides | valid-case count | `validCaseCount` | Valid cases | n, always shown with any mean or verdict. | SEN-20, SEN-38 |
| écart moyen, écart normalisé moyen | mean gap | `meanGap` | Mean gap | Sum of valid cases' gaps ÷ n. | SEN-20 |
| dispersion des écarts | gap dispersion | `gapDispersion` | Dispersion | Sample standard deviation of the valid gaps. | SEN-20 |
| dispersion retenue | retained dispersion | `retainedDispersion` | — | max(gap dispersion, 1), or 1 below two cases. | SEN-22 |
| bruit attendu | expected noise | `expectedNoise` | Expected noise | Retained dispersion ÷ √n. | SEN-22 |
| rapport signal sur bruit | signal-to-noise ratio | `signalToNoise` | Signal-to-noise | Mean gap ÷ expected noise. | SEN-22, SEN-23 |
| fourchette plausible, fourchette | plausible range | `plausibleRange` | Range | Mean gap ± 2 × expected noise. | SEN-22, SEN-38 |
| nombre de cas au-dessus, en dessous de zéro | cases above zero, below zero | `aboveZeroCount`, `belowZeroCount` | Above zero; Below zero | Shown as counts below 20 cases. | SEN-20, SEN-39 |
| verdict | verdict | `Verdict` | Verdict | inconclusive, possible or probable, with a direction when not inconclusive. | D-16, SEN-23 |
| niveau (du verdict) | verdict level | `VerdictLevel` | — | The three levels. | SEN-23 |
| non concluant | inconclusive | `inconclusive` | Inconclusive | Too few cases, or a signal under the thresholds. | SEN-23 |
| possible | possible | `possible` | Possible | Absolute signal-to-noise ≥ 2 and absolute mean gap ≥ 0.25 (defaults). | SEN-23 |
| probable | probable | `probable` | Probable | Absolute signal-to-noise ≥ 3 and absolute mean gap ≥ 0.40 (defaults). | SEN-23 |
| sens | direction | `VerdictDirection` | Direction | increase or decrease, only for possible and probable. | SEN-24 |
| hausse | increase | `increase` | Increase | Mean gap positive. | SEN-24 |
| baisse | decrease | `decrease` | Decrease | Mean gap negative; shown exactly like an increase. | SEN-24, H-04 |
| seuils du verdict | verdict thresholds | `possibleSnrThreshold`, `possibleMeanGapThreshold`, `probableSnrThreshold`, `probableMeanGapThreshold` | Verdict thresholds | 2 and 0.25, 3 and 0.40 by default. | SEN-23, Q-04 |
| seuil de cas valides (par joueur), seuil de cas | valid-case threshold | `validCaseThreshold` | Case threshold | 5 by default; below it the player's verdict is inconclusive. | SEN-23, H-03 |
| « non concluant pour ce joueur (k cas valides sur 5 nécessaires) » | inconclusive for this player | — | (section 7) | Label of a profile under the threshold. | SEN-31 |
| « tendance générale du type, ne décrit pas ce joueur » | type's general trend, not this player | — | (section 7) | Title above the trend shown for a player under the threshold. | SEN-31 |
| verdict fragile, « fragile » | fragile verdict | `isFragile` | Fragile | Level or direction changes when the most supportive case is removed. | SEN-26 |
| test de robustesse | robustness test | `runRobustnessTest()` | — | The recalculation that decides fragility. | SEN-26 |
| confiance du profil, niveau de confiance | profile confidence | `ProfileConfidence` | Profile confidence | low, medium or high: what the verdict rests on. | SEN-25, D-11 |
| raisons des baisses (de confiance) | confidence step-down reasons | `ConfidenceStepDownReason` | Why lower | Reasons shown for each lowered level (section 4). | SEN-25, SEN-29 |
| part de cas douteux | doubtful-case share | `doubtfulShare` | Doubtful cases | Excluded ÷ (valid + excluded). | SEN-25 |
| contrôles | checks | — | Checks | Control mean gap and manual-exclusion warning; never replace the verdict. | SEN-27 |
| écart moyen de contrôle | control mean gap | `controlMeanGap` | Including excluded cases | Mean over valid and excluded cases with a computable gap, with the verdict it would give. | SEN-27 |
| « verdict dépendant des exclusions manuelles » | verdict depends on manual exclusions | `dependsOnManualExclusions` | Verdict depends on manual exclusions | Undoing every manual decision would change level or direction. | SEN-27 |
| nombre de joueurs distincts | distinct players | `distinctPlayerCount` | Players | At least 3 for a trend verdict. | SEN-28, SEN-29 |
| part du premier contributeur | top-contributor share | `topContributorShare` | Largest share from one player | Over 50 % lowers a trend's confidence. | SEN-28, SEN-29 |
| nombre de cas de confiance de la recherche « faible » | low-confidence cases | `lowResearchConfidenceCount` | Cases on low-confidence events | Counted like the others and shown. | SEN-43 |
| avertissements de couverture et de version | coverage and version warnings | `coverageWarnings` | — | Never change the verdict (section 7 for the labels). | SEN-46 |
| « type non couvert par le backtest » | type not covered by the backtest | `type_not_covered` | Type not covered by the backtest | The player's coverage lacks the type; the profile rests on tracked cases only. | SEN-46, TAX-20, ALE-14 |
| « profil incomplet » | incomplete profile | `incomplete_profile` | Incomplete profile | Coverage has gaps, or a broadening awaits its supplement. | SEN-46, TAX-24 |
| cas fondés sur une version antérieure | cases on an earlier sheet version | `earlierVersionCaseCount` | Cases on an earlier version | After a narrowing, until requalified. | SEN-46, TAX-25 |
| archivé (profil, tendance) | archived | `isArchived` | Archived | Withdrawn player or type; viewable, recalculated, feeds no alert, counted in SEN-41. | SEN-19 |
| historique des verdicts | verdict history | `VerdictHistoryEntry` | Verdict history | Every change of level, direction or profile confidence, with its cause. | SEN-37 |
| cause (d'un changement de verdict) | change cause | `VerdictChangeCause` | Cause | Closed list (section 4). | SEN-37, SEN-48 |
| recalcul, recalcul complet | recalculation, full recalculation | `recalculate()` | Recalculate | Deterministic; preserves manual decisions; never calls the stats source. | SEN-34–SEN-36 |
| « recalcul en cours » | recalculation in progress | `isRecalculating` | Recalculation in progress | Shown on affected profiles and sheets. | SEN-36, ALE edge cases |
| faux signaux attendus, synthèse | expected false signals | `ExpectedFalseSignals` | Verdicts chance alone would give | Evaluated pairs × 4.6 % (at least possible) and × 0.27 % (probable). | SEN-41 |
| pièges d'interprétation | interpretation pitfalls | — | Interpretation pitfalls | Section of 08 shown from "Method and limits". | 08, IHM-69 |
| affichage honnête (des petits échantillons) | honest display | — | — | Counts, ranges and case lists always shown; no showcase of the best profiles. | SEN-38–SEN-40, IHM-45–IHM-52 |
| association observée, cause démontrée | observed association, proven cause | — | — | A verdict describes the first, never the second. | SEN-42 |

Merged into other rows: « profil » (into sensitivity profile); « écart normalisé moyen » (into mean gap); « niveau de confiance » (into profile confidence); « fourchette » (into plausible range); « seuil de cas » (into valid-case threshold).

Decisions:

- The direction words are nouns, as in the pre-decided "increase / decrease": « à la hausse » becomes "increase" ("possible, increase"), never "upward" or "positive".
- « bruit attendu » keeps "expected" because it is a statistical term; "expected" never qualifies a performance (section 8).

<!-- next -->
