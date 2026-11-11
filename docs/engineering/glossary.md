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

<!-- next -->
