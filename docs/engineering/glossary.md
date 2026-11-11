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
- A foreign key is the camelCase entity name plus `Id`: `eventTypeId`, `alertSheetId`, `playerEventId`. Every stored player is a followed player, so the key to a `FollowedPlayer` is `playerId`.
- Reserved words are never identifiers on their own: a variable holding one case is `caseItem` (or `trackedCase`, `historicalCase`), one import `importItem`, one export `exportItem`.
- No domain type takes the name of a browser built-in, because a forgotten import would then type-check against the wrong thing (orchestrator ruling). An event is the code type `PlayerEvent`, held in variables `playerEvent` / `playerEvents`, keyed by `playerEventId`; the English term stays "event", the UI label "Event", the table `events` and the route segment `events`. Names derived from the bare word follow it (`PlayerEventSource`, since `EventSource` is a browser built-in too); compound names that are already unambiguous stay as they are (`EventType`, `EventOrigin`, `EventMark`, `DetectedEventStatus`, `withdrawEvent()`). Telegram messages are `NotificationMessage`, never `Notification`, another built-in.
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
| liste de suivi, liste des joueurs suivis, liste restreinte | follow list | `listFollowedPlayers()` | Followed players | The 20 to 30 followed players. | D-17, JOU-04 |
| identifiant (du joueur) | player ID | `FollowedPlayer.id` | — | Opaque, assigned at addition, never changes, never reused, even after deletion. | JOU-08 |
| nom d'usage | display name | `displayName` | Name | Name as the press most often writes it; on change the old one stays as a variant. | JOU-08, JOU-12 |
| variantes de nom, variante de nom | name variants | `nameVariants` | Name variants | Display name, spelling variants and nicknames searched by detection. | JOU-08, JOU-09 |
| variantes d'écriture | spelling variants | `NameVariantKind` `spelling` | Spelling variants | Forms with or without accents, transliterations, suffix, first name alone. | JOU-08 |
| surnoms | nicknames | `NameVariantKind` `nickname` | Nicknames | Nicknames used by the press. | JOU-08 |
| variante ambiguë, marque « ambiguë » | ambiguous variant | `isAmbiguous` | Ambiguous | Variant also naming other people or a common word; detection needs a corroborating clue. | JOU-09, DET-04 |
| variante partagée | shared variant | — | Shared with {player} | Variant identical to another followed player's; accepted and flagged at entry. | JOU-09, DET-04 |
| homonyme, homonymes | namesake | — | — | Other person with the same name; the player marker in the prompt prevents confusion. | BKT-29, STA-03 |
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
| correspondance statistique, correspondance avec la source de statistiques | stats-source mapping | `StatsSourceMapping` | Stats-source mapping | User-confirmed mapping of a followed player to his record in the stats source; one per player. | JOU-10, STA-03 |
| « correspondance à établir » | mapping to establish | `StatsSourceMappingStatus` `to_establish` | Mapping to establish | Notice shown while no candidate is confirmed; no statistics are fetched meanwhile. | JOU-10, IHM-66 |
| candidat (de correspondance) | mapping candidate | `MappingCandidate` | Candidates | Stats-source identity offered for confirmation. | JOU-10, STA-03 |
| état (du joueur) | player status | `PlayerStatus` | Status | active, paused or withdrawn; changed only by the owner. | JOU-15, JOU-22 |
| actif | active | `active` | Active | Counts toward the maximum; detected, alerted, tracked. | JOU-16 |
| en pause, mise en pause | paused, pause | `paused`; `pausePlayer()` | Paused; Pause | Temporarily out of detection and alerts; data and open cases kept. | JOU-17, JOU-18 |
| retiré, retrait (d'un joueur) | withdrawn, player withdrawal | `withdrawn`; `withdrawPlayer()` | Withdrawn; Withdraw | Status change that erases nothing; profiles shown as archived. Not an event withdrawal (4.2). | JOU-19 |
| réactivation, réactiver, reprise | reactivation, reactivate | `reactivatePlayer()` | Reactivate | Back to active, subject to the maximum; creates no request. | JOU-20, JOU-18 |
| historique des états | status history | `PlayerStatusChange` | Status history | Dated changes with optional reason. | JOU-15 |
| motif (du changement d'état) | status-change reason | `PlayerStatusChangeReason` | Reason | Optional reason of a status change (section 4). | JOU-15, H-JOU-06 |
| absence prolongée | prolonged absence | `prolonged_absence`; `prolongedAbsenceThreshold` | Prolonged absence | At least N consecutive team games missed (default 10); reason value and parameter. | JOU-22 |
| suggestion de pause | pause suggestion | `PauseSuggestion` | Suggest pausing | To-do item offered after a prolonged absence; refused once, it waits for a new absence. | JOU-22, IHM-20 |
| fin de carrière | end of career | `end_of_career` | End of career | Reason value. | JOU-15 |
| départ de la NBA | left the NBA | `left_nba` | Left the NBA | Reason value. | JOU-15 |
| exposition insuffisante | insufficient exposure | `insufficient_exposure` | Insufficient exposure | Reason value. | JOU-15 |
| critères de choix, joueurs très médiatisés | selection criteria, highly publicized players | — | — | What makes a player worth following: talent, regular playing time, media exposure. | JOU-01, D-17 |
| indicateurs d'aide au choix | selection indicators | — | — | Games played, minutes and exposure shown to help choose. | JOU-02, JOU-03 |
| indicateur d'exposition | exposure indicator | `exposureCount` | Exposure | Collected articles citing the player over the last N days (default 30); survives purge. | JOU-03, DET-57 |
| nombre de matchs joués (saison en cours) | games played this season | `gamesPlayedThisSeason` | Games played | Shown once the mapping is confirmed. | JOU-02, STA-46 |
| temps de jeu moyen | average minutes | `averageMinutesThisSeason` | Minutes per game | Average playing time per game played, current season. | JOU-02, STA-46 |
| date du dernier match joué | last game played | `lastGamePlayedOn` | Last game played | Date of the player's last game played. | JOU-21, STA-46 |
| matchs consécutifs manqués, matchs consécutifs de son équipe manqués | consecutive team games missed | `consecutiveTeamGamesMissed` | Consecutive games missed | Team games missed since the last game played; the cause is never stored. | JOU-21, STA-46 |
| blessure longue, suspension, choix de l'entraîneur, raison personnelle | causes of absence | — | — | Never recorded (JOU-21, DSN-15). | JOU-21, STA-13 |
| recrue | rookie | — | Rookie | Player with no NBA game yet: can be added, mapping may stay to establish. | 01 edge cases |
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
| net, types nets et datables | clean, clean and datable types | — | Clean | Recognized from a public fact by yes-or-no criteria, names one player, overlaps no type. | TAX-04 |
| datable | datable | — | Datable | Gives each event one reference date, at least to the day. | TAX-05 |
| liste de contrôle « net et datable » | clean-and-datable checklist | `ValidationChecklist` | Clean and datable checklist | Eight points confirmed one by one before validation. | TAX-12 |
| fait public et observable | public, observable fact | — | — | What a type is recognized by, never a state of mind. | TAX-04 |
| état d'esprit | state of mind | — | — | Never measured or supposed. | TAX-04 |
| belles histoires | feel-good stories | — | — | What a type defined by its outcome would retain. | TAX-07, SUI-06 |
| état (du type) | event-type status | `EventTypeStatus` | Status | proposed, validated, rejected or withdrawn. | TAX-10 |
| proposition de type, proposition | type proposal | `EventType` with status `proposed` | Proposal | Type in proposed status, used in no calculation. | TAX-15–TAX-18 |
| type candidat, types d'événements candidats | candidate type | — | — | One of the nine types of the journal, seeded as proposals. | TAX-15, D-12 |
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
| réactivation (d'un type), réactiver | type reactivation, reactivate | `reactivateEventType()` | Reactivate | Withdrawn back to validated, through the checklist again. | TAX-32 |
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
| historique des modifications, historisé | sheet change history, recorded in the change history | `TypeSheetChange` | Change history | Every change of a validated sheet: date, before, after, qualification, reason. | TAX-21 |
| qualification de la modification | change qualification | `SheetChangeQualification` | Kind of change | formal or substantive. | TAX-22 |
| modification de forme | formal change | `formal` | Formal | Does not change which facts belong; no new version. | TAX-22 |
| modification de fond | substantive change | `substantive` | Substantive | Changes which facts belong; new version; broadens, narrows or both. | TAX-22 |
| élargit, restreint, les deux | broadens, narrows, both | `SubstantiveChangeScope` | Broadens; Narrows; Both | Scope of a substantive change. | TAX-22, TAX-24, TAX-25 |
| requalification, requalifier, « à requalifier » | requalification, requalify, to requalify | `to_requalify` | To requalify | After a narrowing, each older event is judged against the new version. | TAX-25 |
| conforme à la nouvelle version | conforms to the new version | `conforms` | Conforms | Requalification choice. | TAX-25 |
| réaffecté à un autre type validé, réaffectation | reassigned to another validated type, reassignment | `reassigned` | Reassign to another type | Requalification choice. | TAX-25 |
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
| balayage, série éliminatoire | sweep, playoff series | — | — | Series lost 4-0. | Annex, D-34 |
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
| événement | event | `PlayerEvent`; key `playerEventId`; variables `playerEvent`, `playerEvents` | Event | Public, dated fact about one followed player, likely to touch his ego, of one event type. | VUE-04, DSN-06 |
| fait | fact | — | — | What an article or a source reports; one fact gives one event. | TAX-06, BKT prompt 2.9 |
| fait public et daté | public, dated fact | — | — | The only kind of fact an event may rest on. | DSN-01 |
| événement détecté | detected event | `PlayerEvent` with origin `detected` | Detected event | Event found by daily detection from collected articles (Lot 2). | DET-24, DET-37 |
| événement historique | historical event | `PlayerEvent` with origin `historical` | Historical event | Past event reported by a backtest and saved at import. | IMP-30 |
| origine (de l'événement) | event origin | `EventOrigin` | Origin | detected or historical; fixed by the first recording. | DSN-06, IMP-27 |
| date de référence | reference date | `referenceDate` (+ `referenceDatePrecision`) | Reference date | Moment the fact became public, with its precision. | TAX-05, DET-30, DSN-06 |
| précision (de la date de référence, de l'instant retenu) | precision | `DatePrecision` | Precision | exact, approximate or none (section 4). | COL-20, DET-30, DSN-06 |
| date publique | public date | `publicDate`; JSON `public_date` | Public date | A historical event's reference date as the research reports it (date, or date and time). | BKT format, IMP-12 |
| instant de référence | reference instant | `referenceInstant` | — | Instant the event is deemed public, used to find the measured game; date-only means end of day, Pacific time. | SEN-01, SEN-02 |
| provenance de l'instant de référence | reference-instant origin | `ReferenceInstantOrigin` | — | known instant, date only, known in advance, or uncertain-precedence shift (section 4). | SEN-01, SEN-02, SEN-44 |
| devenu public | became public | — | — | The moment that dates an event; never the moment the fact happened, if earlier. | TAX-05 |
| source (d'un événement) | event source | `PlayerEventSource` | Sources | Press article cited for an event: link, outlet, title, publication date; nothing else. | DSN-06, DSN-08 |
| lien | link | `url`; JSON `url` | Link | Address of the article, kept exactly as published. | DSN-08, H-DSN-04 |
| média | outlet | `outlet`; JSON `outlet` | Outlet | Name of the media outlet. | DSN-08 |
| titre | title | `title`; JSON `title` | Title | Article title as published, in its own language. | DSN-08, H-BKT-05 |
| date de publication | publication date | `publicationDate`; JSON `publication_date` | Published | Date, or date and time, of the article. | DSN-08 |
| article de référence | reference article | `referenceArticleId` | Reference article | Article that gives a detected event its reference date. | DET-30, DSN-06 |
| description courte et neutre, description | description | `description` | Description | One factual, neutral sentence under the wording rules of 13 (max 200 characters). | DSN-19–DSN-23 |
| indications de contexte, champs de contexte | context indications | `ContextIndications`; JSON `context` | Context | Return from injury and game stakes, closed values, never a narrative. | H-09, D-19, DSN-07 |
| partage des rôles (contexte) | division of roles | — | — | Playing time and opponent strength are computed; return from injury and game stakes are flagged by research or classification, then corrected by the owner. | H-09 |
| retour de blessure | return from injury | `injuryReturn`; JSON `injury_return` | Return from injury | yes, no or unknown: the press presents the game as a return from an injury absence. | SEN-13, DSN-07 |
| enjeu du match | game stakes | `gameStakes`; JSON `game_stakes` | Game stakes | high, normal or unknown: the outcome decides a qualification, elimination, title or final ranking. | SEN-14 |
| provenance, origine (d'une indication de contexte) | indication origin | `ContextIndicationOrigin` | Origin | research, classification, user or calculation. | SEN-18, H-09, ALE-08 |
| confiance de détection | detection confidence | `detectionConfidence` | Detection confidence | Score 0–100 the classifier gives a fact; a self-assessment, not a probability. | DET-16, DET-25 |
| confiance de la recherche | research confidence | `researchConfidence`; JSON `confidence` | Research confidence | high, medium or low, set by the research AI per prompt rule 2.8. | BKT prompt 2.8, IMP-15 |
| version de fiche (de l'événement) | sheet version | `sheetVersion` | Sheet version | Version of the type sheet the event was qualified under. | TAX-23, DET-53, IMP-30 |
| qualifier, qualifié (sous une version) | qualify, qualified | — | — | Recognize a fact as an event of a type under one sheet version. | TAX-23 |
| marque | mark | `EventMark` | — | Flag set on an event, later lifted or upheld (section 4). | DET-32, DET-33, DET-58 |
| « datation à vérifier » | dating to verify | `dating_to_verify` | Dating to verify | The article places the fact before its own publication and a game may have been played in between. | DET-32, SEN-45 |
| « détecté après le coup d'envoi » | detected after tip-off | `detected_after_tip_off` | Detected after tip-off | The expected game's tip-off had passed when the event was created. | DET-33 |
| antériorité | precedence | `Precedence` | Precedence | Of a historical event: its oldest source compared with the measured game's tip-off. | IMP-18, SEN-44 |
| écarter, écartement, écarté, événements écartables | dismiss, dismissal, dismissed, dismissable events | `dismissEvent()`; status `dismissed` | Dismiss; Dismissed | Owner corrects a wrong detection; the event is kept, leaves all calculations, reversible. | DET-43–DET-46, H-08 |
| réintégrer, réintégré, réintégration (d'un événement) | reinstate, reinstated, event reinstatement | `reinstateEvent()` | Reinstate | Undo a dismissal; the event re-enters calculations. | DET-45 |
| retirer, retrait (d'un événement) | withdraw, event withdrawal | `withdrawEvent()` | Withdraw | Permanent erasure of an event and its traces for a sensitivity reason; only the counter remains. | DSN-26–DSN-29 |
| compteur des événements retirés, compteur global des événements retirés | withdrawn-events counter | `withdrawnEventCount` | Withdrawn events | Global, anonymous count since go-live; also counts events declined for sensitive data. | DSN-29, VUE-09 |
| supprimer, suppression (d'un événement historique) | delete, deletion | `deleteHistoricalEvent()` | Delete | Removal of a historical event for an error, with a reason; traced. | IMP-33 |
| corriger, correction (d'un événement) | correct, correction | `correctEvent()` | Correct | Change of type, date, description, sources, context, confidence or note. | IMP-32, DET-47, DET-48 |
| historique des corrections | correction history | `correctionHistory` | Correction history | What changed and when; never the old value of a description. | DET-52, IMP-32, D-20 |
| cas | case | `Case`; key `caseId` | Case | One event (or several of the same type) and its measured game; the unit of calculation. | SEN-05, SEN-07 |
| match mesuré | measured game | `measuredGameId` | Measured game | First game the player plays after the event became public. | H-02, SEN-03 |
| rattacher, rattachement (au match mesuré) | attach, attachment | `attachToMeasuredGame()` | — | Linking an event to its measured game. | SEN-01–SEN-05 |
| délai de rattachement, délai maximal de rattachement | attachment window | `attachmentWindowDays` | Attachment window | Days after the reference instant within which a game must be played (default 10). | SEN-04 |
| absence | absence | — | — | Team game the player did not play; skipped and counted for the injury-return criterion. | SEN-03, SEN-13 |
| origine (du cas) | case origin | `CaseOrigin` | Origin | historical or tracked; written in full on screen. | SEN-21, IHM-46 |
| cas historique | historical case | `historical` | Historical | Case born from a historical event. | SEN-21 |
| cas suivi | tracked case | `tracked` | Tracked | Case born from a detected event, observed in real conditions. | SUI-01 |
| état (du cas) | case status | `CaseStatus` | Status | awaiting game, measured, excluded or not measurable, always with a reason. | SEN-07 |
| motif (de l'état) | status reason | `CaseStatusReason` | Reason | Why a case is in its status (section 4). | SEN-07, SEN-47 |
| cas valide | valid case | `isValid` (status `measured`) | Valid case | Measured case with its gap computed and no doubtful-case criterion triggered; only these enter a verdict. | SEN-07 |
| cas douteux | doubtful case | status `excluded` | Doubtful case | Case excluded because of a confounding factor. | SEN-11 |
| exclu, exclure, exclusion | excluded, exclude, exclusion | status `excluded`; `excludeCase()` | Excluded; Exclude | A doubtful case, automatically or by hand; reversible. | SEN-11, SEN-17 |
| facteur parasite, facteurs parasites | confounding factor | — | Confounding factor | Circumstance that may imitate an ego effect (playing time, injury return, stakes, opponent). | D-19, SEN-11 |
| critère (de cas douteux) | doubtful-case criterion | `DoubtfulCaseCriterion` | Criterion | Condition that makes a case doubtful (section 4). | SEN-11–SEN-15 |
| critère retenu | triggered criterion | `triggeredCriteria` | Criteria met | Criterion that applies to the case, listed with its triggering values. | SEN-11 |
| signalée, calculée (condition) | flagged, calculated | `CriterionCondition` | Flagged; Calculated | Whether a criterion fired from a context indication or from statistics. | SEN-13, SEN-14 |
| non évaluable | not evaluable | `opponentStrengthNotEvaluable` | Not evaluable | Opponent criterion that cannot be computed; not triggered, noted on the case. | SEN-15 |
| signalé pour revue, cas signalé pour revue, signalement, signalement pour revue | flagged for review, review flag | `ReviewFlag` | Flagged for review | Situation shown to the owner without automatic exclusion. | SEN-16 |
| décision manuelle | manual decision | `ManualDecision` | Manual decision | Owner excludes a measured case or reinstates an excluded one, with a closed-list reason. | SEN-17 |
| commentaire (d'une décision), commentaire d'une décision | comment | `comment` | Comment | Free text under the wording rules; required for "other" reasons. | SEN-17, DET-43, DSN-10 |
| exclusion manuelle | manual exclusion | `exclude` | Exclude | Manual decision of kind exclude. | SEN-17 |
| réintégrer, réintégration (d'un cas) | reinstate, case reinstatement | `reinstate` | Reinstate | Manual decision of kind reinstate. | SEN-17 |
| cas concomitant, « concomitant » | co-occurring case | `isCoOccurring`; `coOccurringTypeIds` | Co-occurring | Case whose measured game is also another type's; one case per type, each marked. | SEN-06 |
| événements regroupés (dans un cas existant), événement regroupé, cas regroupé | grouped events, grouped event | `groupedEventCount` | Grouped events | Same-type events on the same game, joined into one case. | SEN-05, SEN-32 |
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
| nature (de la demande), nature de la demande | request kind | `BacktestRequestKind` | Kind | initial, supplement or full redo. | BKT-01, BKT-08, BKT-09 |
| demande initiale, initiale | initial request | `initial` | Initial request | First request of an unprofiled player: all validated types over his whole career. | BKT-08, H-05 |
| complément, demande complémentaire, complément proposé | supplementary request, proposed supplement | `supplement` | Supplementary request | Covers only what the player's coverage lacks: a type validated since, elapsed time, an import's gap. | BKT-04–BKT-06, BKT-09 |
| reprise complète | full redo | `full_redo` | Full redo | Redoes every validated type over the whole career; the import may replace existing events. | BKT-09, IMP-29 |
| « compléter » (action) | fill gaps | — | Fill gaps | Default choice for a profiled player: creates a supplementary request. | BKT-01, IHM-22 |
| « refaire » (action) | redo | — | Redo | Choice for a profiled player: creates a full redo. | BKT-01, IHM-22 |
| « Demander un backtest » | request a backtest | `createBacktestRequest()` | Request a backtest | Manual creation from the player page. | BKT-01, IHM-22 |
| déclencheur (type validé, réactivé, élargi…) | request trigger | `BacktestRequestTrigger` | Trigger | What created the request (section 4). | BKT-01, BKT-03–BKT-06 |
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
| joueur profilé, déjà traité, joueur déjà profilé, joueurs déjà traités | profiled player | `isProfiled` | Profiled | At least one research result imported, even empty. | H-VUE-02, BKT-10, D-29 |
| joueur non profilé, sans backtest, pas encore de backtest | unprofiled player | `!isProfiled` | No backtest yet | No research result ever imported. | BKT-10, TEL-09, D-24 |
| aiguillage | routing | `routeDetectedEvent()` | — | Lot 2: what a detected event triggers depending on profile and coverage. | DET-37–DET-40, BKT-30 |
| besoin de backtest | backtest need | `BacktestNeed` | — | Signal from detection; this domain decides whether to create a request. | DET-38, DET-40 |
| recherche approfondie | deep research | — | Deep research | Mode of an AI that explores the web at length and returns a sourced answer, used outside the app. | 00 glossary, VUE-07 |
| IA de recherche, IA de recherche approfondie | deep-research AI | — | Research AI | Any tool the owner chooses; the app never calls it. | BKT-19, VUE-07 |
| prompt de recherche | research prompt | `ResearchPrompt` | Prompt | Text produced for the request and pasted by the owner into the research AI. | BKT-20–BKT-22 |
| texte de référence (du prompt) | reference text | — | — | The prompt wording the product renders; English version owned by the prompt module. | BKT-21 |
| « Copier », « Partager » | copy, share | — | Copy; Share | Put the whole prompt on the clipboard, or open the phone's share sheet. | BKT-20 |
| date de la dernière copie | last copied at | `lastCopiedAt` | — | A prompt changed after a copy triggers a stale-copy warning. | BKT-20 |
| texte copié qui n'est plus à jour | stale copy | `isCopyStale` | The copied text is no longer up to date | The prompt changed after its last copy. | BKT-20 |
| demande signalée (prompt sur une version antérieure) | outdated sheet version | `hasOutdatedSheetVersion` | Prompt uses an earlier sheet version | A requested type's sheet changed version since the prompt was produced. | TAX-23, BKT-15 |
| parties variables, partie variable | placeholders, placeholder | `{{...}}` | — | Variable parts, all replaced before display (section 6). | BKT-22 |
| « non renseigné » | not provided | — | not provided | Replaces an empty sheet item in the prompt. | BKT-22 |
| repère du joueur | player marker | `{{PLAYER_MARKER}}` | — | First NBA game date, or that it is unknown, to avoid namesakes. | BKT prompt, BKT-29 |
| résultat de recherche, JSON strict | research result, strict JSON | `ResearchResult` | Research result | JSON returned by the AI and pasted into the app; events only, never statistics. | D-27, D-14, BKT-23 |
| résultat vide | empty result | — | — | Valid result with no event; counts as a full backtest. | BKT-23 |
| événement (du résultat de recherche) | research event | `ResearchEvent` | — | One entry of `events` before import; becomes a historical event once saved. | BKT format, IMP-19 |
| source (du résultat de recherche) | research source | `ResearchSource` | — | One entry of an event's `sources`; becomes an event source once saved. | BKT format, IMP-14 |
| format de retour, version du format | return format, format version | `formatVersion`; JSON `format_version` | Format version | `egoscope-backtest`, version `1.0` for the English contract. | BKT-24 |
| piste non vérifiée, pistes non vérifiées | unverified lead | `UnverifiedLead`; JSON `unverified_leads` | Unverified leads | Fact glimpsed but not substantiated; never counted; only its count per type is kept. | BKT format, H-IMP-10 |
| limites, limites déclarées, limites déclarées par l'IA | declared limitations | `declaredLimitations`; JSON `limitations` | Limitations | Seasons, types or sources the research could not explore properly. | BKT format, H-IMP-10 |
| réserve (`non_verifie`), réserve sur ce qui n'a pas pu être vérifié | unverified note | `unverifiedNote`; JSON `unverified_note` | Not verified | What the AI could not verify for one event. | BKT format, DSN-06 |
| précision (`contexte.precision`), précision facultative | context detail | JSON `context.detail` | Detail | One optional sentence to help check the context; shown in the preview, never stored. | BKT format, DSN-07 |
| contexte (du match suivant) | next-game context | `ContextIndications` | Context | Context of the first NBA game after the event; `unknown` until it is played. | BKT prompt 2.7, H-BKT-08 |
| un fait, un événement | one fact, one event | — | — | A fact reported by several articles is one event with up to N sources. | BKT prompt 2.9, H-BKT-06 |
| hors champ | out of scope | — | — | Facts outside the period, about the whole team, or of an undefined type. | BKT prompt 2.10 |
| profondeur historique | historical depth | — | — | The player's whole NBA career; not a parameter. | H-06, BKT-08, TRV-38 |
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
| aperçu (d'import), aperçu d'import | import preview | `ImportPreview` | Preview | Summary then detail of what saving would do. | IMP-22 |
| « Enregistrer » | save | `saveImport()` | Save | Atomic save of the accepted events, coverage and trace. | IMP-30 |
| « Abandonner » | discard | — | Discard | Leaves the import; nothing is saved, the draft is erased. | IMP-03 |
| bilan (de l'import), bilan d'import | import summary | `ImportSummary` | Summary | Tally shown after saving, with the supplement and correction message if needed. | IMP-35 |
| décompte (de l'import), décomptes | import tally | `ImportTally` | — | Events added, of which with warning; duplicates; sources attached; ignored; refused; deleted. | IMP-22, IMP-31 |
| trace (de l'import), trace de l'import | import trace | `ImportTrace` | Import history | What an import did; keeps no withdrawn event and no pasted text. | IMP-31, DSN-32 |
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
| « événements distincts » | distinct events | `keep_as_distinct` | Distinct events | Override that adds an event corresponding to an existing historical event. | IMP-26 |
| doublon d'un événement historique (import) | duplicate of a historical event | — | — | Not added; its new sources attach to the existing event. | IMP-26 |
| doublon d'un événement détecté | duplicate of a detected event | — | — | Never added; a dismissed one is reinstated instead. | IMP-27 |
| sondage des sources | source spot check | `SourceSpotCheck` | Spot-check sources | Optional: open 3 random sources and judge each. | IMP-23, H-IMP-09 |
| « conforme », « non conforme », « inaccessible » | consistent, inconsistent, inaccessible | `SpotCheckVerdict` | Consistent; Inconsistent; Inaccessible | Spot-check verdict on a source. | IMP-23 |
| vérification des liens, « introuvable » | link check, not found | `LinkStatus` `not_found` | Not found | After saving, each link is opened; a dead page is marked, nothing deleted. | IMP-17, H-IMP-08 |
| domaines non admis | disallowed domains | `disallowedDomains` | Disallowed domains | Social networks, forums, collaborative encyclopedias, video platforms (parameter). | IMP-14, H-IMP-13 |
| avance tolérée (d'une source sur la date publique) | tolerated source lead | `toleratedSourceLeadDays` | — | How much earlier than the public date a source may be. | IMP-14, TRV-38 |
| taille maximale du texte collé | maximum pasted size | `maxPastedSize` | — | Parameter (default 2 MB). | IMP-02 |
| pistes et limites | leads and limitations | — | Leads and limitations | Preview block listing unverified leads and declared limitations. | IMP-22, IHM-29 |
| texte non sûr, données non sûres | untrusted text | — | — | Result texts shown as plain text; links open only on tap. | IMP-16 |
| champs inconnus | unknown fields | — | — | Ignored, never stored, signaled once. | IMP-16 |
| message de correction | correction message | `CorrectionMessage` | Copy the correction message | Ready-to-copy message asking the AI to fix and resend the full JSON. | IMP-21, IHM-43 |
| import partiel | partial import | — | Save accepted events | Saving accepted events while some are refused, after a confirmation. | IMP-24 |
| correction manuelle | manual correction | `correctHistoricalEvent()` | Correct | Edit of a historical event under the import checks. | IMP-32 |
| suppression manuelle, motif de suppression | manual deletion, deletion reason | `HistoricalEventDeletionReason` | Delete; Reason | Closed list (section 4); never because of the game that followed. | IMP-33 |
| trace de suppression | deletion trace | `EventDeletionTrace` | — | Date, reason, type and public date of a deleted event. | IMP-33 |
| import d'origine | origin import | `originImportId` | Origin import | Import that brought a historical event. | IMP-31 |
| bandeau « Backtest en cours » | backtest in progress | — | Backtest in progress | Home banner of a request whose prompt was copied (section 3.13). | IHM-40 |

Merged into other rows: « refus » (into refused); « manques constatés » (into coverage gaps).

Decisions:

- « refusé » (import) is "refused" and « rejeté » (type) is "rejected": they never share a word. « refus restants » is "remaining refusals".
- « conforme » in a spot check is "consistent", so the spot check never says "matches" (a match is a game) or "confirms" (restricted, IHM-50).
- « trace » is "trace" in every compound (import trace, dedup trace, deletion trace): "record" is taken by sports records and the win-loss record.

### 3.6 Games and statistics

| French | English | Code | UI label | Meaning | IDs |
| --- | --- | --- | --- | --- | --- |
| statistiques de match, statistiques | game statistics | — | Statistics | Schedules, results and box scores fetched from the stats source. | STA-01–STA-48 |
| source de statistiques, source gratuite | stats source | `StatsSource` | Stats source | External service providing NBA schedules and box scores, swappable. | STA-01, STA-02, TRV-12 |
| match | game | `Game`; key `gameId` | Game | Dated official NBA game. | STA-04, STA-05 |
| match officiel | official game | — | — | Regular season, play-in or playoffs; nothing else counts. | STA-04, VUE-01 |
| présaison, match d'exhibition, match des étoiles, sélection nationale | preseason, exhibition game, All-Star Game, national team | — | — | Never retained, never a measured game nor an absence. | STA-04 |
| saison | season | `season` (`"2024-25"`) | Season | From the first regular-season game to the last playoff game; an offseason date belongs to the next season. | STA-48 |
| phase (d'un match) | game phase | `GamePhase` | Phase | regular season, play-in or playoffs (section 4.2). | STA-05 |
| saison régulière | regular season | `regular_season` | Regular season | Game phase and baseline phase. | STA-04, STA-18 |
| tournoi de qualification | play-in tournament | `play_in` | Play-in | Game phase. | STA-04, STA-05 |
| phases finales | playoffs | `playoffs` | Playoffs | Game phase; in a baseline, play-in and playoffs together are "postseason". | STA-04, STA-18 |
| finale | the Finals | — | Finals | Last playoff series; ends the phase for everyone. | STA-20 |
| match éliminatoire | playoff game | — | Playoff game | Game of the playoffs; an "elimination game" is one where a loss ends a team's season. | 00, SEN-14 |
| série | series | `seriesId` | Series | Play-in or playoff pairing. | STA-05 |
| numéro du match dans la série | game number | `gameNumber` | Game {n} | Rank of the game in its series. | STA-05 |
| victoires de chaque équipe avant ce match | series wins before the game | `seriesWinsBefore` | — | Per team, play-in and playoffs only. | STA-05 |
| une défaite élimine une équipe | elimination game | `isEliminationGame` | Elimination game | Computed; feeds the unusual-stakes criterion. | STA-07, SEN-14 |
| statut (du match) | game status | `GameStatus` | Status | scheduled, in progress, final, postponed or canceled. | STA-05 |
| instant prévu de début, début prévu | scheduled start | `scheduledStartAt` | Tip-off | Absolute instant; the latest known time prevails. | STA-05, STA-29, STA-31 |
| coup d'envoi | tip-off | — | Tip-off | Start of a game; compared as instants, never as local times. | H-02, STA-30, SEN-03 |
| « heure à déterminer » | time TBD | `isStartTimeTbd` | Time TBD | Game with a date only, deemed to start at the beginning of its local day. | STA-31 |
| journée de compétition, date américaine | US date, game day | `gameDayOn` | — | A game's day is its calendar date in the US; shown when it differs from the local date. | STA-32, TRV-72, IHM-14 |
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
| lancers francs réussis, tentés, lancers francs tentés | free throws made, attempted | `freeThrowsMade`, `freeThrowsAttempted` | FTM; FTA | Box-score elements. | STA-08 |
| rebonds offensifs, défensifs | offensive rebounds, defensive rebounds | `offensiveRebounds`, `defensiveRebounds` | OREB; DREB | Box-score elements. | STA-08 |
| passes décisives | assists | `assists` | AST | Box-score element. | STA-08 |
| interceptions | steals | `steals` | STL | Box-score element. | STA-08 |
| contres | blocks | `blocks` | BLK | Box-score element. | STA-08 |
| balles perdues | turnovers | `turnovers` | TOV | Box-score element. | STA-08 |
| fautes personnelles | personal fouls | `personalFouls` | PF | Box-score element. | STA-08 |
| minutes et secondes, minutes jouées | minutes played | `minutes`, `seconds` | MIN | Time on court. | STA-08, H-13 |
| Game Score | Game Score | `gameScore` | Game Score | Hollinger's formula, unchanged. | STA-11, H-13 |
| minutes décimales | decimal minutes | `decimalMinutes` | — | Minutes plus seconds ÷ 60 (34:30 is 34.5). | STA-12 |
| indice de performance, indice, indicateur global par minute | performance index | `performanceIndex` | Index | Game Score ÷ decimal minutes; may be negative; three decimals on screen. | STA-12, H-13 |
| match joué, non joué | played, not played | `GamePlayClassification` | Played; Did not play | Played when time on court is strictly positive; the cause of absence is never stored. | STA-13 |
| match exploitable | usable game | `usable` | Usable | Played, complete and consistent box score, playing-time threshold reached. | STA-14 |
| joué non exploitable | played, not usable | `played_not_usable` | Not usable | Played but box score incomplete or suspect, or under the threshold. | STA-14 |
| seuil de temps de jeu | playing-time threshold | `playingTimeThreshold` | Playing-time threshold | max(15 min, 50 % of regular-season average minutes); same for baselines and measured games. | STA-14, STA-15 |
| plancher (de temps de jeu) | playing-time floor | `playingTimeFloorMinutes` | — | The 15-minute floor. | STA-14 |
| référence de saison | season baseline | `SeasonBaseline` | Season baseline | Mean and standard deviation of the index over the usable games of a season and baseline phase, measured game excluded. | STA-16 |
| phase de la référence | baseline phase | `BaselinePhase` | Baseline | regular season or postseason (section 4.2). | STA-16, STA-18 |
| moyenne (de saison) | season mean | `mean` | Mean | Mean index of the baseline. | STA-16 |
| écart-type (de saison), écart-type de saison | season standard deviation | `standardDeviation` | SD | Sample standard deviation (n − 1). | STA-16, H-STA-04 |
| variabilité habituelle | usual variability | — | — | The season standard deviation, in plain words. | D-16 |
| état (de la référence) | baseline status | `SeasonBaselineStatus` | Status | final, provisional, building or insufficient. | STA-19–STA-22 |
| mention « partielle » | partial baseline | `isPartial` | Partial | Over 20 % of played games lack an index; still usable. | STA-24 |
| match mesuré exclu | measured game excluded | `excludedGameId` | — | A baseline never contains its own measured game. | STA-16, STA-17 |
| taille minimale d'une référence | minimum baseline size | `minBaselineGames` | — | 10 usable games. | STA-19 |
| phase terminée | phase over | — | — | Regular season over, or the player's team eliminated or the Finals played. | STA-20 |
| comparaison indicative | indicative comparison | `IndicativeComparison` | Indicative | While a baseline is building, comparison with the previous regular season; never counted. | STA-23 |
| bilan (d'une équipe), bilan d'équipe | win-loss record | `TeamWinLossRecord` | Record | Regular-season wins and losses, optionally excluding one game; feeds opponent strength. | STA-06 |
| prochain match | next game | `NextGame` | Next game | Next scheduled official game of the current team; the player may miss it. | STA-26, STA-27 |
| « aucun match prévu » | no game scheduled | `NoNextGameReason` | No game scheduled | With its reason (section 4). | STA-26 |
| dernier match joué | last game played | `lastGamePlayedOn` | Last game played | — | STA-26, STA-46 |
| premier match NBA, « date inconnue » | first NBA game, date unknown | `firstNbaGameOn` | First NBA game; Date unknown | Bounds the career for requests and imports. | STA-47 |
| intersaison | offseason | `offseason` | Offseason | Period between seasons. | STA-26, STA-48 |
| mise à jour quotidienne, mise à jour des statistiques, tâche de statistiques | daily stats update | task `stats_update` | Statistics update | Once a day, at least 3 h after the last tip-off of the past game day. | STA-32, TRV-25 |
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
| données en mémoire, mise en mémoire | stored data | — | — | Everything fetched is kept; recalculations never call the source. | STA-42, STA-43 |
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
| « tendance générale du type, ne décrit pas ce joueur » | general trend of the type, does not describe this player | — | (section 7) | Title above the trend shown for a player under the threshold. | SEN-31 |
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
| faux signaux attendus, synthèse | expected false signals | `ExpectedFalseSignals` | Verdicts chance alone would produce | Evaluated pairs × 4.6 % (at least possible) and × 0.27 % (probable). | SEN-41 |
| pièges d'interprétation | interpretation pitfalls | — | Interpretation pitfalls | Section of 08 shown from "Method and limits". | 08, IHM-69 |
| affichage honnête (des petits échantillons) | honest display | — | — | Counts, ranges and case lists always shown; no showcase of the best profiles. | SEN-38–SEN-40, IHM-45–IHM-52 |
| association observée, cause démontrée | observed association, demonstrated cause | — | — | A verdict describes the first, never the second. | SEN-42 |

Merged into other rows: « profil » (into sensitivity profile); « écart normalisé moyen » (into mean gap); « niveau de confiance » (into profile confidence); « fourchette » (into plausible range); « seuil de cas » (into valid-case threshold).

Decisions:

- The direction words are nouns, as in the pre-decided "increase / decrease": « à la hausse » becomes "increase" ("possible, increase"), never "upward" or "positive".
- « bruit attendu » keeps "expected" because it is a statistical term; "expected" never qualifies a performance (section 8).

### 3.8 Press collection

| French | English | Code | UI label | Meaning | IDs |
| --- | --- | --- | --- | --- | --- |
| collecte, collecte des actualités | collection, news collection | task `news_collection` | Collection | Lot 2: reading the registered feeds and storing new articles. | COL-12–COL-16 |
| veille quotidienne | daily watch | — | — | Daily collection and detection, the core of Lot 2. | 00, IHM-71 |
| actualités, flux d'actualités, flux | news, news feed, feed | — | Feed | Public syndicated feed of a news outlet. | COL-02 |
| source (de presse), source de presse | press source | `PressSource` | Press source | Feed registered by the owner after a trial read and an attestation. | COL-02–COL-10 |
| adresse du flux | feed URL | `feedUrl` | Feed address | Public, standard syndication format, no login or fee. | COL-02, COL-07 |
| nom du média | outlet name | `outletName` | Outlet | Editable name; for an aggregator item, the origin outlet when given. | COL-06, COL-25 |
| média d'origine | origin outlet | — | — | Outlet that first published an item an aggregator relays. | COL-06 |
| agrégateur | aggregator | — | Aggregator | Feed relaying several outlets; attestation covers the whole source. | COL-06, H-COL-06 |
| presse sportive publique (attestation) | public sports press | `publicSportsPressAttestedAt` | I confirm this is public sports press | Attestation required to add a source. | COL-03 |
| format de syndication standard | standard syndication format | — | — | RSS or Atom, not named by the specs. | COL-02 |
| langue | language | `Language` | Language | en or fr only; of the item, else of the source. | COL-05, COL-17 |
| fuseau horaire du média | outlet time zone | `outletTimeZone` | Outlet time zone | Completes item dates that lack a zone. | COL-04, COL-20 |
| essai (d'une source), flux d'essai, lecture d'essai | trial read | `trialRead()` | Try | Reading a feed before adding it; nothing is stored. | COL-02–COL-07 |
| avertissement à l'ajout (datation sans heure, sans fuseau) | imprecise dating warning | — | — | Shown before adding a source whose items lack a time or zone. | COL-04 |
| état d'activation | activation status | `ActivationStatus` | Status | active, deactivated or withdrawn; set by the owner. | COL-09, COL-10, COL-40 |
| désactivée, désactiver | deactivated, deactivate | `deactivated` | Deactivated; Deactivate | Not read; reversible; the period is never caught up. | COL-09 |
| retirée, retirer (une source) | withdrawn, withdraw (a source) | `withdrawn` | Withdrawn; Withdraw | Never read again, cannot be reactivated; may be added again as a new source. | COL-10 |
| état de santé | health status | `HealthStatus` | Health | never read, working, down or silent; set by the system. | COL-40 |
| jamais lue | never read | `never_read` | Never read | Health of a new source. | COL-40 |
| fonctionnelle | working | `working` | Working | Reads bring articles. | COL-43 |
| en panne | down | `down` | Down since {date} | 2 consecutive failed runs (default). | COL-41 |
| muette | silent | `silent` | Silent since {date} | Reads succeed but bring nothing new for the silence period. | COL-42 |
| délai de silence | silence period | `silencePeriodDays` | Silent after | Per source, default 3 days. | COL-42, H-COL-04 |
| lecture, lecture réussie, lecture en échec | read, successful read, failed read | — | — | One reading of a feed during a run. | COL-11, COL-41 |
| exécution (de collecte) | collection run | `CollectionRun` | Run | One execution, scheduled or on demand. | COL-13–COL-16 |
| tentative (de lecture) | read attempt | `readAttempts` | — | Up to 3 per run. | COL-13 |
| rattrapage | catch-up | `isCatchUp` | Catch-up | Admitted age extended after missed runs, to gather what the feed still offers. | COL-45 |
| ancienneté maximale | maximum age | `maxArticleAgeDays` | — | Older items are not stored (default 3 days). | COL-24, H-COL-02 |
| ancienneté admise | admitted age | — | — | Maximum age, extended during a catch-up. | COL-45 |
| trou de collecte, trou de collecte possible | possible collection gap | `CollectionGap` | Possible collection gap | Period possibly missed between the last read and the oldest item offered; kept forever. | COL-46, H-01 |
| période non collectée | uncollected period | — | Uncollected period (source deactivated) | Deactivation period; not a gap, never caught up. | COL-09 |
| élément (du flux) | feed item | — | — | Entry of a feed before it is stored as an article. | COL-17, COL-18 |
| article | article | `Article` | Article | Stored feed item: title, outlet, link, instants, language, short excerpt. | COL-25 |
| dépêche | wire story | — | — | Agency story many outlets repeat; each copy is a distinct article. | COL-32 |
| instant de publication retenu | retained publication instant | `retainedPublishedAt` | Published | The latest instant compatible with the feed; fixed at first collection. | COL-19–COL-23 |
| instant de première collecte | first-collection instant | `firstCollectedAt` | First collected | Safe upper bound of publication. | COL-22 |
| principe de prudence | prudence principle | — | — | In doubt, the latest compatible instant, so nothing is wrongly deemed public before a game. | COL-21, H-02 |
| date de mise à jour | update date | — | — | Used when the feed gives no publication date. | COL-19 |
| anomalie de date | date anomaly | `dateAnomalies` | Date anomalies | Feed announces a publication after first collection. | COL-22 |
| extrait, court extrait | excerpt | `excerpt` | Excerpt | Feed-supplied text, 500 characters at most; erased on schedule. | COL-27, COL-37 |
| texte intégral, corps de l'article, corps d'un article | full text | — | — | Never stored; the article page is never fetched. | COL-25, COL-26 |
| rubriques | feed sections | — | — | Item categories of the feed; never stored. | COL-25 |
| lien nettoyé, éléments de suivi publicitaire | cleaned link, ad-tracking parameters | `cleanLink()` | — | Link without ad-tracking parts, used for dedup. | COL-28 |
| dédoublonnage, doublon | deduplication, duplicate | — | Duplicates | Same link, same feed ID, or same outlet and title within 6 h. | COL-30–COL-33 |
| fenêtre de dédoublonnage par titre | title dedup window | `titleDedupWindowHours` | — | 6 h by default. | COL-30, H-COL-02 |
| trace de dédoublonnage | dedup trace | `DedupTrace` | — | Link and first-collection instant of a deleted article, kept 180 days; none after a withdrawal. | COL-34, DSN-34 |
| état de traitement | processing status | `ArticleProcessingStatus` | Status | Set by collection, evolved by detection (section 4). | COL-35 |
| « à analyser » | to analyze | `to_analyze` | To analyze | — | COL-35 |
| « en attente de classification » | awaiting classification | `awaiting_classification` | Awaiting classification | — | COL-35 |
| « non pertinent » | not relevant | `not_relevant` | Not relevant | Deleted after 30 days, rescuable until then. | COL-35, COL-36 |
| « rattaché » | attached | `attached` | Attached | To at least one event, detected or dismissed. | COL-35, COL-37 |
| « lié à une proposition » | linked to a proposal | `linked_to_proposal` | Linked to a proposal | Waits for the decision on a type proposal. | COL-35, TAX-19 |
| conservation, durée de conservation | retention, retention period | — | — | How long data is kept. | COL-34–COL-38 |
| purge, purge des articles, tâche de purge | purge, purge task | task `data_purge` | Purge | Daily deletion of data past its retention. | COL-39, TRV-25 |
| journal de collecte, entrée du journal | collection journal, journal entry | `CollectionJournalEntry` | Collection journal | One entry per run, written for a non-specialist. | COL-48, COL-49 |
| origine (de l'exécution) | run origin | `CollectionRunOrigin` | Origin | scheduled, on demand, with catch-up. | COL-48 |
| réussite, échec (d'une source) | success, failure | `SourceReadOutcome` | Succeeded; Failed | Per source, with a plain-language failure reason. | COL-48 |
| éléments lus, articles nouveaux, doublons, éléments trop anciens, incomplets, en langue non traitée, anomalies de date | items read, new articles, duplicates, too old, incomplete, unsupported language, date anomalies | `CollectionCounters` | (same) | Journal counters per source. | COL-48 |
| « incomplet » | incomplete | `incomplete` | Incomplete | Item without link or title; not stored, counted. | COL-18 |
| indicateurs (de la source) | source indicators | `SourceIndicators` | Indicators | Articles per day, shares prefiltered, attached and exactly dated, last read, health. | COL-11 |
| incident « flux en panne », panne de flux | press source down | `press_source_down` | Press source down | Opened when a source goes down. | COL-41, TEL-15 |
| incident « collecte impossible » | collection impossible | `collection_impossible` | Collection impossible | All active sources failed in one run: one incident, not one per source. | COL-44 |
| avertissement (source muette) | silent press source | `press_source_silent` | Silent press source | Warning, notified like an incident. | COL-42, TEL-15 |
| avertissement (trou sans exécution manquée) | feed too short | `feed_too_short` | Feed keeps too few items | Warning suggesting another collection time. | COL-46 |
| collecte à la demande | on-demand collection | `on_demand` | Collect now | Started by the owner; deferred if a run is in progress. | COL-14, IHM-36 |

Merged into other rows: « flux », « flux d'actualités » (into news feed); « court extrait » (into excerpt); « corps de l'article » (into full text).

Decisions:

- Health « en panne » is "down" and the Telegram link « rompue » is "broken", so the two status sets share no value.
- « délai de silence » is "silence period", far from Telegram's "quiet hours" (« plage de silence »).

### 3.9 Detection

| French | English | Code | UI label | Meaning | IDs |
| --- | --- | --- | --- | --- | --- |
| détection, détection quotidienne, balayage quotidien, balayage planifié quotidien | detection, daily detection | task `event_detection` | Detection | Lot 2: classifying collected articles and creating detected events. | DET-01–DET-58 |
| passage de détection | detection pass | — | — | Collection plus the detection chained to it. | ALE-02, TRV-26 |
| préfiltrage | prefiltering | `prefilter()` | Prefilter | Quota-free search of active players' name variants in each article. | DET-02–DET-07 |
| joueurs reconnus | recognized players | `recognizedPlayerIds` | Recognized players | Players the prefilter found in an article. | DET-06 |
| indice complémentaire | corroborating clue | — | — | Team name or other clue required for an ambiguous variant. | DET-04 |
| décompte d'exposition | exposure count | `ExposureCount` | — | Per player and day, articles citing him; feeds the exposure indicator. | DET-57, JOU-03 |
| file d'attente (de classification), file d'attente de classification, file, élément de la file | classification queue, queue item | `ClassificationQueueItem` | Classification queue | Articles waiting for the model, in priority order within quota. | DET-08, DET-09 |
| horizon de priorité | priority horizon | `queuePriorityHorizon` | — | Parameter ordering the queue by next game. | DET-09 |
| reprise de la file, tâche de reprise | queue resumption | task `classification_queue_resumption` | — | Resumes the queue every 6 h while it is not empty. | DET-10 |
| quota, palier gratuit | quota, free tier | — | Quota | Limits of the free language-model service. | DET-08, TRV-03 |
| incident « quota atteint » (classification) | quota reached | `quota_reached` | Quota reached | Opened when the quota stops processing; closed when the queue is empty. | DET-11 |
| modèle, modèle de langage | language model | — | Language model | Free model that classifies articles; designated by its function only. | DET-08, TRV-09 |
| classification, classer | classification, classify | `classify()` | Classification | Model reading of an article for each recognized player. | DET-13–DET-23 |
| résultat de classification | classification result | `ClassificationResult` | Classification result | Facts found per article and player, with type, confidence, description, justification. | DET-16, DET-53 |
| classement par l'utilisateur | manual classification | origin `user` | Classify | Owner gives the type (or none) and the player by hand. | DET-13 |
| origine (de la classification) | classification origin | `ClassificationOrigin` | Origin | model or user. | DET-13, DET-49 |
| nouvelle classification, reclassement, reclasser | reclassification, reclassify | `reclassify()` | Classify again | New submission on request (uses quota), or after a type is validated. | DET-36, DET-50 |
| « classification en échec » | classification failed | `classificationFailed` | Classification failed | Mark on a queue item after the allowed attempts. | DET-22 |
| réponse inexploitable | malformed response | — | — | Model answer that cannot be read; retried up to 2 times. | DET-22 |
| instructions données au modèle, version des instructions | model instructions, instructions version | `instructionsVersion` | — | Prompt of the classifier; its version is traced. | DET-23, DET-53 |
| fait, fait nouveau, fait ancien | fact, new fact, old fact | `isNewFact` | New fact; Old fact | An old fact is a rehash of something public before the grouping window. | DET-16, DET-20 |
| justification, justification d'une classification | justification | `justification` | Justification | One sentence citing the satisfied criterion; same wording rules as a description. | DET-16, DET-21 |
| seuil de détection, « sous le seuil » | detection threshold, below threshold | `detectionThreshold` | Detection threshold; Below threshold | 70/100 by default; below it no event is created. | DET-24, H-DET-03 |
| tranche de confiance | confidence band | — | — | Band of detection confidence used to show dismissal rates. | DET-25 |
| description type | template description | — | — | Neutral description that replaces a non-compliant one. | DET-21 |
| « description à revoir » | description to review | `description_to_review` | Description to review | Notice until the owner corrects the description. | DET-21, DET-47 |
| « texte non conservé » | text not kept | — | Text not kept | Replaces a non-compliant justification. | DET-21 |
| regroupement (des articles), fenêtre de regroupement | grouping, grouping window | `groupingWindowHours` | — | Articles on one fact attach to one event within the window (72 h by default). | DET-27–DET-29 |
| rattacher, rattachement, détacher (un article) | attach, attachment, detach | `attachArticle()`, `detachArticle()` | Attach; Detach | Link an article to an event, or remove it. | DET-27, DET-47 |
| date de référence (d'un événement détecté) | reference date | `referenceDate` | Reference date | Earliest retained instant of its articles; moves earlier by itself, later only by detaching. | DET-30, DET-31 |
| avancer, reculer, retarder (la date de référence) | move earlier, move later | `moveReferenceDateEarlier()` | Move the date earlier | Owner adds an older dated public source. | DET-31, DET-48 |
| borne prudente | conservative bound | — | — | The reference date is a latest-possible instant, never an early guess. | DET-30, ALE-15 |
| indication d'antériorité | timing hint | `timingHint` | — | Model's hint that the fact predates the article ("Monday night", "yesterday"). | DET-16, DET-32 |
| « doublon possible d'un événement historique » | possible duplicate of a historical event | `possible_historical_duplicate` | Possible duplicate of a historical event | Mark: another type's fact dated close to a historical event. | DET-58 |
| « doublon d'un événement historique » | duplicate of a historical event | `duplicate_of_historical_event` | Duplicate of a historical event | Dismissal reason when the fact is the same. | DET-43, DET-58 |
| « déjà rapporté par un backtest » | already reported by a backtest | `already_reported_by_backtest` | Already reported by a backtest | Not-relevant reason; the article keeps a link to the historical event. | DET-58 |
| motif (de non-pertinence) | not-relevant reason | `NotRelevantReason` | Reason | Why an article became not relevant (section 4). | DET-06–DET-36 |
| motif (d'écartement) | dismissal reason | `DismissalReason` | Reason | Closed list, comment required for "other" (section 4). | DET-43 |
| position (de l'écartement par rapport au coup d'envoi) | dismissal timing | `DismissalTiming` | Before tip-off; After tip-off | Recorded with every dismissal. | DET-46 |
| proposition transmise | submitted proposal | `TypeProposalSubmission` | — | Fact of no validated type sent to the taxonomy as a new proposal. | DET-34, TAX-18 |
| raison de la non-correspondance | no-fit reason | `noFitReason` | Why no type fits | Sent with each proposal. | DET-34, TAX-18 |
| repêcher, repêchage | rescue | `rescueArticle()` | Rescue | Owner turns a not-relevant article into an event of his choice. | DET-49 |
| corriger, fusionner (des événements détectés) | correct, merge events | `correctEvent()`, `mergeEvents()` | Correct; Merge | Wrong player, type or duplicate: corrected, not dismissed. | DET-47 |
| journal de détection | detection journal | `DetectionJournalEntry` | Detection journal | One entry per run with the counters of the next row. | DET-55 |
| articles reçus, non retenus par le préfiltrage, classés, classés sans fait, rattachés à un événement existant, sous le seuil, faits anciens, faits déjà rapportés par un backtest, propositions transmises, occurrences ajoutées, descriptions remplacées, classifications en échec, événements créés, articles restant en file, quota consommé et restant | articles received, not prefiltered in, classified, classified without fact, attached to an existing event, below threshold, old facts, already reported by a backtest, proposals submitted, occurrences added, descriptions replaced, failed classifications, events created, still queued, quota used and left | `DetectionCounters` | (same) | Detection journal counters. | DET-55 |
| indicateurs de qualité | quality indicators | — | — | Dismissal rates by confidence band and other detection measures. | DET-25, DET-56 |
| « réponse sur le terrain » | "answer on the court" | — | — | Outcome narrative the classifier must ignore. | DET-19 |
| événements d'équipe, événement d'équipe, élimination humiliante | team events, humiliating elimination (example) | — | — | Out of scope: a fact that targets only a team is no event. | Q-06, VUE-04 |

Merged into other rows: « file » (into classification queue); « reclassement » (into reclassification); « tâche de reprise » (into queue resumption).

Decisions:

- « indice complémentaire » is "corroborating clue": "index" belongs to the performance index.
- « réponse inexploitable » is "malformed response": "usable" is kept for games.
- « indication d'antériorité » is "timing hint", so "precedence" keeps its single meaning (historical events, IMP-18).

### 3.10 Alert sheets

| French | English | Code | UI label | Meaning | IDs |
| --- | --- | --- | --- | --- | --- |
| fiche d'alerte, fiche d'alerte complète | alert sheet | `AlertSheet`; key `alertSheetId` | Alert sheet | Lot 2: full, sourced write-up produced when a profiled player has a new detected event. | ALE-01–ALE-31 |
| alerte | alert | — | Alert | An alert sheet, or the Telegram message announcing it. | TEL-11, IHM-16 |
| historique des alertes | alert history | `AlertHistory` | Alert history | Every sheet with frozen content, updates and outcome; only a withdrawal erases. | ALE-28 |
| numéro, numéro d'ordre (de la fiche), fiche n° | sheet number | `number` | Sheet no. {n} | Unique, never reused, even after erasure. | ALE-06, ALE-30 |
| production, produite, date et heure de production | production, produced, produced at | `producedAt` | Produced | When the sheet was produced, at the end of the detection pass or at an import. | ALE-02, ALE-05, ALE-06 |
| émission, depuis l'émission | issue, since issue | — | — | The moment the sheet was issued; the reference of « profil modifié depuis l'émission ». | ALE-19 |
| indication « produite avant le coup d'envoi » | produced before tip-off | `AlertSheetTiming` `produced_before_tip_off` | Produced before tip-off | Timing of a sheet read in time. | ALE-06 |
| fiche tardive, fiches tardives, « tardive » | late sheet, late | `late` | Late | Produced, or completed with profile values, after its measured game's tip-off; kept, never a test. | ALE-24 |
| état (de la fiche) | sheet status | `AlertSheetStatus` | Status | open, closed or canceled, plus the late mark. | ALE-26 |
| ouverte | open | `open` | Open | One non-dismissed event still has a case awaiting its game. | ALE-26 |
| close | closed | `closed` | Closed | All those cases are measured, excluded or not measurable. | ALE-26 |
| annulée | canceled | `canceled` | Canceled | All its events dismissed or reassigned to another player. | ALE-22, ALE-26, ALE-31 |
| motif d'annulation (de la fiche) | sheet cancellation reason | `AlertSheetCancellationReason` | Reason | all events dismissed, or attachment corrected. | ALE-22, ALE-31 |
| en-tête | header | — | — | Player, team at production, number, date, status, late mark, summary sentence. | ALE-07 |
| phrase de synthèse | summary sentence | — | — | Type, verdict with valid cases (or the under-threshold label), expected game. | ALE-07 |
| équipe au moment de la production | team at production | `teamIdAtProduction` | Team | Kept even after a trade. | ALE-07 |
| événement (de la fiche) | sheet event | `AlertSheetEvent` | Event | Type, description, public moment, sources, detection confidence, context, lead time. | ALE-08 |
| délai entre la publication et le coup d'envoi, délai avant le coup d'envoi | lead time | `leadTime` | Before tip-off | From reference instant to the expected game's tip-off ("25 h 50 min"). | ALE-08 |
| sensibilité du joueur à ce type | the player's sensitivity to this type | `ProfileSnapshot` | Sensitivity to this type | Profile values copied as they are, default view. | ALE-09 |
| sens de l'effet | effect direction | `direction` | Direction of the effect | Always written in full; a decrease is shown like an increase. | ALE-10, H-04 |
| repère général | trend benchmark | `TrendSnapshot` | General trend | One-line reminder of the type's general trend after an individual verdict. | ALE-11 |
| profil sous le seuil | profile below threshold | — | — | Player under the case threshold: trend first, player's values second, marked "indicative". | ALE-12, SEN-31 |
| « indicatif » | indicative | — | Indicative | Player's own values under the threshold, or a comparison while a baseline builds. | ALE-12, STA-23 |
| profil non concluant | inconclusive profile | — | — | Shown without softening, with its fixed sentence. | ALE-13 |
| type non couvert (fiche) | type not covered | `type_not_covered` | Type not covered by the backtest | The coverage lacks the event's type. | ALE-14 |
| match attendu | expected game | `expectedGameId` | Expected game | First game of the player's team after the reference instant; usually the next game. | ALE-15, SUI-03 |
| « match attendu inconnu » | expected game unknown | `ExpectedGameState` `unknown` | Expected game unknown | No game known, with its reason. | ALE-15, ALE-23 |
| match attendu remplacé (barré) | superseded expected game | `superseded` | — | Former expected game, struck through with its reason. | ALE-23 |
| temps restant | time remaining | — | Time remaining | Computed at display time. | ALE-15, BKT-16 |
| réserves, réserve | caveats, caveat | `Caveat`; `CaveatKind` | Caveats | Every applicable caveat in plain sentences, none ever hidden (section 4). | ALE-16 |
| marge de vigilance | vigilance margin | `vigilanceMarginPoints` | — | Detection confidence under threshold + margin (10 points) raises a caveat. | ALE-16, H-ALE-06 |
| mention permanente | standing notice | — | (section 7) | Closing sentence of every sheet. | ALE-17 |
| formulations interdites | banned wording | — | — | Section 8. | ALE-18 |
| valeurs figées | frozen values | `frozenAt` | — | Profile and trend values frozen when they enter the sheet; never rewritten. | ALE-19 |
| « profil modifié depuis l'émission » | profile changed since issue | `profileChangedSinceIssue` | Profile changed since issue | With a link to the current profile. | ALE-19 |
| « profil en cours de calcul » | profile being computed | `profile_being_computed` | Profile being computed | Values arrive later by a dated update. | ALE-05 |
| « aucun cas mesuré pour ce type à ce jour » | no measured case for this type yet | `no_measured_case_yet` | No measured case for this type yet | Profile status notice. | ALE edge cases |
| mises à jour, mise à jour datée | updates, dated update | — | Update | Later events, sources, game changes, context corrections, attachment corrections. | ALE-20–ALE-25, ALE-31 |
| section datée | dated section | `AlertSheetSection` | — | Added for a later event or a type change, with its own frozen profile. | ALE-20, ALE-31 |
| journal des mises à jour | update journal | `updateJournal` | Updates | Append-only list of a sheet's updates. | ALE-31 |
| rubrique « événement écarté » | dismissed-event section | — | Dismissed event | Where a dismissed event moves when others remain. | ALE-22 |
| rattachement corrigé | attachment corrected | `attachment_corrected` | Attachment corrected | Cancellation reason after a player correction. | ALE-31 |
| issue (de la fiche) | outcome | `AlertSheetOutcome` | Outcome | At closure: measured game, index, baseline, gap, case status, category, frozen forecast. | ALE-27 |
| renvoi vers une autre fiche | related sheet | `relatedSheetIds` | See also | Two sheets of a player ending on the same game. | ALE edge cases, H-ALE-02 |
| transmission à la validation | handover to validation | — | — | Status, late mark and frozen values given to the validation table. | ALE-29 |

Merged into other rows: « tardive » (into late sheet); « réserve » (into caveats); « numéro d'ordre » (into sheet number).

Decisions:

- « réserves » of a sheet are "caveats"; the research result's « réserve » is the "unverified note": two things, two words.
- « repère général » is "trend benchmark" and « repère du joueur » is "player marker".

### 3.11 Automatic tracking and validation

| French | English | Code | UI label | Meaning | IDs |
| --- | --- | --- | --- | --- | --- |
| suivi automatique | automatic tracking | — | — | Lot 2: every detected event's case is followed to its measurement without any action. | SUI-01–SUI-30 |
| suivi du match, suivi des matchs | game tracking | task `game_tracking` | — | Chained after each stats update: measure the pending tracked cases. | SUI-12, TRV-25 |
| cas suivi | tracked case | `Case` with origin `tracked` | Tracked case | Case born from a detected event. | SUI-01, SUI-05 |
| instant de création | creation instant | `createdAt` | Created | Fixed at creation; compared with the measured game's scheduled start. | SUI-01, SUI-06 |
| enregistrement à temps | recording timing | `RecordingTiming` | — | recorded in time or recorded after tip-off. | SUI-06 |
| enregistré à temps, cas enregistré à temps | recorded in time | `recorded_in_time` | Recorded in time | Created before its measured game's scheduled start; only these test the hypothesis. | SUI-06, H-SUI-01 |
| enregistré après le coup d'envoi | recorded after tip-off | `recorded_after_tip_off` | Recorded after tip-off | Measured and counted in profiles, counted apart, never a test. | SUI-06 |
| pronostic | forecast | `Forecast` | Forecast | Verdict taken from historical cases only, against which a tracked case is judged; restricted word (section 8). | SUI-08, TEL-05, IHM-50 |
| version du pronostic | forecast version | `ForecastVersion` | — | Timestamped each time the historical profile changes before tip-off. | SUI-09 |
| pronostic figé | frozen forecast | `frozenForecast` | Frozen forecast | Last version before the measured game's scheduled start; never changes after. | SUI-09 |
| instant de figement | frozen at | `frozenAt` | — | When the forecast was frozen. | SUI-09, SUI-10 |
| pronostic tardif, « tardif » | late forecast | `isLate` | Late forecast | Computed after tip-off because no historical profile existed; counted apart. | SUI-10 |
| sans pronostic | no forecast | `no_forecast` | No forecast | No possible or probable verdict to judge against; also a case category. | SUI-08, SUI-22 |
| source du pronostic | forecast source | `ForecastSource` | Forecast source | player profile, general trend, or none. | SUI-08, SUI-09 |
| cas historiques seuls (vue) | historical cases only | `historical_only` | Historical cases only | The view forecasts are computed on. | SUI-08, SEN-21 |
| écart dans le sens du pronostic | gap in forecast direction | `gapInForecastDirection` | Gap in forecast direction | Gap, or its opposite when the forecast is a decrease. | SUI-22 |
| écart annoncé, écart moyen annoncé | announced gap | `announcedMeanGap` | Announced gap | Mean gap of the frozen forecast. | SUI-22, SUI-24 |
| catégorie (d'un cas suivi) | case category | `CaseCategory` | Category | confirmed, refuted, neutral or no forecast (section 4). | SUI-22 |
| seuil de catégorie | category threshold | `categoryThreshold` | — | 0.25 in forecast direction. | SUI-22, H-SUI-05 |
| tableau de validation, tableau de validation honnête, profils confirmés ou démentis | validation table | `ValidationTable` | Validation table | Confronts profiles built on historical cases with tracked cases recorded in time; stops nothing. | SUI-23–SUI-30, D-35 |
| ligne (du tableau) | row | `ValidationRow` | — | type, player, player-type pair, overall, overall sub-row. | SUI-23, SUI-28 |
| ligne d'ensemble, sous-ligne | overall row, overall sub-row | `overall`, `overall_subrow` | Overall | All tracked cases with forecast; sub-rows by forecast source and level. | SUI-23, SUI-28 |
| comptes par catégorie | category counts | `categoryCounts` | — | With forecast, confirmed, refuted, neutral; without forecast. | SUI-24 |
| comptes attendus du hasard | chance-expected counts | `chanceExpectedCounts` | Expected by chance | What chance alone would give for each category. | SUI-24 |
| écart moyen historique actuel | current historical mean gap | `currentHistoricalMeanGap` | — | Same row, valid historical cases. | SUI-24 |
| comptes à part | separate counts | `separateCounts` | Counted apart | Late forecasts, recorded after tip-off, excluded or pending cases, post-tip-off decisions. | SUI-25 |
| bilan (d'une ligne) | assessment | `RowAssessment` | Assessment | confirmed, confirmed with a weaker effect, refuted or undecided; needs 10 cases. | SUI-26, SUI-27 |
| nombre minimal de cas suivis pour un bilan | minimum tracked cases for an assessment | `minTrackedCasesForAssessment` | — | 10 by default. | SUI-26, H-SUI-06 |
| « trop peu de cas suivis pour conclure (k sur 10) » | too few tracked cases | — | (section 7) | Shown instead of an assessment. | SUI-26 |
| règles de lecture | reading rules | — | How to read this table | Three rules the table always recalls. | SUI-28 |
| résultat de match suivi, résultat d'un match suivi | tracked game result | `TrackedGameResult` | Tracked game result | Content sent to notifications when a tracked case leaves awaiting game. | SUI-19, TEL-13 |
| résultat communiqué, transmis | transmitted result | `transmittedResults` | — | What was sent, kept on the case. | SUI-19, SUI-20 |
| décision prise après le coup d'envoi | post-tip-off decision | `PostTipOffDecision` | After tip-off | Owner decision after tip-off that moves a case in or out of the counts or changes its game. | SUI-17 |
| sortie, entrée (des comptes), changement de match mesuré | exit, entry, measured-game change | `PostTipOffDecisionEffect` | Left the counts; Entered the counts; Game changed | Effect of a post-tip-off decision. | SUI-17 |
| critère d'arrêt, seuil d'abandon | stopping criterion, abandonment threshold | — | — | None exists: the table never stops or suggests stopping anything. | SUI-29, D-35 |
| mise à l'épreuve, épreuve des faits | real-world test | — | — | What tracked cases do to profiles. | SUI-11, 00 |
| conditions réelles | real conditions | — | — | Observation as events happen, before the games. | D-29, 00 glossary |
| mise en service | go-live | — | — | First start of the app in production; the counter counts since then. | DSN-29, TAX-15 |

Merged into other rows: « tardif » (into late forecast); « résultat d'un match suivi » (into tracked game result); « écart moyen annoncé » (into announced gap); « épreuve des faits » (into real-world test).

Decisions:

- « pronostic » is "forecast", never "prediction": "prediction" is the everyday word of betting tips and stays reserved for the fixed disclaimers (section 8).
- « bilan » of a row is "assessment", so "confirmed / refuted" appear in two enumerations (case category, row assessment) that never share a type (section 4.2).

### 3.12 Notifications

| French | English | Code | UI label | Meaning | IDs |
| --- | --- | --- | --- | --- | --- |
| notification | notification | `NotificationMessage` | Notification | Lot 2: Telegram message; always a copy of a fact stored in the app. | TEL-01, TEL-02 |
| message | message | `NotificationMessage` | Message | One Telegram message, with its status. | TEL-33 |
| robot (« bot »), robot Telegram | bot | — | Bot | The app's Telegram bot, created at installation; answers no command. | TEL-03, TEL-28 |
| jeton (du robot) | bot token | — | — | Secret of the deployment configuration. | TRV-37, TRV-64 |
| assistant officiel (« BotFather ») | BotFather | — | — | Telegram's official assistant that creates bots. | TRV-75 |
| identifiant (du robot) | bot username | — | — | Shown with the code when "Open Telegram" cannot open the app. | TEL-29, TRV-75 |
| réponse neutre | neutral reply | — | — | At most this reply to a chat that is not linked; never any data. | TRV-67, TEL-31 |
| conversation, conversation privée | chat, private chat | `chatId` | Chat | The only private chat messages go to; never a group or channel. | TEL-01, DSN-31 |
| groupe, canal | group, channel | — | — | Never linked. | TEL-29, DSN-31 |
| liaison Telegram, mise en relation | Telegram link, linking | `TelegramLink` | Telegram link | The link between the app and one private chat. | TEL-28–TEL-32 |
| relier, relier la conversation, « Relier Telegram » | link, link Telegram | `linkTelegram()` | Link Telegram | Produces a one-time code carried by "Open Telegram". | TEL-29 |
| délier, « Délier » | unlink | `unlinkTelegram()` | Unlink | Stops all sending. | TEL-30 |
| état de la liaison | link status | `TelegramLinkStatus` | Status | not linked, awaiting confirmation, linked, broken. | TEL-32 |
| rompue | broken | `broken` | Broken | Permanent send failure; relinking required; shown on Home and in the to-do list. | TEL-37 |
| code à usage unique, code de liaison | one-time link code | `linkCode` | — | Valid 15 minutes; refused if expired, used or unknown. | TEL-29, TEL-31 |
| « Ouvrir Telegram », « Démarrer » | Open Telegram, Start | — | Open Telegram; Start | The app button, then Telegram's own button. | TEL-29 |
| message de confirmation | link confirmation message | — | (section 7) | Sent when a chat is linked, always. | TEL-16, TEL-29 |
| message d'essai | test message | `sendTestMessage()` | Send a test message | Can be requested at any time. | TEL-29, TRV-47 |
| catalogue des messages | message catalog | `NotificationKind` | — | Every message kind with trigger, content and link. | TEL-09–TEL-16 |
| catégorie (de notification) | notification category | `NotificationCategory` | Category | backtest requests, alerts, tracked results, type proposals, incidents. | TEL-24 |
| sous-option | sub-option | `NotificationSubOption` | — | deadline reminder, inconclusive alerts, incident end. | TEL-24 |
| messages de service | service messages | — | — | Messages outside any category; only the master switch stops them. | TEL-16 |
| interrupteur général | master switch | `notificationsEnabled` | Send notifications | Suspends all sending without unlinking. | TEL-25 |
| réglages de notification | notification settings | `NotificationSettings` | Notifications | Categories, sub-options, quiet hours, urgency, cap, delays, thresholds. | TEL-24–TEL-27 |
| première ligne | first line | — | — | « Egoscope · catégorie — sujet », often visible on the lock screen. | TEL-06, TEL-08 |
| écran verrouillé | lock screen | — | — | Why the first line is limited to category and subject. | TEL-06 |
| lien de retour | deep link | — | — | Link to the exact screen; holds no secret. | TEL-07 |
| rappel, rappel avant échéance | reminder, pre-deadline reminder | `deadline_reminder` | Reminder | Request still to do 6 h before the expected game. | TEL-10 |
| « échéance modifiée » | deadline changed | `deadline_changed` | Deadline changed | New detected event changes a request's deadline. | TEL-09 |
| alerte, alerte urgente | alert, urgent alert | `alert` | Alert; Urgent alert | Message announcing an alert sheet. | TEL-11, TEL-21 |
| mise à jour (d'une alerte) | alert update | `alert_update` | Update | New event, game change or late profile values. | TEL-12 |
| rappel d'incident, fin d'incident | incident reminder, incident end | `incident_reminder`, `incident_end` | Reminder; Incident resolved | Every 3 days while it lasts; short end message if the start was sent. | TEL-15 |
| délai de reprise d'un incident | incident recurrence window | `incidentRecurrenceWindowHours` | — | An incident that restarts within 6 h is not notified again. | TEL-15 |
| sobriété | restraint | — | — | Grouping, quiet hours, urgency and cap keep messages few. | TEL-17–TEL-23 |
| un fait, un message | one fact, one message | — | — | A fact is notified once. | TEL-17 |
| regroupement par passage, message groupé | grouping by pass, digest | `digest` | — | Messages of one pass leave as one digest; alerts beyond 3 too. | TEL-19 |
| seuil de regroupement des alertes | alert grouping threshold | `alertGroupingThreshold` | — | 3 alerts per pass. | TEL-19 |
| nombre de faits détaillés par message groupé | facts detailed per digest | `maxFactsPerDigest` | — | 10, the rest summarized ("and 4 more"). | TEL-19 |
| plage de silence | quiet hours | `quietHours` | Quiet hours | 23:00–08:00 in the owner's time zone by default. | TEL-20 |
| urgence, urgent, exception d'urgence | urgency, urgent, urgent exception | `isUrgent`, `urgentExceptionEnabled` | Urgent | Message about a game starting before quiet hours end; sent at once and alone. | TEL-21 |
| plafond quotidien, « plafond atteint » | daily cap, cap reached | `dailyCap` | Daily cap; Daily cap reached | 20 messages per day; then one cap message and nothing until the next day. | TEL-22 |
| obsolescence, sans objet | staleness, moot | — | — | A deferred message whose fact no longer holds is discarded. | TEL-23 |
| statut (du message) | message status | `NotificationMessageStatus` | Status | to send, deferred, sent, grouped, discarded, failed. | TEL-33 |
| différé | deferred | `deferred` | Deferred | Held during quiet hours. | TEL-20, TEL-33 |
| abandonné | discarded | `discarded` | Discarded | Not sent because moot or its category was turned off. | TEL-23, TEL-26 |
| en échec | failed | `failed` | Failed | After the last retry; Home shows a banner. | TEL-36 |
| échec temporaire, échec définitif | temporary failure, permanent failure | `SendFailureKind` | — | Retry with growing intervals, or stop and mark the link broken. | TEL-35, TEL-37 |
| intervalles de nouvelle tentative | retry intervals | `retryIntervalsMinutes` | — | 1, 5, 15, 30, 60 minutes. | TEL-35 |
| message de rattrapage | catch-up message | `catch_up` | — | One message listing still-current facts not received, with the period. | TEL-36 |
| « événement sensible » | sensitive event | — | sensitive event | Replaces the type name of an intimate-subject type in messages. | TEL-06, DSN-35 |
| après le coup d'envoi (mention) | after tip-off | — | after tip-off | Notice on a still-useful message whose game has started. | TEL-23 |

Merged into other rows: « mise en relation » (into Telegram link); « code de liaison » (into one-time link code); « exception d'urgence » (into urgency).

Decisions:

- « abandonné » is "discarded", like the import's "Discard", so "abandon" stays free for the project-level « seuil d'abandon ».
- « message groupé » is "digest".

### 3.13 Interface and access

| French | English | Code | UI label | Meaning | IDs |
| --- | --- | --- | --- | --- | --- |
| application installable, application web installable (PWA) | installable web app | — | — | Phone-first PWA, usable on a large screen. | IHM-01, IHM-02 |
| écran | screen | — | — | One view of the app; routes in kebab-case. | IHM-17 |
| barre de navigation | navigation bar | — | — | Bottom on a phone, side on a large screen. | IHM-16 |
| Accueil | Home | route `/` | Home | Banners, to-do list, open alert sheets, last update dates. | IHM-19 |
| Joueurs, Joueurs suivis | Players | route `/players` | Players | List of followed players. | IHM-16, IHM-21 |
| Types | Types | route `/types` | Types | Taxonomy and type sheets. | IHM-16, IHM-31 |
| Alertes | Alerts | route `/alerts` | Alerts | Lot 2: alert sheets and alert history. | IHM-16, IHM-33 |
| Plus | More | — | More | Menu of the other screens. | IHM-16 |
| Demandes de backtest | Backtest requests | route `/backtest-requests` | Backtest requests | — | IHM-16, IHM-26 |
| Réglages | Settings | route `/settings` | Settings | Every parameter and setting, one screen. | IHM-37, TRV-34 |
| État de l'application | App status | route `/status` | App status | Tasks, services, quotas, volume, backups, pending items, incidents. | IHM-70, TRV-46 |
| Journal d'activité | Activity journal | route `/journal` | Activity journal | — | IHM-38, TRV-41 |
| Méthode et limites, page « Méthode et limites » | Method and limits | route `/method-and-limits` | Method and limits | Hypothesis, known limits, caution notes, withdrawn-events counter. | VUE-09, IHM-69 |
| Aide | Help | route `/help` | Help | — | IHM-16, IHM-53 |
| Événements détectés | Detected events | route `/detected-events` | Detected events | Lot 2. | IHM-16, IHM-32 |
| Tableau de validation | Validation table | route `/validation-table` | Validation table | Lot 2. | IHM-16, IHM-35 |
| Collecte et détection, Sources de presse | Collection and detection, Press sources | route `/collection` | Collection and detection; Press sources | Lot 2: sources, journals, queue. | IHM-36, IHM-71 |
| Détail d'un profil | profile detail | route `/players/[playerId]/profiles/[eventTypeId]` | — | Profile with its case groups. | IHM-24 |
| fiche d'un événement | event page | route `/events/[playerEventId]` | — | Check and correct an event; withdraw it. | IHM-67 |
| écran de retrait | withdrawal screen | — | Withdraw this event | Separate from dismissal and deletion; lists what disappears and the limits. | IHM-68, DSN-28 |
| écran d'une demande | request screen | route `/backtest-requests/[requestId]` | — | Prompt, copy, paste result, update, reduce, cancel. | IHM-27 |
| liste « à faire » | to-do list | `TodoList` | To do | Everything waiting for the owner, in sections (section 4). | IHM-20 |
| « à faire » (élément) | to-do item | `TodoItem` | — | One entry of the to-do list; not the request status "to do". | IHM-20 |
| rubrique | section | `TodoSection` | — | Group of the to-do list or of a screen. | IHM-20 |
| bandeau | banner | — | — | Strip at the top of Home. | IHM-19, IHM-40 |
| bandeau « demande en cours » | request-in-progress banner | `inProgressBannerHiddenAt` | Backtest in progress | Most recent request whose prompt was copied; "Later" hides it. | IHM-40 |
| demande en cours, « en cours » | request in progress | — | In progress | Derived: prompt copied, neither imported nor canceled; not a request status. | IHM-40 |
| indication « prompt copié » | prompt copied | `promptCopiedAt` | Prompt copied | Kept by the server; the request stays to do. | IHM-39, IHM-40 |
| copie en un toucher | one-tap copy | — | Copy prompt | The whole prompt in one tap. | IHM-39 |
| outil de recherche, adresse de l'outil de recherche | research tool, research tool URL | `researchToolUrl` | Open research tool | Optional address the owner sets; no tool is imposed. | IHM-44 |
| correction avec l'IA | correction with the AI | — | — | Copying the correction message back to the AI. | IHM-43 |
| « échéance proche » | deadline soon | — | Deadline soon | Under 24 h (parameter). | IHM-20 |
| incidents masqués | hidden incidents | `hiddenIncidentIds` | Hidden incidents | Incident hidden by the owner; still journaled and counted. | IHM-20 |
| masquer (un incident) | hide | `hideIncident()` | Hide | Hides an incident from Home; does not close it. | IHM-20 |
| tranches (de liste) | list pages | `listPageSize` | — | Lists load 50 items at a time. | IHM-18 |
| compte unique, authentification minimale | single account, minimal authentication | — | — | One owner, no sign-up. | IHM-05, H-10 |
| connexion, se connecter | login, log in | — | Log in | Password only. | IHM-06 |
| déconnexion | logout, log out | — | Log out; Log out of all devices | This device or all devices. | IHM-08 |
| mot de passe initial | initial password | — | — | From the deployment configuration; forces "Choose your password". | IHM-06, TRV-57 |
| « Choisir votre mot de passe » | choose your password | — | Choose your password | Only screen open with the initial password. | IHM-06 |
| échecs de connexion, blocage | login failures, lockout | `LoginFailure`, `LoginLockout` | Login locked until {time} | 5 failures in 15 minutes lock login for 15 minutes. | IHM-07, TRV-61 |
| session, expiration, expiration de session | session, expiry | `Session` | — | Stays open while used at least once per 30 days. | IHM-06, TRV-62 |
| appareil | device | `device` | Device | Several may be logged in at once. | IHM-06, H-IHM-06 |
| fuseau horaire, heure de Paris | time zone, Paris time | `timeZone` | Time zone; Paris time | Owner's zone, Paris by default. | IHM-14, H-IHM-02 |
| réglages d'interface | interface settings | `UiSettings` | Display | Time zone, research tool address, guide state, hidden incidents, banner state. | IHM-14, IHM-20, IHM-40, IHM-44, IHM-53 |
| hors connexion | offline | — | Offline | Reading cached screens; no entry is sent later without the owner knowing. | IHM-57, IHM-58 |
| copies d'écrans (gardées sur l'appareil), données gardées sur l'appareil | cached screens, device cache | `DeviceCache` | — | Copies of displayed data only; erased at logout. | IHM-57, IHM-59, DSN-33 |
| nouvelle version | new version | — | New version available | Banner; reload waits for drafts to be saved. | IHM-03 |
| guide de démarrage | getting-started guide | `onboardingGuideState` | Getting started | Self-checking steps; can be hidden and reopened from Help. | IHM-53 |
| premier lancement | first launch | — | — | Home presents Egoscope in two sentences and the guide. | IHM-53 |
| états vides | empty states | — | — | What a screen says when it has nothing to show. | IHM-54–IHM-56 |
| affichage honnête (des chiffres) | honest display | — | — | Case counts always shown, both directions treated alike, nothing hidden, no showcase. | IHM-45–IHM-52 |
| mention courte | short notice | — | (section 7) | Notice on profile and validation screens, linking to "Method and limits". | IHM-50 |
| accessibilité, lisibilité | accessibility, readability | — | — | WCAG level AA. | IHM-60–IHM-63 |
| feuille de partage (du téléphone) | share sheet | — | — | The phone's system sharing panel. | BKT-20, IHM-39 |
| presse-papiers | clipboard | — | — | — | BKT-20 |

Merged into other rows: « Joueurs suivis » (into Players); « Sources de presse » (into Collection and detection); « données gardées sur l'appareil » (into cached screens).

Decisions:

- Route segments are proposals that follow the conventions; the interface module may refine them, keeping kebab-case and the English terms above.
- "To do" names two things: the request status `to_do` and the to-do list. Code keeps them apart: `BacktestRequestStatus` `to_do` versus `TodoList` / `TodoItem`.

### 3.14 Sensitive data

| French | English | Code | UI label | Meaning | IDs |
| --- | --- | --- | --- | --- | --- |
| donnée sensible | sensitive data | `sensitive_data` | Sensitive data | Also the only reason to decline an accepted event in an import preview. | DSN-18, IMP-37 |
| sujet intime | intimate subject | `isIntimateSubject` | Intimate subject | Bereavement, racism suffered and the like; strict wording rules; never named in Telegram. | DSN-12–DSN-17, TAX-01 |
| détail intime | intimate detail | — | — | What no description, message or field may contain. | D-20, DSN-12 |
| événement sensible | sensitive event | — | sensitive event | How Telegram designates an event of an intimate-subject type. | DSN-35, TEL-06 |
| stockage minimal | minimal storage | — | — | Event fields limited to the DSN-06 whitelist. | D-20, DSN-06 |
| presse publique, presse sportive, archives d'actualités | public press, sports press, news archives | — | — | The only admissible origins of a source. | DSN-01, D-10 |
| source admissible | admissible source | — | — | Public, dated press or news-archive article; a social post only through an article. | DSN-01, DSN-03 |
| usage strictement personnel | strictly personal use | — | — | No sharing or third-party export of the data. | DSN-30 |
| partage, export pour un tiers | third-party sharing | — | — | Forbidden, except the activity-journal export for a helper. | DSN-30, TRV-49 |
| deuil | bereavement | — | — | Intimate subject: say only that a loved one died. | DSN-12 |
| proche | loved one | `loved_one` | a loved one | Family member or person the press presents as close; also a role. | DSN-12, BKT prompt 2.6 |
| défunt, obsèques, lien de parenté, cause du décès | the deceased, funeral, family relationship, cause of death | — | — | Never stated. | DSN-12, DSN-18 |
| propos, actes racistes subis | racist remarks or acts suffered | — | — | Intimate subject: never the terms used, nor the player's origin. | DSN-13 |
| vie privée, famille et vie privée, vie sentimentale | private life, family, love life | — | — | Never stored. | DSN-14, DSN-18 |
| santé, diagnostic, santé mentale, nature d'une blessure | health, diagnosis, mental health, nature of an injury | — | — | Never stored; return from injury is yes, no or unknown only. | DSN-15, DSN-07 |
| affaire judiciaire, procédure, accusation, mise en cause publique, faits reprochés, parties | legal matter, proceeding, accusation, public implication, alleged facts, parties | — | — | Say only that the player is publicly implicated. | DSN-16 |
| personne privée, personnalité publique, plaignant, auteur anonyme | private person, public figure, complainant, anonymous author | — | — | Private persons are never named; others are designated by role. | DSN-17, DSN-18 |
| rôle (désignation par le rôle) | role | `PersonRole` | — | opponent, teammate, coach, executive, spectator, loved one. | DSN-17, BKT prompt 2.6 |
| règles de formulation | wording rules | — | — | One factual neutral sentence, no quotation, no judgment, no interpretation, no forecast. | DSN-19–DSN-23 |
| longueur maximale d'une description | maximum description length | `maxDescriptionLength` | — | 200 characters; applied by detection, prompt and import. | DSN-20 |
| citation textuelle, guillemets | verbatim quotation, quotation marks | — | — | Forbidden; descriptions with quotation marks are refused. | DSN-21, IMP-13 |
| jugement de valeur | value judgment | — | — | Forbidden ("shameful", "magnificent"). | DSN-22 |
| interprétation psychologique | psychological interpretation | — | — | Forbidden ("his pride was hurt"). | DSN-22 |
| pronostic (sur le match) | forecast about the game | — | — | Forbidden in descriptions. | DSN-22 |
| récit | narrative | — | — | Context indications are never a narrative. | DSN-07 |
| textes libres | free-text fields | — | — | Description, unverified note, justification, decision comment, declared limitations: all under the wording rules. | DSN-10 |
| retrait (d'un événement) | event withdrawal | `withdrawEvent()` | Withdraw | Permanent erasure for sensitivity, at any time, from the event page, after confirmation. | DSN-26–DSN-29 |
| effacement définitif | permanent erasure | — | — | What a withdrawal does. | DSN-26, DSN-27 |
| limites du retrait | withdrawal limits | — | — | Telegram messages not deletable, backups, exports, offline devices, re-collection, re-import. | DSN-28 |
| compteur global des événements retirés | withdrawn-events counter | `withdrawnEventCount` | Withdrawn events | Only trace of a withdrawal; no player, type or date. | DSN-29 |
| empreinte (de retrait) | withdrawal fingerprint | `WithdrawalFingerprint` | — | Keyed hash of player, type and date, kept eight weeks, so detection cannot recreate the event (decision Q-DSN-01). | Q-DSN-01 |
| données gardées sur l'appareil | device-kept data | `DeviceCache` | — | Only what screens show; erased at logout; a withdrawal reaches it at next refresh. | DSN-33 |
| RGPD | GDPR | — | — | European data-protection regulation; would apply in full outside personal use. | 13 limits |

Merged into other rows: « presse sportive », « archives d'actualités » (into public press); « effacement définitif » kept as the definition of event withdrawal.

Decisions:

- « sujet intime » is "intimate subject", paired with "intimate detail"; "sensitive" stays for « donnée sensible » and « événement sensible ».
- « proche » is "loved one", which covers family and friends as the French does; "relative" would narrow it to family.

### 3.15 Operations

| French | English | Code | UI label | Meaning | IDs |
| --- | --- | --- | --- | --- | --- |
| gratuité totale | zero cost | — | — | No paid tier, no payment card, anywhere. | TRV-01, D-07 bis |
| offre gratuite, palier gratuit | free tier | — | Free tier | Permanent free offer of a service. | TRV-01, TRV-11 |
| essai gratuit limité dans le temps | time-limited free trial | — | — | Never acceptable. | TRV-11 |
| moyen de paiement | payment method | — | — | Never registered. | TRV-02 |
| quota, limite | quota, limit | `QuotaLimit` | Quota | Per minute, day, month or volume, from the verified terms. | TRV-03 |
| consommation | usage | `QuotaUsage` | Usage | The app counts its own usage per limit and period. | TRV-04 |
| remise à zéro | reset | `resetAt` | Resets at {time} | When a quota period renews. | TRV-46 |
| avertissement de quota | quota warning | `quota_warning` | Quota warning | At 80 % of a limit. | TRV-05, H-TRV-02 |
| limite atteinte | limit reached | `quota_reached` | Quota reached | Operations deferred, never lost; an early refusal counts as reached. | TRV-05, TRV-06 |
| avertissement de volume | database volume warning | `database_volume_warning` | Database volume warning | At 80 % of the free capacity; core data never deleted. | TRV-07, H-TRV-03 |
| fiche de service | service sheet | — | — | Role, free tier, limits, terms date and address, behavior at the limit, replacement. | TRV-09, TRV-10 |
| rôle (d'un service) | service role | `ServiceRole` | — | hosting, database, stats source, language model, news feeds, notifications, trigger service, backup storage. | TRV-09 |
| conception technique | technical design | — | — | Engineering documents that fix what the specs leave open. | TRV-25 |
| hébergement, hébergeur | hosting, host | — | — | The free hosting service. | TRV-13 |
| mise en sommeil, réveil | sleep, wake-up | — | — | Free hosts' idle behavior. | TRV-13 |
| base relationnelle hébergée, base relationnelle hébergée à palier gratuit | hosted relational database | — | — | Free-tier hosted database. | D-23, TRV-14 |
| service de déclenchement, secret de déclenchement | trigger service, trigger secret | — | — | External scheduler calling the app, protected by a secret. | TRV-65 |
| tâche planifiée, tâche | scheduled task, task | `ScheduledTask`; key `taskKey` | Task | Recurring work with a plain-language name, an owner document, a time or a predecessor (section 9). | TRV-25, TRV-26 |
| calendrier d'ensemble (des tâches) | task schedule | — | — | The default times of all tasks. | TRV-25 |
| passage | pass | `TaskPass` | Pass | One run of a task plus everything chained to it; groups messages. | TRV-26, TEL-19 |
| exécution | run | `TaskRun` | Run | One execution of a task, with start, end and result. | TRV-26, TRV-28 |
| exécution planifiée, à la demande | scheduled run, on-demand run | `TaskRunTrigger` | Scheduled; On demand | A manual run is marked on demand and keeps the next scheduled one. | TRV-33 |
| report (d'une exécution) | postponement | `postponed` | Postponed | A run waits for the previous one to finish; journaled. | TRV-28 |
| exécution interrompue, reprise | interrupted run, resumption | `interrupted` | Interrupted | Resumes where it stopped at the next run. | TRV-30 |
| portion | chunk | — | — | Long work is cut into chunks that fit the host's limits. | TRV-30 |
| exécution manquée | missed run | `missed` | Missed | Last success older than its interval plus a margin; opens an incident and runs at once. | TRV-31 |
| contrôle des exécutions | run check | task `run_check` | — | Detects missed runs at the end of each pass and at each app opening. | TRV-25, TRV-31 |
| changement d'heure, heure d'hiver | clock change, winter time | — | — | One execution on a day when a time is missing or doubled. | TRV-27 |
| réglage, réglages, écran de réglages | setting, settings, settings screen | — | Settings | Anything the owner adjusts in the app. | TRV-34, IHM-37 |
| paramètre | parameter | `Parameter`; key `parameterKey` | — | Registry entry: name, purpose, unit, current and default value, allowed values, owner, origin. | TRV-34 |
| registre des paramètres | parameter registry | `parameterRegistry` | — | Every parameter by owning document (section 9). | TRV-38 |
| valeur par défaut, « Rétablir la valeur par défaut » | default value, restore default | `defaultValue` | Restore default | — | TRV-34, TRV-35 |
| valeurs admises | allowed values | `allowedValues` | Allowed values | Out-of-range input is refused with an explanation. | TRV-35 |
| origine (d'un paramètre) | parameter origin | `ParameterOrigin` | Origin | journal decision, journal hypothesis, local hypothesis to confirm. | TRV-34 |
| date du dernier changement de paramètre | last parameter change | `lastCalculationParameterChangeAt` | Last parameter change | Of a parameter that affects calculations; shown with profiles and the validation table. | TRV-35, SEN-37, SUI-25 |
| configuration de déploiement | deployment configuration | — | — | Service addresses, keys, bot token, initial password, trigger secret; never in the app. | TRV-37, TRV-64 |
| valeurs secrètes | secrets | — | — | Never displayed, journaled or exported. | TRV-64 |
| journal d'activité, journal | activity journal | `JournalEntry` | Activity journal | Every pass, recalculation, failure, incident, data-changing action, parameter change, refused login, message. | TRV-41 |
| entrée (du journal) | journal entry | `JournalEntry` | Entry | With a category, a level and a plain-language message. | TRV-41–TRV-43 |
| catégorie (d'une entrée) | entry category | `JournalEntryCategory` | Category | Section 4. | TRV-41 |
| niveau | level | `JournalLevel` | Level | info, warning or incident. | TRV-43 |
| désignation d'un événement | event reference | `playerEventRef` | — | Player, type and reference date: the only way an entry names an event; erased on withdrawal. | TRV-41 |
| détails techniques, réponse brute, réponses brutes des services | technical details, raw response | `technicalDetails` | Technical details | Stored apart, hidden by default, no secret and no event text. | TRV-44, DSN-11 |
| incident | incident | `Incident` | Incident | A function no longer does its job; opened once per cause, closed when it disappears or by the owner. | TRV-45 |
| incident ouvert, clos, clore | open, closed, close | `IncidentStatus` | Open; Closed | — | TRV-45 |
| écran d'état | status screen | route `/status` | App status | See section 3.13. | TRV-46, IHM-70 |
| état (d'un service) | service status | `ServiceStatus` | — | normal, degraded or unavailable. | TRV-46 |
| éléments en attente | pending items | — | Pending | Classification queue, requests to do. | TRV-46 |
| vérification de l'installation | installation check | `InstallationCheck`; `runInstallationCheck()` | Check installation | Per service: success, or failure with probable cause and steps. | TRV-47 |
| durée de conservation (des journaux) | journal retention | `journalRetentionDays` | — | 90 days; open incidents kept until closed. | TRV-48, H-TRV-08 |
| export du journal | journal export | — | Export journal | Text file of a period for a helper. | TRV-49 |
| sauvegarde, renouvellement (des sauvegardes) | backup, backup renewal | `Backup` | Backup | Full, automatic, weekly, encrypted, kept outside the database; 8 kept, the oldest replaced (renewal). | TRV-50, Q-TRV-01 |
| espace de sauvegarde | backup storage | — | — | Private storage receiving the encrypted backups. | TRV-50, TRV-75 |
| sauvegarde en échec | backup failed | `backup_failed` | Backup failed | Incident. | TRV-50 |
| export complet, exports partiels, tableur, format ouvert et documenté | full export, partial exports, spreadsheet, open documented format | `exportAll()` | Export | Full export in an open documented format; spreadsheet exports of players, events, cases, profiles. | TRV-52 |
| rappel d'export | export reminder | `export_reminder` | Export reminder | After 30 days without an export. | TRV-54 |
| restauration, bilan (de restauration), cohérence des données | restore, restore summary, data consistency | — | Restore | Into an empty database; then a consistency check and counts. | TRV-53 |
| mise à jour (de l'application), structure des données, retour à la version précédente | app update, data structure, rollback | — | — | A structure change triggers a backup, then the app's own migration. | TRV-55, TRV-76, TRV-77 |
| environnement d'essai | test environment | — | — | Not required: the app has one environment, the owner's. | TRV-78 |
| compte unique, inscription | single account, sign-up | — | — | No sign-up exists. | TRV-57, H-10 |
| mot de passe initial, mot de passe définitif | initial password, chosen password | — | — | Initial from the configuration, then replaced at first login. | TRV-57, TRV-63 |
| empreinte non lisible (du mot de passe initial) | initial-password fingerprint | — | — | Non-readable hash kept to detect a reset. | TRV-63 |
| réinitialisation du mot de passe | password reset | — | — | Through the deployment configuration, no email. | TRV-63 |
| blocage (de la connexion), « connexions refusées » | lockout, logins refused | `logins_refused` | Logins refused | Security incident after repeated failures; closed at the next successful login. | TRV-61 |
| durée de session sans utilisation | idle session duration | `sessionIdleDays` | — | 30 days. | TRV-62 |
| connexion chiffrée | encrypted connection | — | — | HTTPS only. | TRV-59, IHM-10 |
| moteurs de recherche, référencer | search engines, index | — | — | The app asks search engines not to index it; nothing is public. | TRV-58 |
| ordres de grandeur | orders of magnitude | — | — | Estimated daily volumes used for sizing, then measured. | TRV-08, H-TRV-04 |
| instant absolu | absolute instant | — | — | Moment independent of time zones; epoch milliseconds in code. | TRV-68, STA-29 |
| fuseau d'origine | original time zone | — | — | Kept when it helps understanding. | TRV-68 |
| heure locale (du match) | local time | — | — | Venue time of a game. | TRV-71 |
| jour d'une tâche, jour d'un match | task day, game day | — | — | A task's day is in the owner's zone; a game's day is its US date. | TRV-72 |
| guide de déploiement, d'utilisation, d'exploitation | deployment guide, user guide, operations guide | — | — | Delivered documentation. | TRV-74, TRV-75, TRV-79 |
| aide-mémoire de dépannage, notes de version | troubleshooting sheet, release notes | — | — | Delivered documentation. | TRV-79 |
| état de réalisation des exigences | requirement status | `RequirementStatus` | — | done, partial or not done, per requirement ID. | TRV-79 |
| agent de développement | development agent | — | — | AI agent writing the code. | D-23, D-28 |
| langage unique | single language | — | — | JavaScript or TypeScript for server, interface and tasks. | TRV-20, D-28 |

Merged into other rows: « tâche » (into scheduled task); « journal » alone (into activity journal when it means the app's journal); « limite » (into quota).

Decisions:

- « passage » is "pass" and « exécution » is "run": a pass is a run plus the work chained to it (TRV-26).
- « tâche planifiée » is "scheduled task" everywhere, in code too (`ScheduledTask`); "job" is not a synonym.
- « réglage » is "setting" and « paramètre » is "parameter": settings are what the owner adjusts; parameters are registry entries.

### 3.16 Project, documentation and general words

| French | English | Code | UI label | Meaning | IDs |
| --- | --- | --- | --- | --- | --- |
| journal des décisions | decision journal | — | — | `docs/90-journal-des-decisions.md`; authoritative over the specs. | 90 |
| décision (D-xx) | decision | — | — | Explicit choice of the owner. | 90 |
| hypothèse de rédaction (H-xx), hypothèse locale (H-XXX-nn) | drafting hypothesis, local hypothesis | — | — | Assumption made while writing, "to be confirmed". | 90, each spec |
| question ouverte (Q-xx) | open question | — | — | Point left open; defaults apply unless the owner decided. | 90 |
| « à confirmer » | to be confirmed | — | — | Mark of every hypothesis. | 90 |
| Points à trancher avant de développer | points to settle before development | — | — | The twelve README points, all settled on 2026-11-11. | README |
| cadrage, cycle | scoping, cycle | — | — | The interview cycles of the decision journal. | 90 |
| lot, Lot 1, Lot 2, application minimale | lot, Lot 1, Lot 2, minimal application | `lot` | — | Delivery slice: the minimal app, then the watch and the real-world test. | H-12, 00 |
| lot initial | initial batch | — | — | A first batch of backtests for all players; rejected by D-36, unrelated to Lot 1. | D-36 |
| idée d'origine | original idea | — | — | Betting-oriented starting point, refocused by D-08. | 00, 90 |
| validation par l'historique | validation by history | — | — | The hypothesis is checked against past events and real statistics (backtest). | D-01 |
| ligne d'un bookmaker, ligne de bookmaker | bookmaker line | — | — | Out of scope and banned wording (section 8). | D-07, VUE-02 |
| population choisie | selected population | — | — | Followed players are chosen for talent and exposure; trends describe them, not all NBA players. | 00 caution notes |
| profils nombreux | many profiles | — | — | With many player-type pairs, some verdicts appear by chance alone. | 00 caution notes, Q-VUE-01 |
| détecteur de sensibilité par joueur | per-player sensitivity detector | — | — | What Egoscope is first (D-08). | 00, 90 |
| score d'impact | impact score | — | — | Figure with sources the app outputs instead of raw alerts (D-05). | D-05 |
| alertes brutes | raw alerts | — | — | What the app does not output. | D-05 |
| hypothèse conditionnelle | conditional hypothesis | — | — | Some players may react to some public events; to be tested, not assumed. | 00, VUE-09 |
| limites connues | known limits | — | Known limits | The five limits shown on "Method and limits". | 00, VUE-09 |
| garde-fous | safeguards | — | — | Rules that keep the test honest, listed in 00. | 00 |
| égo, égo sensible | ego, sensitive ego | — | — | What the events may touch; never measured. | 00, TAX-04 |
| contre-performance | underperformance | — | — | A game below the player's norm. | 90 |
| exemples marquants, doublés, 4-0 historique en série | striking examples, braces, historic 4-0 series | — | — | Motivating examples of the journal (braces: two goals, football). | D-32 |
| parcours de bout en bout | end-to-end journey | — | — | Steps 1 to 10 from adding a player to the validation table. | 00 |
| exigence | requirement | — | — | Numbered rule `XXX-nn` with its lot. | every spec |
| critères d'acceptation | acceptance criteria | — | — | `CA-XXX-nn` (positional IDs where the spec gives none). | decisions |
| cas limites et erreurs | edge cases and errors | — | — | Spec section. | every spec |
| données manipulées | data handled | — | — | Spec section listing stored data. | every spec |
| mention | notice | — | — | Text shown on an object (the « partielle » mention is the partial notice); not a mark. | STA-24, ALE-17, IHM-50 |
| motif, raison | reason | `reason` | Reason | Why something happened; « motif » for closed lists, « raison » for free text. | many |
| état, statut | status | `status` | Status | Lifecycle position of an object. | many |
| origine, provenance | origin | `origin` | Origin | Where something comes from. | many |
| catégorie | category | — | Category | Case category, notification category or journal-entry category, by context. | SUI-22, TEL-24, TRV-41 |
| nature | kind | `kind` | Kind | Request kind, manual-decision kind, caveat kind, incident kind. | BKT-01, SEN-17 |
| seuil | threshold | — | Threshold | — | many |
| fenêtre | window | — | — | Correction, grouping, title-dedup window. | STA-33, DET-29, COL-30 |
| conservation | retention | — | — | — | COL-34, TRV-48 |
| effacer, effacement | erase, erasure | — | — | Removal with no trace (withdrawal cascade, requalification); the import screen's « Effacer » button is labeled "Clear". | DSN-27, TAX-25, IHM-28 |
| supprimer, suppression | delete, deletion | — | Delete | Removal that keeps a trace (historical event, purge, player data). | IMP-33, COL-34, JOU-24 |
| rattacher | attach | — | Attach | Link one object to another (article to event, event to game, result to request). | DET-27, SEN-03, IMP-07 |
| historique | history | — | History | Dated list of past changes (status, verdict, alert, correction). | many |
| journal | journal | — | Journal | Every « journal » is a journal: activity, collection, detection, update, stats correction, decision. | TRV-41, COL-48, DET-55, ALE-31, STA-33, 90 |
| trace | trace | — | — | Minimal record kept after an action (import, dedup, deletion). | IMP-31, COL-34, IMP-33 |
| IA | AI | — | AI | — | many |
| Egoscope | Egoscope | — | Egoscope | Product name, never translated. | IHM-02 |

Decisions:

- « état » and « statut » are synonyms in the specs: both are "status". « motif » and « raison » are both "reason". « origine » and « provenance » are both "origin".
- Every « journal » keeps the word "journal" (pre-decided), so "log" is not used for any of them.

## 4. Enumerations

Every set is a string-literal union in code and a text column in the database. Values are listed in the order the specs give them. A UI label in braces (`{date}`) is filled at display time. "VUE-08" marks the common states whose labels the specs require on every screen.

### 4.1 Sets by domain

#### Players

`PlayerStatus` — JOU-15, VUE-08

| French | Code value | UI label |
| --- | --- | --- |
| actif | `active` | Active |
| en pause | `paused` | Paused |
| retiré | `withdrawn` | Withdrawn |

`PlayerStatusChangeReason` — JOU-15, H-JOU-06 (optional on every status change)

| French | Code value | UI label |
| --- | --- | --- |
| absence prolongée | `prolonged_absence` | Prolonged absence |
| fin de carrière | `end_of_career` | End of career |
| départ de la NBA | `left_nba` | Left the NBA |
| exposition insuffisante | `insufficient_exposure` | Insufficient exposure |
| autre | `other` | Other |

`PauseSuggestionStatus` — JOU-22

| French | Code value | UI label |
| --- | --- | --- |
| suggestion de pause (affichée) | `suggested` | Suggest pausing {player} |
| suggestion refusée | `declined` | — |

`TeamChangeOrigin` — JOU-13

| French | Code value | UI label |
| --- | --- | --- |
| constaté | `observed` | Observed |
| saisi | `entered` | Entered |

`NameVariantKind` — JOU-08

| French | Code value | UI label |
| --- | --- | --- |
| variante d'écriture | `spelling` | Spelling variant |
| surnom | `nickname` | Nickname |

`StatsSourceMappingStatus` — JOU-10, STA-03

| French | Code value | UI label |
| --- | --- | --- |
| correspondance à établir | `to_establish` | Mapping to establish |
| correspondance confirmée | `established` | Mapping established |

`PlayerBacktestStatus` — JOU-25, IHM-21 (derived, shown on the player page and list)

| French | Code value | UI label |
| --- | --- | --- |
| aucun, jamais demandé | `never_requested` | Never requested |
| demande à faire | `request_to_do` | Request to do |
| importé le … | `imported` | Imported on {date} |
| demande complémentaire à faire | `supplementary_request_to_do` | Supplementary request to do |

#### Event types

`EventTypeStatus` — TAX-10, VUE-08

| French | Code value | UI label |
| --- | --- | --- |
| proposé | `proposed` | Proposed |
| validé | `validated` | Validated |
| rejeté | `rejected` | Rejected |
| retiré | `withdrawn` | Withdrawn |

`EventTypeOrigin` — TAX-15

| French | Code value | UI label |
| --- | --- | --- |
| cadrage | `scoping` | Scoping |
| exploration | `exploration` | Exploration |
| détection | `detection` | Detection |

`TypeRejectionReason` — TAX-13, H-TAX-04

| French | Code value | UI label |
| --- | --- | --- |
| non net | `not_clean` | Not clean |
| non datable | `not_datable` | Not datable |
| doublon d'un type existant | `duplicate_of_existing_type` | Duplicate of an existing type |
| hors périmètre | `out_of_scope` | Out of scope |
| autre | `other` | Other |

`TypeWithdrawalReasonKind` — TAX-27, TAX-29, TAX-31 (the reason itself is free text)

| French | Code value | UI label |
| --- | --- | --- |
| motif saisi | `entered` | (the owner's text) |
| fusionné dans | `merged_into` | Merged into {type} |
| scindé en | `split_into` | Split into {types} |

`DocumentationDifficulty` — TAX-01, TAX-08

| French | Code value | UI label |
| --- | --- | --- |
| facile | `easy` | Easy |
| moyenne | `medium` | Medium |
| difficile | `hard` | Hard |

`SheetChangeQualification` — TAX-22

| French | Code value | UI label |
| --- | --- | --- |
| de forme | `formal` | Formal change |
| de fond | `substantive` | Substantive change |

`SubstantiveChangeScope` — TAX-22

| French | Code value | UI label |
| --- | --- | --- |
| élargit | `broadens` | Broadens the type |
| restreint | `narrows` | Narrows the type |
| les deux | `both` | Both |

`RequalificationChoice` — TAX-25

| French | Code value | UI label |
| --- | --- | --- |
| conforme à la nouvelle version | `conforms` | Conforms to the new version |
| réaffecté à un autre type validé | `reassigned` | Reassigned to another validated type |
| non conforme | `non_conforming` | Does not conform |

`EventTypeLinkMark` — TAX-25, TAX-29

| French | Code value | UI label |
| --- | --- | --- |
| à requalifier | `to_requalify` | To requalify |
| à répartir | `to_distribute` | To distribute |

`ExplorationMode` — TAX-16

| French | Code value | UI label |
| --- | --- | --- |
| général | `general` | General |
| ciblé | `targeted` | Targeted |

#### Events

`EventOrigin` — DSN-06

| French | Code value | UI label |
| --- | --- | --- |
| détecté | `detected` | Detected |
| historique | `historical` | Historical |

`DetectedEventStatus` — DET-43, DET-45, VUE-08

| French | Code value | UI label |
| --- | --- | --- |
| détecté | `detected` | Detected |
| écarté | `dismissed` | Dismissed |

`DismissalReason` — DET-43

| French | Code value | UI label |
| --- | --- | --- |
| pas un événement | `not_an_event` | Not an event |
| ne relève d'aucun type validé | `no_validated_type_fits` | Fits no validated type |
| fait ancien | `old_fact` | Old fact |
| information non publique ou invérifiable | `non_public_or_unverifiable` | Non-public or unverifiable information |
| doublon d'un événement historique | `duplicate_of_historical_event` | Duplicate of a historical event |
| autre (avec commentaire) | `other` | Other |

`DismissalTiming` — DET-46

| French | Code value | UI label |
| --- | --- | --- |
| avant le coup d'envoi du match mesuré | `before_tip_off` | Before tip-off |
| après le coup d'envoi | `after_tip_off` | After tip-off |

`EventMark` — DET-21, DET-32, DET-33, DET-58

| French | Code value | UI label |
| --- | --- | --- |
| datation à vérifier | `dating_to_verify` | Dating to verify |
| détecté après le coup d'envoi | `detected_after_tip_off` | Detected after tip-off |
| doublon possible d'un événement historique | `possible_historical_duplicate` | Possible duplicate of a historical event |
| description à revoir | `description_to_review` | Description to review |

`EventMarkStatus` — DET-32, DET-33, DET-58 (life of one mark)

| French | Code value | UI label |
| --- | --- | --- |
| marque posée | `set` | (the mark's label) |
| marque levée | `lifted` | — |
| marque confirmée (détecté après le coup d'envoi, une fois le match mesuré établi) | `upheld` | (the mark's label) |

`DatePrecision` — COL-20, DET-30, DSN-06

| French | Code value | UI label |
| --- | --- | --- |
| exacte | `exact` | Exact |
| approximative | `approximate` | Approximate |
| absente | `none` | No date |

`Precedence` — IMP-18, SEN-44

| French | Code value | UI label |
| --- | --- | --- |
| établie | `established` | Established |
| incertaine | `uncertain` | Uncertain |
| non établie | `not_established` | Not established |
| à vérifier | `to_verify` | To verify |

`InjuryReturn` — SEN-13, BKT format, DSN-07

| French | Code value | UI label |
| --- | --- | --- |
| oui | `yes` | Yes |
| non | `no` | No |
| inconnu | `unknown` | Unknown |

`GameStakes` — SEN-14, BKT format

| French | Code value | UI label |
| --- | --- | --- |
| fort | `high` | High |
| normal | `normal` | Normal |
| inconnu | `unknown` | Unknown |

`ResearchConfidence` — BKT prompt rule 2.8, IMP-15

| French | Code value | UI label |
| --- | --- | --- |
| haute | `high` | High |
| moyenne | `medium` | Medium |
| faible | `low` | Low |

`ContextIndicationOrigin` — SEN-18, H-09, ALE-08

| French | Code value | UI label |
| --- | --- | --- |
| recherche | `research` | Research |
| classification | `classification` | Classification |
| utilisateur | `user` | You |
| calcul | `calculation` | Calculated |

`HistoricalEventDeletionReason` — IMP-33

| French | Code value | UI label |
| --- | --- | --- |
| fait inexact ou source fausse | `inaccurate_fact_or_false_source` | Inaccurate fact or false source |
| hors des critères du type | `outside_type_criteria` | Outside the type's criteria |
| doublon | `duplicate` | Duplicate |
| autre (avec une précision courte) | `other` | Other |

`ReferenceInstantOrigin` — SEN-01, SEN-02, SEN-44, 08 Données manipulées

| French | Code value | UI label |
| --- | --- | --- |
| instant connu | `known_instant` | Known time |
| date seule | `date_only` | Date only |
| événement connu à l'avance | `known_in_advance` | Known in advance |
| report pour antériorité incertaine | `uncertain_precedence_shift` | Uncertain precedence |

#### Cases

`CaseOrigin` — SEN-21, IHM-46

| French | Code value | UI label |
| --- | --- | --- |
| historique | `historical` | Historical |
| suivi | `tracked` | Tracked |

`CaseStatus` — SEN-07, VUE-08

| French | Code value | UI label |
| --- | --- | --- |
| en attente du match | `awaiting_game` | Awaiting game |
| mesuré | `measured` | Measured |
| exclu (cas douteux) | `excluded` | Excluded (doubtful case) |
| non mesurable | `not_measurable` | Not measurable |

`CaseStatusReason` — SEN-07, SEN-04, SEN-44, SEN-45, SEN-47, STA-35, STA-45 (an excluded case carries its triggered criteria instead)

| French | Code value | UI label | For status |
| --- | --- | --- | --- |
| match pas encore joué | `game_not_played_yet` | Game not played yet | awaiting game |
| statistiques en attente | `statistics_pending` | Statistics pending | awaiting game |
| correspondance statistique non confirmée | `mapping_not_established` | Stats-source mapping not established | awaiting game |
| référence en constitution | `baseline_building` | Baseline being built | awaiting game |
| antériorité à vérifier | `precedence_to_verify` | Precedence to verify | awaiting game |
| datation à vérifier | `dating_to_verify` | Dating to verify | awaiting game |
| aucun match joué dans le délai | `no_game_within_window` | No game played within the window | not measurable |
| feuille incomplète (match consolidé) | `box_score_incomplete` | Box score incomplete | not measurable |
| feuille douteuse (match consolidé) | `box_score_suspect` | Box score suspect | not measurable |
| feuille indisponible | `box_score_unavailable` | Box score unavailable | not measurable |
| référence insuffisante | `insufficient_baseline` | Insufficient baseline | not measurable |
| saison non couverte par la source | `season_not_covered` | Season not covered by the source | not measurable |
| antériorité non établie | `precedence_not_established` | Precedence not established | not measurable |

`DoubtfulCaseCriterion` — SEN-11–SEN-17

| French | Code value | UI label |
| --- | --- | --- |
| temps de jeu trop faible | `playing_time_too_low` | Playing time too low |
| retour de blessure | `injury_return` | Return from injury |
| enjeu inhabituel | `unusual_stakes` | Unusual stakes |
| niveau de l'adversaire | `opponent_strength` | Opponent strength |
| concomitant (si le paramètre est activé) | `co_occurring` | Co-occurring |
| décision manuelle | `manual` | Excluded by you |

`CriterionCondition` — SEN-13, SEN-14

| French | Code value | UI label |
| --- | --- | --- |
| signalée | `flagged` | Flagged |
| calculée | `calculated` | Calculated |

`ReviewFlag` — SEN-16

| French | Code value | UI label |
| --- | --- | --- |
| premier match avec une nouvelle équipe | `first_game_with_new_team` | First game with a new team |
| expulsion pendant le match mesuré | `ejection` | Ejected during the game |

`ManualDecisionKind` — SEN-17

| French | Code value | UI label |
| --- | --- | --- |
| exclure | `exclude` | Exclude |
| réintégrer | `reinstate` | Reinstate |

`ManualExclusionReason` — SEN-17 (comment required for the last one)

| French | Code value | UI label |
| --- | --- | --- |
| temps de jeu | `playing_time` | Playing time |
| retour de blessure | `injury_return` | Return from injury |
| enjeu inhabituel | `unusual_stakes` | Unusual stakes |
| niveau de l'adversaire | `opponent_strength` | Opponent strength |
| autre facteur parasite | `other_confounding_factor` | Other confounding factor |

`ManualReinstatementReason` — SEN-17 (comment required for the last one)

| French | Code value | UI label |
| --- | --- | --- |
| indication de contexte erronée | `incorrect_context_indication` | Incorrect context indication |
| critère inadapté à ce cas | `criterion_unsuited_to_case` | Criterion unsuited to this case |

`TallyExitReason` — SEN-33 (a withdrawal never appears here)

| French | Code value | UI label |
| --- | --- | --- |
| écarté | `dismissed` | Dismissed |
| fusionné avec un autre événement détecté | `merged` | Merged with another event |
| supprimé à la main | `deleted` | Deleted |
| remplacé à l'import | `replaced_at_import` | Replaced at import |
| effacé lors d'une requalification ou d'une répartition | `erased` | Erased by requalification |

#### Backtest requests

`BacktestRequestStatus` — BKT-13, VUE-08

| French | Code value | UI label |
| --- | --- | --- |
| à faire | `to_do` | To do |
| importée | `imported` | Imported |
| annulée | `canceled` | Canceled |

`BacktestRequestKind` — BKT-01, BKT-08, BKT-09

| French | Code value | UI label |
| --- | --- | --- |
| initiale | `initial` | Initial request |
| complément | `supplement` | Supplementary request |
| reprise complète | `full_redo` | Full redo |

`BacktestRequestTrigger` — BKT-01, BKT-03–BKT-06, IHM-27

| French | Code value | UI label |
| --- | --- | --- |
| action manuelle | `manual_action` | Requested by you |
| détection | `detection` | Detection |
| validation d'un type | `type_validated` | Type validated |
| réactivation d'un type | `type_reactivated` | Type reactivated |
| élargissement d'un type | `type_broadened` | Type broadened |
| import incomplet | `incomplete_import` | Incomplete import |

`BacktestRequestOrigin` — BKT Données manipulées, TEL-09, IHM-27 (derived from trigger and kind)

| French | Code value | UI label |
| --- | --- | --- |
| née d'une détection | `from_detection` | From detection |
| manuelle | `manual` | Manual |
| complémentaire | `supplementary` | Supplementary |

`RequestCancellationReason` — BKT-14 (otherwise free text)

| French | Code value | UI label |
| --- | --- | --- |
| joueur retiré | `player_withdrawn` | Player withdrawn |

`MeasuredGameTiming` — BKT-18 (per attached detected event)

| French | Code value | UI label |
| --- | --- | --- |
| à venir | `upcoming` | Upcoming |
| joué | `played` | Played |

`PlayerCoverageSituation` — BKT-10, H-VUE-02

| French | Code value | UI label |
| --- | --- | --- |
| sans backtest, non profilé | `unprofiled` | No backtest yet |
| déjà traité, profilé | `profiled` | Profiled |

#### Import

`ImportMode` — IMP-22, IMP-28, IMP-29

| French | Code value | UI label |
| --- | --- | --- |
| premier import | `first_import` | First import |
| complément | `addition` | Add to existing |
| remplacement | `replacement` | Replace existing |

`ImportOutcome` — IMP-19

| French | Code value | UI label |
| --- | --- | --- |
| ajouté | `added` | Added |
| ajouté avec avertissement | `added_with_warning` | Added with warning |
| doublon, non ajouté | `duplicate_not_added` | Duplicate, not added |
| ignoré | `ignored` | Ignored |
| refusé | `refused` | Refused |
| non enregistré pour donnée sensible | `not_recorded_sensitive_data` | Not recorded: sensitive data |

`PossibleDuplicateAnswer` — IMP-25, IMP-26

| French | Code value | UI label |
| --- | --- | --- |
| même fait | `same_fact` | Same fact |
| faits distincts | `distinct_facts` | Distinct facts |
| événements distincts (doublon confirmé ajouté quand même) | `keep_as_distinct` | Distinct events |

`SpotCheckVerdict` — IMP-23

| French | Code value | UI label |
| --- | --- | --- |
| conforme | `consistent` | Consistent |
| non conforme | `inconsistent` | Inconsistent |
| inaccessible | `inaccessible` | Inaccessible |

`LinkStatus` — IMP-17 (no mark means the check found nothing wrong or did not run)

| French | Code value | UI label |
| --- | --- | --- |
| introuvable | `not_found` | Not found |

`ImportStep` — IMP-01–IMP-35, IHM-28–IHM-30

| French | Code value | UI label |
| --- | --- | --- |
| brouillon | `draft` | Draft |
| erreur bloquante | `blocking_error` | — |
| aperçu | `preview` | Preview |
| bilan | `summary` | Summary |

`ImportDraftStatus` — IHM-42, 12 edge cases

| French | Code value | UI label |
| --- | --- | --- |
| brouillon gardé | `kept` | Draft saved at {time} |
| demande déjà importée | `request_already_imported` | Request already imported |

#### Games and statistics

`GamePhase` — STA-04, STA-05

| French | Code value | UI label |
| --- | --- | --- |
| saison régulière | `regular_season` | Regular season |
| tournoi de qualification | `play_in` | Play-in |
| phases finales | `playoffs` | Playoffs |

`BaselinePhase` — STA-16, STA-18 (also the values of the STA-18 parameter)

| French | Code value | UI label |
| --- | --- | --- |
| saison régulière | `regular_season` | Regular season |
| tournoi de qualification et phases finales (référence de phases finales) | `postseason` | Postseason |

`GameStatus` — STA-05

| French | Code value | UI label |
| --- | --- | --- |
| prévu | `scheduled` | Scheduled |
| en cours | `in_progress` | In progress |
| terminé | `final` | Final |
| reporté | `postponed` | Postponed |
| annulé | `canceled` | Canceled |

`GameConsolidation` — STA-33

| French | Code value | UI label |
| --- | --- | --- |
| dans la fenêtre de correction | `in_correction_window` | — |
| consolidé | `consolidated` | Consolidated |

`BoxScoreStatus` — STA-09, STA-10, STA-35

| French | Code value | UI label |
| --- | --- | --- |
| complète | `complete` | Complete |
| incomplète | `incomplete` | Incomplete |
| douteuse | `suspect` | Suspect |
| indisponible | `unavailable` | Unavailable |

`GamePlayClassification` — STA-13, STA-14

| French | Code value | UI label |
| --- | --- | --- |
| non joué | `not_played` | Did not play |
| joué non exploitable | `played_not_usable` | Not usable |
| exploitable | `usable` | Usable |

`SeasonBaselineStatus` — STA-16, STA-19–STA-22 (plus the separate notice « partielle », `isPartial`, "Partial", STA-24)

| French | Code value | UI label |
| --- | --- | --- |
| définitive | `final` | Final |
| provisoire | `provisional` | Provisional |
| en constitution | `building` | Being built |
| insuffisante | `insufficient` | Insufficient |

`GapStatus` — SEN-09

| French | Code value | UI label |
| --- | --- | --- |
| provisoire | `provisional` | Provisional |
| définitif | `final` | Final |

`NoNextGameReason` — STA-26

| French | Code value | UI label |
| --- | --- | --- |
| intersaison | `offseason` | Offseason |
| équipe éliminée | `team_eliminated` | Team eliminated |
| joueur sans équipe | `player_without_team` | Player without a team |
| calendrier non publié | `schedule_not_published` | Schedule not published |

`GameVenue` — STA-26

| French | Code value | UI label |
| --- | --- | --- |
| à domicile | `home` | Home |
| à l'extérieur | `away` | Away |

`FetchWaitReason` — STA-36, STA-39

| French | Code value | UI label |
| --- | --- | --- |
| panne | `outage` | Source outage |
| quota | `quota` | Quota |

`StatCorrectionOrigin` — STA-33, STA-34

| French | Code value | UI label |
| --- | --- | --- |
| fenêtre de correction | `correction_window` | Correction window |
| relance manuelle | `manual_refetch` | Manual refetch |

`FetchPriority` — STA-40 (stored as the integers 1 to 5)

| French | Code value | UI label |
| --- | --- | --- |
| feuilles des matchs qui mesurent un cas suivi en attente | `1` | — |
| calendrier de la saison en cours et prochain match | `2` | — |
| résultats et feuilles de la journée écoulée, corrections | `3` | — |
| saisons des cas historiques en attente | `4` | — |
| reste de la carrière | `5` | — |

#### Sensitivity, verdicts and profiles

`ProfileView` — SEN-21

| French | Code value | UI label |
| --- | --- | --- |
| tous les cas | `all_cases` | All cases |
| cas historiques | `historical_only` | Historical cases only |
| cas suivis | `tracked_only` | Tracked cases only |

`VerdictLevel` — SEN-23, D-16, IHM-50

| French | Code value | UI label |
| --- | --- | --- |
| non concluant | `inconclusive` | Inconclusive |
| possible | `possible` | Possible |
| probable | `probable` | Probable |

`VerdictDirection` — SEN-24

| French | Code value | UI label |
| --- | --- | --- |
| hausse | `increase` | Increase |
| baisse | `decrease` | Decrease |

`ProfileConfidence` — SEN-25

| French | Code value | UI label |
| --- | --- | --- |
| faible | `low` | Low |
| moyen | `medium` | Medium |
| élevé | `high` | High |

`ConfidenceStepDownReason` — SEN-25, SEN-29 (the starting level comes from n and is not a reason)

| French | Code value | UI label |
| --- | --- | --- |
| dispersion des écarts au-dessus du seuil | `high_dispersion` | Cases disagree |
| part de cas douteux au-dessus du seuil | `high_doubtful_share` | Many doubtful cases |
| verdict fragile | `fragile_verdict` | Fragile verdict |
| un joueur apporte plus de la moitié des cas (tendance) | `dominant_player` | One player brings most cases |

`VerdictChangeCause` — SEN-37, SEN-48

| French | Code value | UI label |
| --- | --- | --- |
| nouveaux cas | `new_cases` | New cases |
| correction de statistiques | `stats_correction` | Statistics correction |
| référence mise à jour | `baseline_updated` | Baseline updated |
| décision manuelle | `manual_decision` | Manual decision |
| événement écarté | `event_dismissed` | Event dismissed |
| changement de paramètre | `parameter_change` | Parameter change |
| recalcul | `recalculation` | Recalculation |

`ProfileNotice` — SEN-19, SEN-31, SEN-36, IHM-23, 12 edge cases

| French | Code value | UI label |
| --- | --- | --- |
| non concluant pour ce joueur (sous le seuil) | `below_threshold` | Inconclusive for this player (k valid cases of the 5 needed) |
| archivé | `archived` | Archived |
| recalcul en cours | `recalculating` | Recalculation in progress |
| en attente de statistiques | `awaiting_statistics` | Awaiting statistics |

`CoverageWarningKind` — SEN-46 (shown with the earlier-version and remaining-refusal counts)

| French | Code value | UI label |
| --- | --- | --- |
| type non couvert par le backtest | `type_not_covered` | Type not covered by the backtest |
| profil incomplet | `incomplete_profile` | Incomplete profile |

#### Press collection

`ActivationStatus` — COL-09, COL-10, COL-40

| French | Code value | UI label |
| --- | --- | --- |
| active | `active` | Active |
| désactivée | `deactivated` | Deactivated |
| retirée | `withdrawn` | Withdrawn |

`HealthStatus` — COL-40–COL-43

| French | Code value | UI label |
| --- | --- | --- |
| jamais lue | `never_read` | Never read |
| fonctionnelle | `working` | Working |
| en panne | `down` | Down since {date} |
| muette | `silent` | Silent since {date} |

`ArticleProcessingStatus` — COL-35

| French | Code value | UI label |
| --- | --- | --- |
| à analyser | `to_analyze` | To analyze |
| en attente de classification | `awaiting_classification` | Awaiting classification |
| non pertinent | `not_relevant` | Not relevant |
| rattaché | `attached` | Attached |
| lié à une proposition | `linked_to_proposal` | Linked to a proposal |

`Language` — COL-05, COL-17 (ISO 639-1 codes)

| French | Code value | UI label |
| --- | --- | --- |
| anglais | `en` | English |
| français | `fr` | French |

`CollectionRunOrigin` — COL-48

| French | Code value | UI label |
| --- | --- | --- |
| planifiée | `scheduled` | Scheduled |
| à la demande | `on_demand` | On demand |
| avec rattrapage | `with_catch_up` | With catch-up |

`SourceReadOutcome` — COL-48

| French | Code value | UI label |
| --- | --- | --- |
| réussite | `success` | Succeeded |
| échec | `failure` | Failed |

#### Detection

`NotRelevantReason` — DET-06, DET-16, DET-20, DET-24, DET-34, DET-36, DET-58

| French | Code value | UI label |
| --- | --- | --- |
| aucun joueur suivi | `no_followed_player` | No followed player |
| aucun fait | `no_fact` | No fact |
| sous le seuil | `below_threshold` | Below threshold |
| fait ancien | `old_fact` | Old fact |
| déjà rapporté par un backtest | `already_reported_by_backtest` | Already reported by a backtest |
| type rejeté ou retiré | `type_rejected_or_withdrawn` | Type rejected or withdrawn |
| proposition rejetée | `proposal_rejected` | Proposal rejected |

`ClassificationOrigin` — DET-13, DET-49

| French | Code value | UI label |
| --- | --- | --- |
| modèle | `model` | Model |
| utilisateur | `user` | You |

`RoutingCase` — DET-37–DET-40, BKT-30 (every detected event is also tracked)

| French | Code value | UI label |
| --- | --- | --- |
| joueur non profilé : besoin de backtest | `backtest_need` | — |
| joueur profilé, type couvert : fiche d'alerte | `alert_sheet` | — |
| joueur profilé, type non couvert : fiche « type non couvert » et besoin de complément | `alert_sheet_type_not_covered` | — |

#### Alert sheets

`AlertSheetStatus` — ALE-26

| French | Code value | UI label |
| --- | --- | --- |
| ouverte | `open` | Open |
| close | `closed` | Closed |
| annulée | `canceled` | Canceled |

`AlertSheetTiming` — ALE-06, ALE-24 (the late mark is added to any status)

| French | Code value | UI label |
| --- | --- | --- |
| produite avant le coup d'envoi | `produced_before_tip_off` | Produced before tip-off |
| tardive | `late` | Late |

`AlertSheetCancellationReason` — ALE-22, ALE-31

| French | Code value | UI label |
| --- | --- | --- |
| tous ses événements écartés | `all_events_dismissed` | All events dismissed |
| rattachement corrigé | `attachment_corrected` | Attachment corrected |

`CaveatKind` — ALE-16

| French | Code value | UI label |
| --- | --- | --- |
| petit échantillon | `small_sample` | Small sample |
| sens de l'effet (toujours présente) | `effect_direction` | Direction of the effect |
| contexte connu avant le match | `known_context` | Known context |
| plusieurs événements | `several_events` | Several events |
| confiance de détection proche du seuil | `confidence_near_threshold` | Detection confidence near the threshold |
| datation à vérifier | `dating_to_verify` | Dating to verify |
| profil incomplet ou version antérieure | `incomplete_or_earlier_version` | Incomplete profile or earlier sheet version |
| fiche tardive | `late_sheet` | Late sheet |
| type non couvert | `type_not_covered` | Type not covered |

`ProfileStatusNotice` — ALE-05, ALE edge cases

| French | Code value | UI label |
| --- | --- | --- |
| profil en cours de calcul | `profile_being_computed` | Profile being computed |
| recalcul en cours | `recalculation_in_progress` | Recalculation in progress |
| aucun cas mesuré pour ce type à ce jour | `no_measured_case_yet` | No measured case for this type yet |

`SubjectStatusNotice` — ALE edge cases

| French | Code value | UI label |
| --- | --- | --- |
| joueur en pause | `player_paused` | Player paused |
| joueur retiré | `player_withdrawn` | Player withdrawn |
| type retiré | `type_withdrawn` | Type withdrawn |

`ExpectedGameState` — ALE-15, ALE-23

| French | Code value | UI label |
| --- | --- | --- |
| match attendu | `current` | Expected game |
| ancien match attendu (barré, avec motif) | `superseded` | (struck through) |
| match attendu inconnu | `unknown` | Expected game unknown |

`ProfileSnapshotState` — ALE-05, ALE-19

| French | Code value | UI label |
| --- | --- | --- |
| profil en cours de calcul | `pending` | Profile being computed |
| valeurs figées | `frozen` | — |

#### Automatic tracking and validation

`RecordingTiming` — SUI-06

| French | Code value | UI label |
| --- | --- | --- |
| enregistré à temps | `recorded_in_time` | Recorded in time |
| enregistré après le coup d'envoi | `recorded_after_tip_off` | Recorded after tip-off |

`ForecastState` — SUI-08–SUI-10 (before tip-off the forecast is a list of timestamped versions that follow the historical profile)

| French | Code value | UI label |
| --- | --- | --- |
| pronostic figé | `frozen` | Frozen forecast |
| pronostic tardif | `late` | Late forecast |
| sans pronostic | `none` | No forecast |

`ForecastSource` — SUI-08, SUI-09

| French | Code value | UI label |
| --- | --- | --- |
| profil du joueur | `player_profile` | Player profile |
| tendance générale | `general_trend` | General trend |
| aucune | `none` | None |

`CaseCategory` — SUI-22 (valid tracked cases only)

| French | Code value | UI label |
| --- | --- | --- |
| confirmé | `confirmed` | Confirmed |
| démenti | `refuted` | Refuted |
| neutre | `neutral` | Neutral |
| sans pronostic | `no_forecast` | No forecast |

`RowAssessment` — SUI-26, SUI-27 (absent under the minimum: "too few tracked cases")

| French | Code value | UI label |
| --- | --- | --- |
| confirmé | `confirmed` | Confirmed |
| confirmé, effet plus faible qu'annoncé | `confirmed_weaker_than_announced` | Confirmed, weaker effect than announced |
| démenti | `refuted` | Refuted |
| indécis | `undecided` | Undecided |

`ValidationRowScope` — SUI-23, SUI-28

| French | Code value | UI label |
| --- | --- | --- |
| type | `type` | Type |
| joueur | `player` | Player |
| couple joueur-type | `player_type_pair` | Player and type |
| ensemble | `overall` | Overall |
| sous-ligne de l'ensemble | `overall_subrow` | — |

`OverallSubrowKind` — SUI-28

| French | Code value | UI label |
| --- | --- | --- |
| profil probable | `probable_profile` | Probable profile |
| profil possible | `possible_profile` | Possible profile |
| tendance générale | `general_trend` | General trend |

`PostTipOffDecisionKind` — SUI-17

| French | Code value | UI label |
| --- | --- | --- |
| écartement de l'événement | `event_dismissed` | Event dismissed |
| réintégration de l'événement | `event_reinstated` | Event reinstated |
| exclusion manuelle du cas | `case_excluded` | Case excluded |
| réintégration manuelle du cas | `case_reinstated` | Case reinstated |
| correction d'une indication de contexte | `context_corrected` | Context corrected |
| correction de la date de référence | `reference_date_corrected` | Reference date corrected |
| correction du joueur | `player_corrected` | Player corrected |
| correction du type | `type_corrected` | Type corrected |
| levée de la marque « datation à vérifier » | `dating_mark_lifted` | Dating mark lifted |

`PostTipOffDecisionEffect` — SUI-17

| French | Code value | UI label |
| --- | --- | --- |
| sortie (des comptes) | `exit` | Left the counts |
| entrée (dans les comptes) | `entry` | Entered the counts |
| changement de match mesuré | `measured_game_change` | Measured game changed |

#### Notifications

`TelegramLinkStatus` — TEL-28–TEL-32, TEL-37

| French | Code value | UI label |
| --- | --- | --- |
| non reliée | `not_linked` | Not linked |
| en attente de confirmation | `awaiting_confirmation` | Awaiting confirmation |
| reliée | `linked` | Linked since {date} |
| rompue | `broken` | Broken |

`NotificationMessageStatus` — TEL-33

| French | Code value | UI label |
| --- | --- | --- |
| à envoyer | `to_send` | To send |
| différé | `deferred` | Deferred |
| envoyé | `sent` | Sent |
| regroupé | `grouped` | Grouped |
| abandonné | `discarded` | Discarded |
| en échec | `failed` | Failed |

`NotificationCategory` — TEL-24 (service messages have none)

| French | Code value | UI label |
| --- | --- | --- |
| demandes de backtest (rappels compris) | `backtest_requests` | Backtest requests |
| alertes (mises à jour comprises) | `alerts` | Alerts |
| résultats suivis | `tracked_results` | Tracked results |
| propositions de type | `type_proposals` | Type proposals |
| incidents | `incidents` | Incidents |

`NotificationSubOption` — TEL-24

| French | Code value | UI label |
| --- | --- | --- |
| rappel avant échéance | `deadline_reminder` | Reminder before the deadline |
| alertes au verdict « non concluant » | `inconclusive_alerts` | Alerts with an inconclusive verdict |
| fin d'incident | `incident_end` | Incident resolved |

`NotificationKind` — TEL-09–TEL-16, TEL-36

| French | Code value | UI label |
| --- | --- | --- |
| demande de backtest à faire | `backtest_request_to_do` | Backtest to do |
| échéance modifiée | `deadline_changed` | Deadline changed |
| rappel avant échéance | `deadline_reminder` | Reminder |
| alerte pour un joueur profilé | `alert` | Alert |
| mise à jour d'une alerte | `alert_update` | Update |
| résultat d'un match suivi | `tracked_game_result` | Tracked game result |
| proposition de nouveau type à valider | `new_type_proposal` | New type proposed |
| incident (début) | `incident_start` | Incident |
| rappel d'incident | `incident_reminder` | Incident reminder |
| fin d'incident | `incident_end` | Incident resolved |
| rappel d'export | `export_reminder` | Export reminder |
| confirmation de mise en relation | `link_confirmation` | — |
| message d'essai | `test_message` | — |
| message groupé d'un passage | `pass_digest` | — |
| message groupé de fin de plage de silence | `quiet_hours_digest` | During quiet hours |
| message de rattrapage | `catch_up` | — |
| plafond atteint | `daily_cap_reached` | Daily cap reached |
| avis à une conversation qui n'est plus reliée | `chat_unlinked_notice` | — |

`SendFailureKind` — TEL-35, TEL-37

| French | Code value | UI label |
| --- | --- | --- |
| échec temporaire | `temporary` | — |
| échec définitif | `permanent` | — |

#### Interface and access

`NavigationEntry` — IHM-16

| French | Code value | UI label |
| --- | --- | --- |
| Accueil | `home` | Home |
| Joueurs | `players` | Players |
| Alertes (lot 2) | `alerts` | Alerts |
| Types | `types` | Types |
| Plus | `more` | More |

`MoreMenuEntry` — IHM-16

| French | Code value | UI label |
| --- | --- | --- |
| Demandes de backtest | `backtest_requests` | Backtest requests |
| Réglages | `settings` | Settings |
| État de l'application | `app_status` | App status |
| Journal d'activité | `activity_journal` | Activity journal |
| Méthode et limites | `method_and_limits` | Method and limits |
| Aide | `help` | Help |
| Événements détectés (lot 2) | `detected_events` | Detected events |
| Tableau de validation (lot 2) | `validation_table` | Validation table |
| Collecte et détection (lot 2) | `collection_and_detection` | Collection and detection |

`SettingsSection` — IHM-37

| French | Code value | UI label |
| --- | --- | --- |
| Compte | `account` | Account |
| Affichage | `display` | Display |
| Paramètres | `parameters` | Parameters |
| Notifications (lot 2) | `notifications` | Notifications |
| Aide | `help` | Help |

`TodoSection` — IHM-20, in this order

| French | Code value | UI label |
| --- | --- | --- |
| demandes de backtest « à faire » | `requests_to_do` | Backtest requests to do |
| demandes complémentaires proposées | `proposed_supplements` | Proposed supplementary requests |
| incidents en cours | `incidents` | Incidents |
| joueurs | `players` | Players |
| types d'événements « proposés » | `proposed_types` | Proposed types |
| événements et cas à examiner | `events_and_cases_to_review` | Events and cases to review |

`ConnectivityMode` — IHM-57, IHM-58

| French | Code value | UI label |
| --- | --- | --- |
| en ligne | `online` | — |
| hors connexion | `offline` | Offline |

`SessionEndReason` — IHM-08, TRV-60, TRV-62, TRV-63

| French | Code value | UI label |
| --- | --- | --- |
| expiration | `expired` | Session expired |
| déconnexion | `logged_out` | Logged out |
| changement de mot de passe | `password_changed` | Password changed |
| réinitialisation | `reset` | Password reset |

#### Sensitive data

`CalculationExitWay` — DSN-26 (the four ways an event or case leaves the calculations)

| French | Code value | UI label |
| --- | --- | --- |
| écarter | `dismiss` | Dismiss |
| supprimer | `delete` | Delete |
| exclure | `exclude` | Exclude |
| retirer | `withdraw` | Withdraw |

`PersonRole` — DSN-17, BKT prompt rule 2.6

| French | Code value | UI label |
| --- | --- | --- |
| un adversaire | `opponent` | an opponent |
| un coéquipier | `teammate` | a teammate |
| un entraîneur | `coach` | a coach |
| un dirigeant | `executive` | an executive |
| un spectateur | `spectator` | a spectator |
| un proche | `loved_one` | a loved one |

#### Operations

`JournalLevel` — TRV-43

| French | Code value | UI label |
| --- | --- | --- |
| information | `info` | Info |
| avertissement | `warning` | Warning |
| incident | `incident` | Incident |

`JournalEntryCategory` — TRV-41, TEL-34

| French | Code value | UI label |
| --- | --- | --- |
| passage de tâche | `task_pass` | Task |
| recalcul des profils | `profile_recalculation` | Recalculation |
| échec d'un service externe | `service_failure` | Service failure |
| incident | `incident` | Incident |
| action de l'utilisateur | `user_action` | Your action |
| import refusé en entier | `import_refused` | Import refused |
| changement de paramètre | `parameter_change` | Parameter change |
| connexion refusée | `login_refused` | Login refused |
| blocage | `login_lockout` | Login locked |
| message Telegram | `telegram_message` | Telegram message |

`IncidentStatus` — TRV-45

| French | Code value | UI label |
| --- | --- | --- |
| ouvert | `open` | Open |
| clos | `closed` | Closed |

`ServiceStatus` — TRV-46

| French | Code value | UI label |
| --- | --- | --- |
| normal | `normal` | Normal |
| dégradé | `degraded` | Degraded |
| indisponible | `unavailable` | Unavailable |

`ServiceRole` — TRV-01, TRV-09

| French | Code value | UI label |
| --- | --- | --- |
| hébergement | `hosting` | Hosting |
| base de données | `database` | Database |
| source de statistiques | `stats_source` | Stats source |
| modèle de langage | `language_model` | Language model |
| flux d'actualités | `news_feeds` | News feeds |
| notifications | `notifications` | Notifications |
| service de déclenchement | `trigger_service` | Task trigger |
| espace de sauvegarde | `backup_storage` | Backup storage |

`QuotaLimitKind` — TRV-03

| French | Code value | UI label |
| --- | --- | --- |
| par minute | `per_minute` | per minute |
| par jour | `per_day` | per day |
| par mois | `per_month` | per month |
| en volume | `volume` | volume |

`QuotaStatus` — TRV-04–TRV-06

| French | Code value | UI label |
| --- | --- | --- |
| normal | `normal` | — |
| avertissement (80 %) | `warning` | Quota warning |
| limite atteinte | `reached` | Quota reached |

`VolumeStatus` — TRV-07

| French | Code value | UI label |
| --- | --- | --- |
| normal | `normal` | — |
| avertissement de volume (80 %) | `warning` | Database volume warning |

`AccountPasswordStatus` — TRV-57, TRV-63, IHM-06

| French | Code value | UI label |
| --- | --- | --- |
| mot de passe initial | `initial` | Choose your password |
| mot de passe choisi | `chosen` | — |

`TaskRunTrigger` — TRV-33

| French | Code value | UI label |
| --- | --- | --- |
| planifiée | `scheduled` | Scheduled |
| à la demande | `on_demand` | On demand |

`TaskRunStatus` — TRV-26, TRV-28, TRV-30, TRV-31

| French | Code value | UI label |
| --- | --- | --- |
| report | `postponed` | Postponed |
| en cours | `running` | Running |
| réussite | `succeeded` | Succeeded |
| échec | `failed` | Failed |
| exécution interrompue | `interrupted` | Interrupted |
| exécution manquée | `missed` | Missed |

`ParameterOrigin` — TRV-34

| French | Code value | UI label |
| --- | --- | --- |
| décision du journal | `journal_decision` | Decision |
| hypothèse du journal | `journal_hypothesis` | Hypothesis |
| hypothèse locale à confirmer | `local_hypothesis` | Local hypothesis, to be confirmed |

`BackupStatus` — TRV-50

| French | Code value | UI label |
| --- | --- | --- |
| faite | `done` | Done |
| en échec | `failed` | Failed |

`InstallationCheckResult` — TRV-47

| French | Code value | UI label |
| --- | --- | --- |
| réussite | `success` | OK |
| échec (avec cause probable et marche à suivre) | `failure` | Failed |

`RequirementStatus` — TRV-79

| French | Code value | UI label |
| --- | --- | --- |
| réalisée | `done` | Done |
| partielle | `partial` | Partial |
| non réalisée | `not_done` | Not done |

### 4.2 Near-synonyms that must stay distinct

**Ways out of the calculations and other endings.** The first four are the four ways of DSN-26; the others look alike in English and are not the same.

| French | English | Applies to | Reversible | What remains | IDs |
| --- | --- | --- | --- | --- | --- |
| écarté | dismissed | detected event wrongly detected | yes (reinstate) | everything; the case keeps its status and gap, outside all calculations | DET-43–DET-46, SEN-48 |
| exclu | excluded | case (doubtful) | yes (reinstate) | everything; the gap is still computed for the control | SEN-11, SEN-17 |
| supprimé | deleted | historical event (error), article (purge), player data | no | a deletion trace or a dedup trace; for player data, the counter | IMP-33, COL-34, JOU-24 |
| retiré (événement) | withdrawn (event withdrawal) | any event, for sensitivity | no | only the withdrawn-events counter (and, for 8 weeks, the keyed fingerprint) | DSN-26–DSN-29, Q-DSN-01 |
| retiré (joueur, type, source) | withdrawn (status) | player, event type, press source | player and type: yes (reactivate); source: no | everything; profiles archived | JOU-19, TAX-31, COL-10 |
| effacé | erased | event judged non-conforming or left out of a split; articles of a withdrawn event | no | a count on the type sheet (requalification) or nothing (withdrawal) | TAX-25, TAX-29, COL-37 |
| désactivé | deactivated | press source | yes | everything; the period is never caught up | COL-09 |
| archivé | archived | profiles and trend of a withdrawn player or type | yes (reactivation) | everything, still recalculated | SEN-19 |
| annulé | canceled | backtest request, alert sheet, game | request: no (may still be imported); sheet: yes on reinstatement | everything | BKT-13, ALE-26, STA-05 |
| rejeté | rejected | type proposal | yes (reopen) | the proposal, its reason, its occurrences | TAX-13, TAX-14 |
| refusé | refused | event of a research result; whole result; login; Telegram code | — | nothing of the content beyond position, type, date and reason | IMP-19, IMP-31, TRV-61, TEL-31 |
| ignoré | ignored | research-result event outside the request's scope | — | position, type, date and reason | IMP-19 |
| abandonné | discarded | Telegram message become moot; import preview or draft | — | the fact in the app | TEL-23, IMP-03 |
| masqué | hidden | incident on Home | yes | the incident, still open and journaled | IHM-20 |
| clos | closed | incident; alert sheet (« close ») | incident: no; sheet: no | everything | TRV-45, ALE-26 |

How to tell the two « retiré » apart: an event has no "withdrawn" status. "Withdraw" applied to an event always means erasing it; applied to a player, a type or a source it is a status change that erases nothing. Code never stores `withdrawn` on an event; `withdrawEvent()` lives in the sensitive-data module and the UI button of the withdrawal screen reads "Withdraw and erase".

**One French word, several things.**

| French | English terms | How to tell them apart | IDs |
| --- | --- | --- | --- |
| suivi | followed (player); tracked (case); tracking (automatic, game); tracking parameters (ad links) | "followed" qualifies a player only; "tracked" qualifies a case; "automatic tracking" is the Lot 2 function; "ad-tracking parameters" are cleaned from links. | VUE-04, SUI-01, COL-28 |
| confirmé, démenti | confirmed, refuted (case category); confirmed, refuted (row assessment) | Same words in two sets: `CaseCategory` judges one tracked case (threshold 0.25); `RowAssessment` judges a row of at least 10 cases with the expected noise. Never applied to a verdict, a profile or an effect elsewhere (IHM-50). A stats-source mapping is "established", never "confirmed". | SUI-22, SUI-27, IHM-50 |
| phase | game phase (3 values); baseline phase (2 values); phase over | `GamePhase`: regular season, play-in, playoffs. `BaselinePhase`: regular season, postseason (play-in and playoffs pooled, STA-18). "Phase over" is per player for the postseason (eliminated or Finals played). A lot is never a phase. | STA-05, STA-16, STA-18, STA-20 |
| confiance | detection confidence; research confidence; profile confidence | Detection: integer 0–100 per fact, not a probability. Research: high, medium, low per historical event (« haute »). Profile: low, medium, high per profile or trend (« élevé »). Three fields, three labels, never just "confidence". | DET-25, IMP-15, SEN-25 |
| bilan | assessment (validation row); import summary; win-loss record (team); restore summary | By object: a row, an import, a team, a restore. | SUI-27, IMP-35, STA-06, TRV-53 |
| issue | outcome (alert sheet); import outcome (per event) | The sheet's closing result versus one of six import results. | ALE-27, IMP-19 |
| réserve | caveat (alert sheet); unverified note (research result); quota reserve (stats source) | By object. | ALE-16, BKT format, STA-39 |
| fiche | type sheet; alert sheet; service sheet; player page; event page; stats-source record | "Sheet" for documents with their own content; "page" for the screen of one object. | TAX-01, ALE-06, TRV-09, IHM-22, IHM-67 |
| correspondance | stats-source mapping; correspondence (between two events) | A player and his stats record, versus two events judged the same fact. | JOU-10, IMP-25 |
| complément | supplementary request (request kind `supplement`); addition (import mode `addition`) | A request that fills coverage gaps, versus an import that adds without deleting. | BKT-09, IMP-28 |
| rang | rank (request in the to-do list); position (event in a result) | — | BKT-17, IMP-20 |
| reprise | full redo (request kind); resumption (queue, run); reactivation (player); recurrence (incident); retry (message) | « reprise complète » is the only request kind; the rest are operations words. | BKT-09, DET-10, TRV-30, JOU-18, TEL-15, TEL-35 |
| report, reporté, différé | postponement (task run); postponed (game); uncertain-precedence shift (case); deferred (message) | Four objects, four words. | TRV-28, STA-05, SEN-44, TEL-20 |
| indice | performance index; corroborating clue | A number from the box score, versus a hint that disambiguates a name. | STA-12, DET-04 |
| exploitable | usable (game); malformed (model response) | "Usable" is reserved for games. | STA-14, DET-22 |
| antériorité | precedence (historical event); timing hint (« indication d'antériorité », classifier output) | Precedence compares sources with tip-off; the timing hint says a fact predates its article. | IMP-18, DET-16 |
| doublon | duplicate article (dedup); possible duplicate type (exploration); possible duplicate (import); possible duplicate of a historical event (detection mark); duplicate (deletion and dismissal reasons) | Always qualify the object. | COL-30, TAX-17, IMP-25, DET-58, IMP-33 |
| à faire | to do (request status); to-do list; to-do item | `to_do` is a status value; `TodoList` and `TodoItem` are the screen and its entries. | BKT-13, IHM-20 |
| rattachement, rattacher | attachment (article to event); attachment (event to measured game); attachment (result to request, occurrence to proposal) | Same everyday meaning; compounds name the object: "attachment window" is the measured-game one, "attachment corrected" is the player-or-type one. | DET-27, SEN-04, ALE-31 |
| fusion, fusionner | type merge; event merge | Same operation on two objects; types merge into a surviving type, detected events into one event. | TAX-27, DET-47 |
| journal | activity journal; collection journal; detection journal; update journal (alert sheet); stats correction journal; decision journal | Always qualified, except "the journal" for the activity journal in UI copy. | TRV-41, COL-48, DET-55, ALE-31, STA-33, 90 |
| source | event source; press source; stats source; forecast source | Always qualified. | DSN-08, COL-02, STA-01, SUI-09 |
| sensible | sensitive data; sensitive event | Data never stored versus the Telegram word for an intimate-subject event; the type mark is "intimate subject". | DSN-18, DSN-35, TAX-01 |
| détecté | detected (event origin); detected (detected-event status) | An event of origin detected may have status dismissed. | DSN-06, DET-43 |
| tardif, tardive | late forecast; late sheet | Same meaning, after tip-off, on two objects. | SUI-10, ALE-24 |
| exécution, passage | run; pass | A pass is a run plus everything chained to it. | TRV-26 |
| réglage, paramètre, configuration de déploiement | setting; parameter; deployment configuration | A setting is anything adjustable in the app; a parameter is a registry entry; the deployment configuration lives outside the app. | TRV-34, TRV-37 |
| incident, avertissement | incident; warning | An incident means a function no longer works; a warning needs attention but loses nothing. | TRV-43 |
| liaison, lien | Telegram link; link (URL) | The pairing with a chat versus an address. | TEL-28, DSN-08 |
| écart | normalized gap; mean gap; control mean gap; announced gap; gap in forecast direction; coverage gap (« manque ») | Always qualified; « trou de collecte » is a "collection gap". | SEN-08, SEN-20, SEN-27, SUI-22, IMP-10, COL-46 |

**Dates and instants.** « date de référence » (reference date, stored, with precision) ≠ « instant de référence » (reference instant, derived for the measured-game search) ≠ « date publique » (public date: a historical event's reference date as reported) ≠ « date de publication » (publication date of a source) ≠ « instant de publication retenu » (retained publication instant of an article) ≠ « instant de première collecte » (first-collection instant) ≠ « instant de création » (creation instant of a tracked case) ≠ « instant prévu de début » (scheduled start of a game) ≠ « coup d'envoi » (tip-off, the actual start; SEN-03 and SUI-06 compare with the scheduled start).

**Games around an event.** « prochain match » (next game: next scheduled game of the current team, whoever plays) ≠ « match attendu » (expected game: first team game after the reference instant, shown before it is played) ≠ « match mesuré » (measured game: first game the player actually plays, established afterwards).

**Profiled.** « joueur profilé » (at least one imported result, even empty) is not "has a profile": a profiled player can have no valid case, and a profile exists as soon as one event of a validated type concerns the player (SEN-19).

## 5. The nine candidate event types

Seeded at first start-up as proposals of origin `scoping` with their starter sheets (TAX-15, annex of `docs/02-taxonomie-des-evenements.md`). The English identifier is the immutable slug: it replaces the French slug everywhere, prompts, JSON and examples included, and is never reused (TAX-02). The owner may rename a type before validating; the slug never changes.

| French identifier | English identifier | English name | French name | Known in advance | Intimate subject | Documentation difficulty |
| --- | --- | --- | --- | --- | --- | --- |
| `humiliation-publique` | `public-humiliation` | Public humiliation | Humiliation publique | no | no | medium |
| `racisme-subi` | `racist-abuse` | Racist abuse | Racisme subi | no | yes | medium |
| `anniversaire` | `birthday` | Player's birthday | Anniversaire du joueur | yes | no | easy |
| `approche-record` | `record-approach` | Approaching a positive historic record | Approche d'un record historique positif | no | no | easy |
| `record-negatif` | `negative-record` | Negative record to avoid | Record négatif à éviter | no | no | easy |
| `deces-proche` | `bereavement` | Death of a loved one | Mort d'un proche | no | yes | medium |
| `conflit-joueurs` | `player-conflict` | Conflict between players | Conflit entre joueurs | no | no | easy |
| `tourmente-mediatique` | `media-storm` | Media storm | Tourmente médiatique | no | no | hard |
| `ancienne-equipe` | `former-team` | Game against a former team | Match contre l'ancienne équipe | yes | no | easy |

Decisions:

- `racist-abuse` / "Racist abuse": the usual English for racist remarks, gestures or messages aimed at a player; "racism suffered" is not idiomatic.
- `bereavement`: short and discreet for an intimate subject, while the display name keeps the spec's wording, "Death of a loved one".
- `birthday` and `former-team` are created by the app from the schedule (owner's decision on Q-TAX-01), not found in the press; they leave the research prompt and the backtest coverage. Their slugs exist all the same, because the sheets exist.
- `record-approach` follows the French slug's structure; the name says "historic" rather than "all-time" because a franchise record or a career milestone qualifies.

## 6. Exchange formats

English keys and English allowed values, format version `1.0` (orchestrator ruling: no French-format data ever existed, so the import reads only these keys). Keys are fixed here; shapes, types and validation belong to the domain model and to 05 and 06. Unchanged from the specs: dates are `YYYY-MM-DD`, or `YYYY-MM-DDTHH:MM±HH:MM` when the time is known; enumerated values are lowercase; an optional field without content is omitted; `null` is never used; free texts follow the wording rules of 13 and the maximum description length, and are written in English (titles stay as published).

### 6.1 Research result (`docs/05`, `docs/06`)

| French key | English key | Notes |
| --- | --- | --- |
| `format` | `format` | Fixed value `egoscope-backtest` (unchanged). |
| `version_format` | `format_version` | `1.0`. |
| `reference_demande` | `request_reference` | Copied from the prompt, e.g. `REQ-2026-0007`. |
| `joueur` | `player` | Object. |
| `joueur.identifiant` | `player.id` | Copied from the prompt. |
| `joueur.nom` | `player.name` | Copied from the prompt. |
| `types_couverts` | `covered_types` | Event-type slugs actually researched. |
| `periode_couverte` | `covered_period` | Object. |
| `periode_couverte.debut` | `covered_period.start` | Date without time. |
| `periode_couverte.fin` | `covered_period.end` | Date without time. |
| `evenements` | `events` | Sorted by ascending public date, all types mixed. |
| `evenements[].type_evenement` | `events[].event_type` | Slug of a covered type. |
| `evenements[].date_publique` | `events[].public_date` | The event's reference date. |
| `evenements[].description` | `events[].description` | One factual sentence. |
| `evenements[].sources` | `events[].sources` | 1 to N, oldest first. |
| `evenements[].sources[].lien` | `events[].sources[].url` | Full article address, `https://` or `http://`. |
| `evenements[].sources[].media` | `events[].sources[].outlet` | Outlet name. |
| `evenements[].sources[].titre` | `events[].sources[].title` | Title as published, original language. |
| `evenements[].sources[].date_publication` | `events[].sources[].publication_date` | Same formats as `public_date`. |
| `evenements[].contexte` | `events[].context` | First NBA game after the event. |
| `evenements[].contexte.retour_de_blessure` | `events[].context.injury_return` | `yes`, `no`, `unknown`. |
| `evenements[].contexte.enjeu_du_match` | `events[].context.game_stakes` | `high`, `normal`, `unknown`. |
| `evenements[].contexte.precision` | `events[].context.detail` | Optional; shown in the preview, never stored. |
| `evenements[].confiance` | `events[].confidence` | Research confidence: `high`, `medium`, `low`. |
| `evenements[].non_verifie` | `events[].unverified_note` | Optional. |
| `pistes_non_verifiees` | `unverified_leads` | List, possibly empty. |
| `pistes_non_verifiees[].type_evenement` | `unverified_leads[].event_type` | Optional. |
| `pistes_non_verifiees[].periode_approximative` | `unverified_leads[].approximate_period` | Optional, e.g. "2020-21 season". |
| `pistes_non_verifiees[].description` | `unverified_leads[].description` | Same discretion rules. |
| `pistes_non_verifiees[].raison` | `unverified_leads[].reason` | Why it could not be substantiated. |
| `limites` | `limitations` | List of free texts, possibly empty. |

| French value | English value | Key |
| --- | --- | --- |
| oui | `yes` | `injury_return` |
| non | `no` | `injury_return` |
| inconnu | `unknown` | `injury_return`, `game_stakes` |
| fort | `high` | `game_stakes` |
| normal | `normal` | `game_stakes` |
| haute | `high` | `confidence` |
| moyenne | `medium` | `confidence` |
| faible | `low` | `confidence` |
| `egoscope-backtest` | `egoscope-backtest` | `format` |
| `1.0` | `1.0` | `format_version` |
| `DEM-2026-0007` (exemple) | `REQ-2026-0007` | `request_reference` |
| `joueur-0007` (exemple) | `player-0007` | `player.id` |
| `Joueur A` (exemple) | `Player A` | `player.name` |

Prompt placeholders (BKT-22; « Parties variables du prompt »):

| French placeholder | English placeholder |
| --- | --- |
| `{{REFERENCE}}` | `{{REFERENCE}}` |
| `{{DATE_DU_JOUR}}` | `{{TODAY}}` |
| `{{NOM_JOUEUR}}` | `{{PLAYER_NAME}}` |
| `{{IDENTIFIANT_JOUEUR}}` | `{{PLAYER_ID}}` |
| `{{REPERE_JOUEUR}}` | `{{PLAYER_MARKER}}` |
| `{{PERIODE}}` | `{{PERIOD}}` |
| `{{DEBUT_BLOC_TYPE}}`, `{{FIN_BLOC_TYPE}}` | `{{TYPE_BLOCK_START}}`, `{{TYPE_BLOCK_END}}` |
| `{{TYPE_IDENTIFIANT}}` | `{{TYPE_ID}}` |
| `{{TYPE_NOM}}` | `{{TYPE_NAME}}` |
| `{{TYPE_PERIODE}}` | `{{TYPE_PERIOD}}` |
| `{{TYPE_DEFINITION}}` | `{{TYPE_DEFINITION}}` |
| `{{TYPE_INCLUSION}}` | `{{TYPE_INCLUSION}}` |
| `{{TYPE_EXCLUSION}}` | `{{TYPE_EXCLUSION}}` |
| `{{TYPE_DATATION}}` | `{{TYPE_DATING_RULE}}` |
| `{{TYPE_EXEMPLE}}` | `{{TYPE_EXAMPLE}}` |
| `{{LISTE_TYPES}}` | `{{TYPE_LIST}}` |
| `{{TEXTE_MAX}}` | `{{MAX_TEXT_LENGTH}}` |
| `{{SOURCES_MAX}}` | `{{MAX_SOURCES}}` |
| `{{VERSION_FORMAT}}` | `{{FORMAT_VERSION}}` |

Section titles of the reference prompt (BKT-21): « MISSION » → "MISSION"; « RÈGLES IMPÉRATIVES » → "MANDATORY RULES"; « TYPES D'ÉVÉNEMENTS À RECHERCHER » → "EVENT TYPES TO RESEARCH"; « FORMAT DE LA RÉPONSE » → "ANSWER FORMAT"; « SI TU NE TROUVES RIEN » → "IF YOU FIND NOTHING"; « AVANT DE RÉPONDRE, VÉRIFIE » → "BEFORE ANSWERING, CHECK". The rule names 2.1 to 2.11: Exhaustiveness, No statistics, Sources, Nothing invented, Public date, Discretion, Context, Confidence, One fact, one event, Out of scope, Length.

### 6.2 Exploration response (`docs/02`, TAX-16, TAX-17)

The spec describes the elements in plain language only; these keys are their names. The return follows the general rules of 6.1.

| French element | English key | Notes |
| --- | --- | --- |
| nom du format | `format` | Fixed value `egoscope-exploration` (unchanged); any other value is refused by the exploration screen, and this one by the import. |
| version du format | `format_version` | `1.0`. |
| liste des types proposés | `proposed_types` | List. |
| nom | `proposed_types[].name` | — |
| définition | `proposed_types[].definition` | — |
| critères d'inclusion | `proposed_types[].inclusion_criteria` | — |
| critères d'exclusion | `proposed_types[].exclusion_criteria` | — |
| règle de datation | `proposed_types[].dating_rule` | — |
| indication « connu à l'avance » | `proposed_types[].known_in_advance` | Part of the dating rule (TAX-01). |
| exemple générique sans personne réelle | `proposed_types[].generic_example` | — |
| difficulté de documentation | `proposed_types[].documentation_difficulty` | `easy`, `medium`, `hard` (French: facile, moyenne, difficile). |
| recouvrements possibles avec les types existants | `proposed_types[].possible_overlaps` | — |
| sources d'illustration publiques et datées | `proposed_types[].illustration_sources` | List. |
| lien, média, titre, date de publication | `illustration_sources[].url`, `.outlet`, `.title`, `.publication_date` | Same keys as a research-result source. |

The exploration prompt itself (TAX-16) has no fixed placeholders in the specs; it sends validated types (name, definition) and the do-not-repropose list (name, definition, rejection reason).

## 7. Fixed sentences and labels

Wording the specs quote and require as written. The English is the approved text: use it verbatim, with the placeholders filled. "k", "n", "N", "…", "{date}" and the player and team letters are filled at run time. Example texts of the specs (fictitious messages, sample descriptions) are not listed unless a rule fixes their wording.

### 7.1 Notices and disclaimers

| French | English | IDs |
| --- | --- | --- |
| Mesure du passé, pas un pronostic. | A measure of the past, not a forecast. | TEL-05, TEL-11 |
| Cette fiche décrit des matchs passés. Elle ne prédit pas le prochain match et ne constitue pas une recommandation de pari. | This sheet describes past games. It does not predict the next game and is not a betting recommendation. | ALE-17 |
| Mesure du passé, hypothèse non démontrée, aucune recommandation de pari | A measure of the past, an unproven hypothesis, no betting recommendation | IHM-50 |
| Méthode et limites | Method and limits | VUE-09, IHM-69 |
| connue après le coup d'envoi : cette fiche n'a pas pu être lue avant le match | known after tip-off: this sheet could not be read before the game | ALE-24 |
| les cas passés ne permettent pas de dire que le joueur A réagit à ce type d'événement | past cases do not show that player A reacts to this type of event | ALE-13 |
| par le passé, après ce type d'événement, le joueur A a joué en moyenne en dessous de sa moyenne de saison | in the past, after this type of event, player A played on average below his season average | ALE-10 |
| le joueur a tendance à jouer moins bien après ce type d'événement | the player has tended to play worse after this type of event | ALE-16 |
| un effet inverse reste possible et serait compté au même titre | an opposite effect remains possible and would count the same way | ALE-16 |
| l'effet, s'il existe, peut aller dans les deux sens | the effect, if any, can go either way | ALE-16 |

### 7.2 Labels and mentions on profiles, cases and sheets

| French | English | IDs |
| --- | --- | --- |
| non concluant pour ce joueur (k cas valides sur 5 nécessaires) | inconclusive for this player (k valid cases of the 5 needed) | SEN-31, ALE-12, TEL-11 |
| tendance générale du type, ne décrit pas ce joueur | general trend of the type, does not describe this player | SEN-31, ALE-12 |
| type non couvert par le backtest | type not covered by the backtest | SEN-46, TAX-20, ALE-14 |
| profil incomplet | incomplete profile | SEN-46 |
| verdict dépendant des exclusions manuelles | verdict depends on manual exclusions | SEN-27 |
| archivé, archivés | archived | SEN-19 |
| fragile | fragile | SEN-26 |
| concomitant | co-occurring | SEN-06 |
| antériorité incertaine | uncertain precedence | SEN-44 |
| antériorité non établie | precedence not established | SEN-44 |
| antériorité à vérifier | precedence to verify | SEN-44 |
| aucun match joué dans le délai | no game played within the window | SEN-04 |
| statistiques en attente | statistics pending | STA-36, STA-41 |
| saison non couverte par la source | season not covered by the source | STA-45 |
| 5 cas sur 7 au-dessus de zéro | 5 of 7 cases above zero | SEN-39 |
| tous les cas sont exclus pour enjeu inhabituel | all cases are excluded for unusual stakes | 08 edge cases |
| possible, à la hausse / possible, à la baisse | possible, increase / possible, decrease | 08 example, 10 example |
| cas historiques seuls | historical cases only | SUI-08, SEN-21 |
| 7 cas valides : 5 historiques, 2 suivis | 7 valid cases: 5 historical, 2 tracked | IHM-46 |
| 3 profils “probable” sur 41 | 3 "probable" profiles of 41 | IHM-49 |
| en attente de statistiques | awaiting statistics | 12 edge cases |
| recalcul en cours | recalculation in progress | SEN-36, ALE edge cases |
| profil en cours de calcul | profile being computed | ALE-05 |
| profil modifié depuis l'émission | profile changed since issue | ALE-19 |
| aucun cas mesuré pour ce type à ce jour | no measured case for this type yet | ALE edge cases |
| match attendu inconnu | expected game unknown | ALE-15, ALE-23 |
| produite avant le coup d'envoi | produced before tip-off | ALE-06 |
| tardive | late | ALE-24 |
| indicatif, indicative | indicative | ALE-12, STA-23 |
| plusieurs événements | several events | ALE-20 |
| rattachement corrigé | attachment corrected | ALE-31 |
| événement écarté (rubrique) | dismissed event | ALE-22 |
| enregistré à temps | recorded in time | SUI-06 |
| enregistré après le coup d'envoi | recorded after tip-off | SUI-06 |
| enregistré après le coup d'envoi, ne compte pas comme test | recorded after tip-off, does not count as a test | SUI-19, TEL-13 |
| pronostic figé / pronostic tardif / sans pronostic / tardif | frozen forecast / late forecast / no forecast / late | SUI-09, SUI-10 |
| confirmé / confirmé, effet plus faible qu'annoncé / démenti / indécis | confirmed / confirmed, weaker effect than announced / refuted / undecided | SUI-27 |
| trop peu de cas suivis pour conclure (k sur 10) | too few tracked cases to conclude (k of 10) | SUI-26 |
| datation à vérifier | dating to verify | DET-32 |
| détecté après le coup d'envoi | detected after tip-off | DET-33 |
| doublon possible d'un événement historique | possible duplicate of a historical event | DET-58 |
| description à revoir | description to review | DET-21 |
| texte non conservé | text not kept | DET-21 |
| classification en échec | classification failed | DET-22 |
| non vérifié | not verified | IHM-67 |
| minutes arrondies | rounded minutes | STA-12 |
| heure à déterminer | time TBD | STA-31 |
| partielle | partial | STA-24 |
| date inconnue | date unknown | STA-47 |
| 9 saisons sur 14 | 9 of 14 seasons | STA-41 |
| aucun match prévu (intersaison, équipe éliminée, joueur sans équipe, calendrier non publié) | no game scheduled (offseason, team eliminated, player without a team, schedule not published) | STA-26 |
| correspondance à établir | mapping to establish | JOU-10 |
| période non collectée (source désactivée) | uncollected period (source deactivated) | COL-09 |
| en panne depuis…, muette depuis… | down since…, silent since… | COL-40, IHM-36 |

### 7.3 Backtest requests, the prompt and the import

| French | English | IDs |
| --- | --- | --- |
| Demander un backtest | Request a backtest | BKT-01, JOU-25 |
| pas encore de backtest | no backtest yet | TEL-09, IHM-56 |
| non renseigné | not provided | BKT-22 |
| premier match NBA le AAAA-MM-JJ | first NBA game on YYYY-MM-DD | BKT prompt |
| date du premier match NBA à établir | first NBA game date to be established | BKT prompt |
| du AAAA-MM-JJ au AAAA-MM-JJ inclus | from YYYY-MM-DD to YYYY-MM-DD inclusive | BKT prompt |
| de son premier match NBA au AAAA-MM-JJ inclus | from his first NBA game to YYYY-MM-DD inclusive | BKT prompt |
| RECHERCHE APPROFONDIE — HISTORIQUE DES ÉVÉNEMENTS D'UN JOUEUR NBA | DEEP RESEARCH — EVENT HISTORY OF AN NBA PLAYER | BKT prompt |
| Demande émise par l'application personnelle Egoscope. | Request issued by Egoscope, a personal app. | BKT prompt |
| Référence de la demande : / Date du jour : / Joueur : / Période à couvrir : | Request reference: / Today's date: / Player: / Period to cover: | BKT prompt |
| Définition : / Critères d'inclusion : / Critères d'exclusion : / Règle de datation : / Exemple : | Definition: / Inclusion criteria: / Exclusion criteria: / Dating rule: / Example: | BKT prompt |
| recherché, aucun événement trouvé / non recherché | researched, no event found / not researched | BKT format |
| joueur retiré | player withdrawn | BKT-14 |
| à venir / joué | upcoming / played | BKT-18 |
| le backtest arrivera après coup (match mesuré joué) | the backtest will come after the game | BKT-18 |
| le texte copié n'est plus à jour | the copied text is no longer up to date | BKT-20 |
| née d'une détection / manuelle / complémentaire | from detection / manual / supplementary | BKT Données manipulées |
| Copier / Partager / Copier le prompt | Copy / Share / Copy prompt | BKT-20, IHM-39 |
| Compléter / refaire | Fill gaps / Redo | BKT-01 |
| Mettre à jour / Réduire / Annuler la demande | Update / Reduce / Cancel request | IHM-27 |
| Ouvrir l'outil de recherche | Open research tool | IHM-44 |
| prompt copié le … à … | prompt copied on … at … | IHM-27 |
| Coller le résultat | Paste result | IMP-01, IHM-27 |
| Backtest en cours | Backtest in progress | IHM-40 |
| Backtest en cours : le joueur A — Coller le résultat | Backtest in progress: player A — Paste result | IHM-19 |
| Backtest en cours : le joueur A — prompt copié il y a 12 min — Coller le résultat | Backtest in progress: player A — prompt copied 12 min ago — Paste result | IHM-40 |
| Plus tard | Later | IHM-40 |
| Coller / Vérifier / Effacer / Abandonner le brouillon | Paste / Check / Clear / Discard draft | IHM-28 |
| brouillon gardé à … | draft saved at … | IHM-28 |
| Enregistrer / Abandonner | Save / Discard | IMP-22, IHM-29 |
| Copier le message de correction | Copy the correction message | IMP-21, IHM-43 |
| demande déjà importée | request already imported | IHM-42 |
| ce texte n'est pas un résultat de backtest | This text is not a backtest result. | IMP-06 |
| (retour d'exploration refusé) ce texte n'est pas un retour d'exploration | This text is not an exploration response. | TAX-17 |
| cette demande a été annulée le … : importer quand même ? | This request was canceled on …: import anyway? | IMP-08 |
| Le texte s'arrête avant la fin du résultat : il manque la fin du 38e événement. Recopiez toute la réponse, ou demandez à l'IA une réponse plus courte. | The text stops before the end of the result: the end of the 38th event is missing. Copy the whole answer again, or ask the AI for a shorter one. | IMP-20 |
| 4e événement (humiliation-publique, 2021-02-30) : cette date n'existe pas. Indiquez la date publique au format AAAA-MM-JJ. | 4th event (public-humiliation, 2021-02-30): this date does not exist. Give the public date as YYYY-MM-DD. | IMP-20 |
| 7e événement : "www.media-national.example" n'est pas l'adresse complète d'un article. Donnez l'adresse complète, qui commence par https://. | 7th event: "www.national-outlet.example" is not the full address of an article. Give the full address, starting with https://. | IMP-20 |
| 9e événement : la source est datée du 2020-03-02, avant la date publique du 2020-03-05. Corrigez la date publique ou retirez cette source. | 9th event: the source is dated 2020-03-02, before the public date of 2020-03-05. Correct the public date or remove this source. | IMP-20 |
| Ce résultat concerne le joueur B, alors que cette demande concerne le joueur A. | This result is about player B, but this request is about player A. | IMP-20 |
| Aucun résultat reconnaissable : vérifiez que vous avez copié toute la réponse de l'IA. | No recognizable result: check that you copied the AI's whole answer. | 06 edge cases |
| N événements refusés manqueront au backtest tant qu'ils n'auront pas été corrigés et réimportés | N refused events will be missing from the backtest until they are corrected and imported again | IMP-24 |
| aucun événement nouveau | no new event | 06 edge cases |
| vers le 12e événement | around the 12th event | IMP-06 |
| type non validé à ce jour | type not validated to date | TAX-31, IMP-11 |
| introuvable | not found | IMP-17 |
| conforme / non conforme / inaccessible | consistent / inconsistent / inaccessible | IMP-23 |
| même fait / faits distincts / événements distincts | same fact / distinct facts / distinct events | IMP-25, IMP-26 |
| non enregistré pour donnée sensible / donnée sensible | not recorded: sensitive data / sensitive data | IMP-19, IMP-37 |
| le texte collé n'est pas conservé | the pasted text is not kept | 13 acceptance criteria |

### 7.4 Interface

| French | English | IDs |
| --- | --- | --- |
| Accueil / Joueurs / Alertes / Types / Plus | Home / Players / Alerts / Types / More | IHM-16 |
| Demandes de backtest / Réglages / État de l'application / Journal d'activité / Méthode et limites / Aide | Backtest requests / Settings / App status / Activity journal / Method and limits / Help | IHM-16 |
| Événements détectés / Tableau de validation / Collecte et détection | Detected events / Validation table / Collection and detection | IHM-16 |
| Rien à faire pour le moment | Nothing to do right now | IHM-20 |
| demande en cours | request in progress | IHM-19, IHM-40 |
| prompt copié | prompt copied | IHM-20, IHM-39 |
| échéance proche | deadline soon | IHM-20 |
| incidents masqués | hidden incidents | IHM-20 |
| Ajouter un joueur | Add a player | IHM-54 |
| Explorer de nouveaux types | Explore new types | IHM-31 |
| aucun type validé | no validated type | IHM-55 |
| la détection ne peut pas fonctionner | detection cannot work | IHM-55 |
| aucun événement de ce type trouvé par le backtest du … | no event of this type found by the backtest of … | IHM-56 |
| une alerte naît quand un joueur profilé vit un nouvel événement | an alert is produced when a profiled player has a new event | IHM-56 |
| Écarter / Réintégrer | Dismiss / Reinstate | IHM-32 |
| Retirer | Withdraw | IHM-67, IHM-68 |
| (bouton de confirmation de l'écran de retrait) | Withdraw and erase | IHM-68 |
| Rétablir la valeur par défaut | Restore default | IHM-37 |
| tous les profils seront recalculés | all profiles will be recalculated | IHM-37 |
| tout afficher | show all | IHM-27 |
| Choisir votre mot de passe | Choose your password | IHM-06 |
| Hors connexion — données du … à … | Offline — data from … at … | IHM-57 |
| mer. 18 nov. à 1 h 30 — mardi soir aux États-Unis | Wed 18 Nov at 01:30 — Tuesday evening in the US | IHM-14 |
| mercredi 11 novembre 2026 à 5 h 10, heure de Paris | Wednesday 11 November 2026 at 05:10, Paris time | CA-COL-06, TRV-71 |
| heure de Paris | Paris time | TEL-04, IHM-14 |
| dernière collecte il y a 3 jours | last collection 3 days ago | TRV-32 |
| modèle de langage : 412 appels sur 1 000 aujourd'hui, remise à zéro à 1 h | Language model: 412 of 1,000 calls today, resets at 01:00 | TRV-46 |
| Le flux du média national n'a pas répondu ce soir, pour la deuxième fois de suite. Ses articles ne sont plus collectés depuis le 9 novembre. Que faire : ouvrez la liste des sources et vérifiez son adresse ; si le média en a changé, remplacez-la. | The national outlet's feed did not answer tonight, for the second time in a row. Its articles have not been collected since 9 November. What to do: open the list of sources and check its address; if the outlet changed it, replace it. | TRV-42 |
| information / avertissement / incident | info / warning / incident | TRV-43 |
| à la demande | on demand | TRV-33 |
| tâche non exécutée / connexions refusées / sauvegarde en échec | task not run / logins refused / backup failed | TRV-31, TRV-61, TRV-50 |
| normal / dégradé / indisponible | normal / degraded / unavailable | TRV-46 |
| réalisée / partielle / non réalisée | done / partial / not done | TRV-79 |

### 7.5 Telegram

| French | English | IDs |
| --- | --- | --- |
| Egoscope · catégorie — sujet | Egoscope · category — subject | TEL-08 |
| Egoscope · Backtest à faire — le joueur B | Egoscope · Backtest to do — player B | TEL-09 |
| échéance modifiée | deadline changed | TEL-09 |
| le match a commencé ; la demande reste utile pour le profil | the game has started; the request is still useful for the profile | TEL-09 |
| Egoscope · Rappel — backtest du joueur B toujours à faire | Egoscope · Reminder — player B's backtest still to do | TEL-10 |
| Egoscope · Alerte — le joueur A | Egoscope · Alert — player A | TEL-11 |
| Egoscope · Alerte urgente — le joueur A | Egoscope · Urgent alert — player A | TEL-21 |
| Le match commence avant la fin de votre plage de silence. | The game starts before your quiet hours end. | TEL-21 |
| Egoscope · Mise à jour — alerte du joueur E | Egoscope · Update — player E's alert | TEL-12 |
| Egoscope · Résultats de 2 matchs suivis | Egoscope · Results of 2 tracked games | TEL-13 |
| pas encore de backtest : ce cas compte déjà dans son profil, qui ne repose que sur ses cas suivis | no backtest yet: this case already counts in his profile, which rests only on his tracked cases | TEL-13 |
| provisoire / indicatif | provisional / indicative | TEL-13 |
| Egoscope · Nouveau type proposé | Egoscope · New type proposed | TEL-14 |
| proposition de nouveau type à valider | new type proposal to validate | TAX-18, TEL-14 |
| Egoscope · Incident — {nature} / Egoscope · Incident résolu — {nature} | Egoscope · Incident — {nature} / Egoscope · Incident resolved — {nature} | TEL-15 |
| source de presse en panne / collecte impossible / source muette / quota de classification atteint / statistiques indisponibles | press source down / collection impossible / silent press source / classification quota reached / statistics unavailable | TEL-15 |
| Pendant la plage de silence | During quiet hours | TEL-20 |
| Egoscope est relié à cette conversation. | Egoscope is linked to this chat. | TEL-16 |
| Vous recevrez ici les notifications activées dans les réglages. Rien ne se fait depuis Telegram : chaque message contient un lien vers l'application. | You will receive here the notifications turned on in settings. Nothing is done from Telegram: each message links to the app. | TEL-16 |
| Cette conversation n'est plus reliée à Egoscope | This chat is no longer linked to Egoscope | TEL-30 |
| et 4 autres | and 4 more | TEL-19 |
| Tout est dans l'application | Everything is in the app | TEL-16 example |
| plafond atteint | daily cap reached | TEL-22 |
| après le coup d'envoi | after tip-off | TEL-23 |
| urgent | urgent | TEL-21 |
| Telegram non relié | Telegram not linked | TEL-28 |
| Relier Telegram / Ouvrir Telegram / Démarrer / Délier | Link Telegram / Open Telegram / Start / Unlink | TEL-29, TEL-30 |
| non reliée / en attente de confirmation / reliée depuis le… / rompue | not linked / awaiting confirmation / linked since… / broken | TEL-32 |
| événement sensible | sensitive event | TEL-06, DSN-35 |

### 7.6 Required content without a fixed French wording

The specs require these texts but do not quote them; the English below is the proposed standard wording, to be used as is.

| Requirement | English | IDs |
| --- | --- | --- |
| Reminder that accompanies every general trend | The general trend describes all observed players, not any one of them. | SEN-30 |
| Count of chance verdicts with the profile list | Verdicts chance alone would produce: {n} at least possible, {m} probable. | SEN-41 |
| Reminder before deleting a historical event or dismissing a detected one | An event is never removed because of the game that followed. | IMP-33, DET-46 |
| Reminder in the import preview | These checks do not prove that an article exists or says what the result claims. | IMP-17 |
| Reminder with a case's category | One case alone proves nothing. | ALE-27 |
| Detection confidence label | Model self-assessment, not a probability. | DET-25 |
| Home presentation at first launch | Egoscope measures how followed players played after public events. It does not predict games or give betting advice. | IHM-53 |

## 8. Restricted vocabulary

### 8.1 The rules in the specs

- **No betting, anywhere.** No function, screen or message recommends a bet, shows odds or a bookmaker line, or computes winnings (VUE-02, D-08, Q-05). No event type may relate to betting (TAX-09).
- **Alert sheets** contain no odds, bookmaker line, stake, forecast about the coming game, betting advice, future-tense sentence about the expected performance (« devrait briller », "should shine"), nor any superlative. The confidence shown is the profile confidence, never a confidence to bet (ALE-18). Every sheet ends with the standing notice (ALE-17).
- **Telegram messages** contain no odds, stake, forecast about a coming game, betting advice, nor future-tense sentence about the expected performance (TEL-05).
- **Verdicts** are written exactly "probable", "possible", "inconclusive" and are never called proven, confirmed or guaranteed; "confirmed" and "refuted" are used only in the validation-table sense (IHM-50). A verdict describes an observed association, never a proven cause; no label presents it as a certainty or a betting hint (SEN-42).
- **The word « pronostic »**, rendered "forecast", appears only in: the closing line of alert messages, "A measure of the past, not a forecast." (TEL-05); the terms of file 10 — frozen forecast, late forecast, no forecast — and the labels derived from them (forecast source, gap in forecast direction), on validation screens, in tracked game results and in the outcome of an alert sheet, after the game (ALE-18, IHM-50, TEL-05). Never to announce a coming game.
- **Descriptions** of events contain no value judgment ("shameful", "scandalous", "magnificent"), no psychological interpretation ("his pride was hurt", "he will want revenge"), and no forecast about the game (DSN-22, prompt rule 2.6).
- **Disclaimers** may name what the app does not do: the standing notice of alert sheets (ALE-17), the short notice of profile and validation screens (IHM-50), and the first-launch presentation, which says it does not predict games or give betting advice (IHM-53).
- **Neighboring restrictions.** Messages name no service provider, only functions (TEL-08); no person other than the player is named, only roles (DSN-17).

### 8.2 Banned English words

Scope: every UI string, Telegram message, alert sheet, event description, classification justification, journal message and prompt text the app produces; code identifiers avoid them too, because identifiers leak into labels. Match whole words and phrases, never substrings.

| Group | Banned | Only exception |
| --- | --- | --- |
| Betting | bet, bets, betting, wager, gamble, gambling, odds, betting line, bookmaker line, line (in the betting sense), spread, point spread, moneyline, over/under, prop, parlay, stake (an amount wagered), bankroll, bookmaker, bookie, sportsbook, pick, picks, tip (betting advice), tips, tipster, lock (a sure bet), sure thing, value bet, edge (betting advantage), cover the spread, handicap, favorite and underdog (in the odds sense), payout, winnings, profit, return on investment, cash out, hedge, units | "betting" in the three fixed disclaimers of 7.1 (ALE-17, IHM-50) and in the IHM-53 presentation |
| Forecasting | prediction, predict, predicted, projection, projected, outlook, expected to (about a performance), should (about a performance), will (about a performance), likely to, due for, bounce back, forecast | "predict" in the two disclaimers (ALE-17, IHM-53); "forecast" in the places of 8.1 |
| Certainty | proven, prove, guaranteed, certain, certainly, sure, definitely, confirmed (outside the validation table), refuted (outside the validation table) | "proves nothing" in "One case alone proves nothing." (7.6) |
| Hype and superlatives (alert sheets) | best, worst, biggest, huge, incredible, amazing, explosive, monster, unstoppable, elite, clutch | none |
| Judgment and psychology (descriptions) | shameful, scandalous, magnificent, disgraceful, brilliant, humiliating (as a judgment), hurt pride, revenge, fired up, motivated, angry, wants to prove | none |

### 8.3 Look-alikes that are allowed

| Allowed | Why it is not banned |
| --- | --- |
| game stakes, unusual stakes, high-stakes game | « enjeu »: what the game decides (qualification, elimination, title, ranking), never an amount wagered. Only the plural noun appears, and only in these three terms. |
| expected game, expected noise, expected by chance, expected false signals | Schedule and statistics terms; "expected" never qualifies a performance. |
| tip-off | NBA vocabulary for the start of a game. |
| lockout, lock screen | Login lockout and the phone's lock screen. |
| coverage, covered, not covered | Backtest coverage. |
| return from injury | Context indication. |
| probable, possible, inconclusive | The verdict levels, written exactly. |
| chance | The statistical baseline of "verdicts chance alone would produce". |
| record, record approach, negative record, win-loss record | Sports records and a team's results. |
| first line, row | A Telegram message's first line; a row of the validation table (never "line"). |
| dispersion | Never "spread". |
| confirmed, refuted, confirm (button), awaiting confirmation, to be confirmed | Case category and row assessment; the verb on the owner's confirmation buttons ("Confirm"); the Telegram link status; the mark of a hypothesis. Never about a verdict, a profile or an effect. |

### 8.4 Neutral wording to use instead

| Instead of | Write |
| --- | --- |
| "Player A should shine tonight" | Nothing about the coming game beyond its date, time, opponent and venue: "Expected game: Wed 18 Nov at 01:30, Paris time, against team X, away." |
| "prediction", "pick", "projection" | "A measure of the past": "In past games after this type of event, player A played on average above his season average." |
| "confidence to bet", "confidence" alone | "Profile confidence: low" (or detection confidence, or research confidence, always qualified) |
| "proven effect", "confirmed sensitivity" | "Verdict: probable, increase, on 9 valid cases" |
| "bounced back with 40 points" | No narrative: the description states the public fact; the game is a measured number |
| "expected performance" | "season baseline", "season mean" |
| "the best profiles", "top players" | "3 "probable" profiles of 41" |

## 9. Scheduled tasks, incident kinds and parameters

### 9.1 Scheduled tasks

TRV-26 asks for a plain-language name per task: the English name below is that name, shown on the status screen and in the journal. The key is the `TaskKey` value and the trigger route segment (`/api/tasks/news-collection` uses the kebab-case form of the key).

| Key | English name | French (TRV-25) | Lot | Default schedule | Owner |
| --- | --- | --- | --- | --- | --- |
| `news_collection` | News collection | collecte des actualités | 2 | Every day at the collection times: 16:30 and 23:00 Paris time (owner's decision on Q-SUI-02; the specs said 22:00) | 03, COL-12 |
| `event_detection` | Event detection | détection | 2 | Chained after each collection, in the same pass | 04, COL-16 |
| `classification_queue_resumption` | Classification queue resumption | reprise de la file de classification | 2 | Every 6 h while the queue is not empty, at the latest with the next collection | 04, DET-10 |
| `stats_update` | Schedule and statistics update | mise à jour du calendrier et des statistiques | 1 | Once a day, 12:00, never earlier than 3 h after the last tip-off of the past game day | 07, STA-32 |
| `game_tracking` | Game tracking | suivi des matchs des événements détectés | 2 | Chained after each statistics update | 10, SUI-12 |
| `stats_fetch_resumption` | Pending statistics fetch resumption | reprise des récupérations de statistiques en attente | 1 | At the retry delays (1 h, then every 4 h) and at quota renewal | 07, STA-36, STA-39 |
| `notification_sending` | Notification sending | envoi des notifications différées, des rappels avant échéance et des nouvelles tentatives d'envoi | 2 | Often enough for TEL-10, TEL-20 and TEL-35 (technical design) | 11 |
| `data_purge` | Data purge | purge des données à durée de conservation limitée | 1 (journals), 2 (articles) | Every day at 04:00 | 14, COL-39, TRV-48 |
| `backup` | Backup | sauvegarde | 1 | Every Monday at 05:00 | 14, TRV-50 |
| `run_check` | Run check | contrôle des exécutions | 1 | At the end of every pass and at every app opening | 14, TRV-31 |

### 9.2 Incident kinds

Incidents and the warnings that are notified like incidents. The key is the `IncidentKind` value; the English name is the incident's title on Home, in the to-do list, in the journal and after "Incident —" in Telegram.

| Key | English name | French | Level | Opens when | Closes when | IDs |
| --- | --- | --- | --- | --- | --- | --- |
| `press_source_down` | Press source down | « flux en panne », source de presse en panne | incident | A source goes down (2 consecutive failed runs) | A read brings articles again | COL-41, COL-43, TEL-15 |
| `collection_impossible` | Collection impossible | « collecte impossible » | incident | Every active source fails in the same run | Not stated by the specs (section 11) | COL-44 |
| `press_source_silent` | Silent press source | source muette (avertissement) | warning | No new article for the source's silence period | A read brings articles again | COL-42, COL-43, H-TEL-07 |
| `feed_too_short` | Feed keeps too few items | avertissement (trou de collecte sans exécution manquée) | warning | A collection gap appears although no run was missed | Not stated by the specs | COL-46 |
| `quota_reached` | Quota reached — {service function} | « quota atteint », quota de classification atteint | incident | A service's quota stops work (classification, stats source, any limit) | The quota renews; for classification, the queue is empty | DET-11, STA-39, TRV-05, TRV-06 |
| `quota_warning` | Quota warning — {service function} | avertissement de quota | warning | 80 % of a limit is used | The period renews | TRV-05 |
| `database_volume_warning` | Database volume warning | avertissement de volume | warning | 80 % of the free capacity is used | Usage falls below the share | TRV-07 |
| `stats_source_unavailable` | Stats source unavailable | « source de statistiques indisponible », statistiques indisponibles | incident | 12 h of continuous failures | The source answers again | STA-37 |
| `task_not_run` | Task not run | « tâche non exécutée » | incident | A task's last success is older than its interval plus the margin | The task succeeds | TRV-31 |
| `backup_failed` | Backup failed | sauvegarde en échec | incident | A backup fails | A backup succeeds | TRV-50 |
| `logins_refused` | Logins refused | « connexions refusées », blocage de la connexion | incident | Login is locked after repeated failures | The next successful login | TRV-61, H-TEL-06 |
| `telegram_link_broken` | Telegram link broken | liaison Telegram rompue | incident | A permanent send failure | The chat is linked again | TEL-37 |
| `export_reminder` | Export reminder | rappel d'export | reminder | 30 days without an export | An export is downloaded | TRV-54, TEL-15 |

`telegram_link_broken` appears only on Home and in the to-do list, since Telegram cannot carry it (TEL-37).

### 9.3 Parameter families

The registry groups parameters by owning document (TRV-38). Keys are camelCase properties of the typed parameter registry. Values and defaults stay in the owning requirements; nothing is copied here.

| Family | Key | English name | French | IDs |
| --- | --- | --- | --- | --- |
| 01 Followed players | `maxActivePlayers` | Maximum active players | nombre maximal de joueurs actifs | JOU-04 |
| 01 Followed players | `indicativeMinimumPlayers` | Indicative minimum of players | nombre indicatif minimal | JOU-04 |
| 01 Followed players | `exposureWindowDays` | Exposure indicator period | période de l'indicateur d'exposition | JOU-03 |
| 01 Followed players | `prolongedAbsenceThreshold` | Prolonged-absence threshold | seuil d'absence prolongée | JOU-22 |
| 03 News collection | `sourceIndicatorWindowDays` | Source indicator period | période des indicateurs de source | COL-11 |
| 03 News collection | `collectionTimes` | Collection times | heure ou heures de collecte | COL-12 |
| 03 News collection | `readAttemptsPerRun` | Read attempts per run | nombre de tentatives de lecture | COL-13 |
| 03 News collection | `maxArticleAgeDays` | Maximum article age | ancienneté maximale d'un article | COL-24 |
| 03 News collection | `excerptMaxLength` | Excerpt length | longueur de l'extrait | COL-27 |
| 03 News collection | `titleDedupWindowHours` | Title dedup window | fenêtre de dédoublonnage par titre | COL-30 |
| 03 News collection | `dedupTraceRetentionDays` | Dedup trace retention | durée de conservation des traces de dédoublonnage | COL-34 |
| 03 News collection | `notRelevantRetentionDays` | Not-relevant article retention | durée de conservation des articles non pertinents | COL-36 |
| 03 News collection | `failedRunsBeforeDown` | Failed runs before "down" | nombre d'exécutions en échec avant l'état « en panne » | COL-41 |
| 03 News collection | `silencePeriodDays` | Silence period (per source) | délai de silence, propre à chaque source | COL-42 |
| 04 Detection | `queuePriorityHorizon` | Queue priority horizon | horizon de priorité de la file | DET-09 |
| 04 Detection | `queueResumptionIntervalHours` | Queue resumption interval | intervalle de reprise de la file | DET-10 |
| 04 Detection | `classificationAttempts` | Classification attempts | nombre de tentatives de classification | DET-22 |
| 04 Detection | `detectionThreshold` | Detection threshold | seuil de détection | DET-24 |
| 04 Detection | `groupingWindowHours` | Grouping window | fenêtre de regroupement | DET-29 |
| 05 Backtest request | `maxSourcesPerEvent` | Maximum sources per event | nombre maximal de sources par événement | H-BKT-09 |
| 06 Import | `maxPastedSize` | Maximum pasted size | taille maximale du texte collé | IMP-02 |
| 06 Import | `toleratedSourceLeadDays` | Tolerated source lead | avance tolérée d'une source sur la date publique | IMP-14 |
| 06 Import | `disallowedDomains` | Disallowed source domains | liste des domaines non admis comme sources | IMP-14, H-IMP-13 |
| 06 Import | `linkCheckEnabled` | Link check | vérification de l'accessibilité des liens | IMP-17 |
| 06 Import | `spotCheckSourceCount` | Sources offered for the spot check | nombre de sources proposées au sondage | IMP-23 |
| 06 Import | `correspondenceWindowDays` | Correspondence window | écart maximal entre les dates publiques de deux événements correspondants | IMP-25 |
| 07 Game statistics | `playingTimeFloorMinutes` | Playing-time floor | plancher de temps de jeu | STA-14 |
| 07 Game statistics | `playingTimeAverageShare` | Share of average minutes | fraction de la moyenne de minutes | STA-14 |
| 07 Game statistics | `postseasonBaseline` | Baseline for play-in and playoff games | référence des matchs du tournoi de qualification et des phases finales | STA-18 |
| 07 Game statistics | `minBaselineGames` | Minimum baseline size | taille minimale d'une référence | STA-19 |
| 07 Game statistics | `partialBaselineShare` | Partial baseline threshold | seuil de référence partielle | STA-24 |
| 07 Game statistics | `statsUpdateDelayHours` | Delay after the last tip-off | délai minimal de la mise à jour quotidienne après le dernier coup d'envoi | STA-32 |
| 07 Game statistics | `correctionWindowDays` | Correction window | fenêtre de correction | STA-33 |
| 07 Game statistics | `boxScoreUnavailableAfterDays` | Delay before a box score is unavailable | délai avant feuille indisponible | STA-35 |
| 07 Game statistics | `fetchRetryDelaysHours` | Retry delays | délais de nouvelle tentative | STA-36 |
| 07 Game statistics | `statsIncidentAfterHours` | Delay before an incident | délai avant incident | STA-37 |
| 07 Game statistics | `quotaReservePercent` | Quota reserve | réserve de quota | STA-39 |
| 08 Sensitivity and verdict | `attachmentWindowDays` | Attachment window | délai maximal de rattachement | SEN-04 |
| 08 Sensitivity and verdict | `coOccurringAsDoubtful` | Treat co-occurring cases as doubtful | traitement des cas concomitants comme douteux | SEN-06 |
| 08 Sensitivity and verdict | `injuryReturnFirstGames` | Games after an absence (return from injury) | nombre de premiers matchs (critère calculé de retour de blessure) | SEN-13 |
| 08 Sensitivity and verdict | `injuryReturnAbsenceGames` | Absence length (return from injury) | durée d'absence (critère calculé de retour de blessure) | SEN-13 |
| 08 Sensitivity and verdict | `allPlayoffGamesUnusualStakes` | Treat every playoff game as unusual stakes | traitement de tout match de phases finales comme enjeu inhabituel | SEN-14 |
| 08 Sensitivity and verdict | `opponentWinShareLow`, `opponentWinShareHigh` | Opponent strength bounds | bornes du niveau de l'adversaire | SEN-15 |
| 08 Sensitivity and verdict | `opponentMinGames` | Opponent minimum games | nombre minimal de matchs de l'adversaire | SEN-15 |
| 08 Sensitivity and verdict | `validCaseThreshold` | Valid cases per player | seuil de cas valides par joueur | SEN-23, H-03 |
| 08 Sensitivity and verdict | `possibleSnrThreshold`, `possibleMeanGapThreshold`, `probableSnrThreshold`, `probableMeanGapThreshold` | Verdict thresholds | seuils du verdict | SEN-23, Q-04 |
| 08 Sensitivity and verdict | `confidenceMediumFromCases`, `confidenceHighFromCases`, `confidenceDispersionLimit`, `confidenceDoubtfulShareLimit` | Profile confidence thresholds | seuils de la confiance du profil | SEN-25 |
| 08 Sensitivity and verdict | `trendMinPlayers` | Minimum players for a trend | nombre minimal de joueurs (tendance générale) | SEN-29 |
| 08 Sensitivity and verdict | `trendMaxPlayerShare` | Maximum share of one player in a trend | part maximale d'un joueur (tendance générale) | SEN-29 |
| 08 Sensitivity and verdict | `countsBelowCaseCount` | Counts instead of percentages below | nombre de cas sous lequel les proportions s'affichent en nombres | SEN-39 |
| 09 Alert sheet | `vigilanceMarginPoints` | Vigilance margin | marge de vigilance sur la confiance de détection | ALE-16, H-ALE-06 |
| 10 Tracking and validation | `categoryThreshold` | Category threshold | seuil de catégorie d'un cas suivi | SUI-22 |
| 10 Tracking and validation | `minTrackedCasesForAssessment` | Minimum tracked cases for an assessment | nombre minimal de cas suivis pour un bilan | SUI-26 |
| 11 Telegram notifications | `reminderLeadHours` | Reminder before the deadline | délai du rappel avant échéance | TEL-10 |
| 11 Telegram notifications | `incidentReminderIntervalDays` | Incident reminder frequency | fréquence du rappel d'incident | TEL-15 |
| 11 Telegram notifications | `incidentRecurrenceWindowHours` | Incident recurrence window | délai de reprise d'un incident | TEL-15 |
| 11 Telegram notifications | `alertGroupingThreshold` | Alert grouping threshold | seuil de regroupement des alertes | TEL-19 |
| 11 Telegram notifications | `maxFactsPerDigest` | Facts detailed per digest | nombre de faits détaillés par message groupé | TEL-19 |
| 11 Telegram notifications | `quietHours` | Quiet hours | plage de silence | TEL-20 |
| 11 Telegram notifications | `urgentExceptionEnabled` | Urgent exception | exception d'urgence | TEL-21 |
| 11 Telegram notifications | `dailyCap` | Daily cap | plafond quotidien | TEL-22 |
| 11 Telegram notifications | `notificationCategories` | Categories and sub-options | activation des catégories et sous-options | TEL-24 |
| 11 Telegram notifications | `linkCodeValidityMinutes` | Link code validity | durée de validité du code de liaison | TEL-29 |
| 11 Telegram notifications | `retryIntervalsMinutes` | Retry intervals | intervalles de nouvelle tentative | TEL-35 |
| 12 Interface and access | `timeZone` | Time zone | fuseau horaire de l'utilisateur | IHM-14 |
| 12 Interface and access | `listPageSize` | List page size | taille des tranches de liste | IHM-18 |
| 12 Interface and access | `deadlineSoonHours` | "Deadline soon" delay | délai de la mention « échéance proche » | IHM-20 |
| 12 Interface and access | `draftRetentionDays` | Draft retention | durée de conservation d'un brouillon | IHM-42 |
| 12 Interface and access | `researchToolUrl` | Research tool address | adresse de l'outil de recherche | IHM-44 |
| 13 Sensitive data | `maxDescriptionLength` | Maximum description length | longueur maximale d'une description | DSN-20 |
| 14 Cross-cutting | `quotaLimits` | Quota limits per service | limites de quota de chaque service | TRV-03 |
| 14 Cross-cutting | `quotaWarningShare` | Quota warning share | part de la limite qui déclenche l'avertissement de quota | TRV-05 |
| 14 Cross-cutting | `volumeWarningShare` | Database volume warning share | part de la capacité de la base qui déclenche l'avertissement de volume | TRV-07 |
| 14 Cross-cutting | `taskSchedule` | Task times | horaires des tâches planifiées | TRV-25 |
| 14 Cross-cutting | `missedRunMarginHours` | Margin before "task not run" | marge avant l'incident « tâche non exécutée » | TRV-31 |
| 14 Cross-cutting | `journalRetentionDays` | Journal retention | durée de conservation des journaux | TRV-48 |
| 14 Cross-cutting | `backupFrequency`, `backupsKept` | Backup frequency, backups kept | fréquence des sauvegardes, nombre de sauvegardes conservées | TRV-50 |
| 14 Cross-cutting | `exportReminderDays` | Export reminder delay | délai du rappel d'export | TRV-54 |
| 14 Cross-cutting | `minPasswordLength` | Minimum password length | longueur minimale du mot de passe | TRV-60 |
| 14 Cross-cutting | `loginFailureLimit`, `loginObservationMinutes`, `lockoutMinutes` | Login failures, observation period, lockout duration | nombre d'échecs, période d'observation, durée du blocage de connexion | TRV-61 |
| 14 Cross-cutting | `sessionIdleDays` | Idle session duration | durée de session sans utilisation | TRV-62 |

File 02 has no application parameter: values such as the media-storm coverage threshold live in the type sheet (TRV-38). Not parameters, because the journal fixes them: the processed languages (English and French), the daily frequency of collection and detection (only the times are set), and the historical depth of a backtest (the whole NBA career).

## 10. Terms introduced by the owner's decisions

The decisions of 2026-11-11 add concepts the French specs do not name. Their English names are fixed here; the domain model decides their shape.

| Concept | English term | Code | UI label | Decision |
| --- | --- | --- | --- | --- |
| Event the app creates from the schedule (birthday game, first game against a former team) | schedule-derived event | `EventOrigin` value `schedule` | From the schedule | Q-TAX-01, Q-SEN-04 |
| Case of a schedule-derived event whose game the player misses | not measurable: player missed that game | `CaseStatusReason` value `scheduled_game_missed` | Player did not play that game | Q-SEN-04 |
| Doubtful-case criterion switched off on one type sheet | switched-off criterion | `TypeSheet.switchedOffCriterion` (a `DoubtfulCaseCriterion`) | Criterion switched off for this type | Q-SEN-01 |
| Permanent warning on the profiles of such a type | confounder warning | `confounder_not_separable` | The effect of this type cannot be separated from {criterion}. | Q-SEN-01 |
| Keyed hash of player, type and date of a withdrawn event, kept eight weeks | withdrawal fingerprint | `WithdrawalFingerprint` | — | Q-DSN-01 |
| Event found again by detection or import that matches a fingerprint | fingerprint match | `matchesWithdrawalFingerprint` | Previously withdrawn | Q-DSN-01 |
| Key that encrypts backups, from the deployment configuration | backup encryption key | — | — | Q-TRV-01 |
| Count of verdicts chance alone would produce | chance verdict count | `ExpectedFalseSignals` | Verdicts chance alone would produce | Q-04, SEN-41 |
| Stats source combined from two sources | combined stats source | — | — | Q-STA-01 |

## 11. Not settled

Points this glossary could not settle because the specs or decisions leave the concept itself open. Each needs an owner's or a domain-model ruling; until then, use the provisional name given.

1. **Origin of schedule-derived events.** Decision Q-TAX-01 makes the app create birthday and former-team events from the schedule. The specs know only two origins (detected, historical) and two case origins (historical, tracked). Provisional: event origin `schedule`; whether such a case is historical or tracked (it can be past or upcoming) is for the domain model.
2. **Reason of a detached article.** DET-47 says a detached article "becomes not relevant" but gives no reason among the not-relevant reasons. Provisional value: `detached`, label "Detached from its event".
3. **When "collection impossible" closes.** COL-44 does not say. Provisional: when a later run reads at least one source successfully.
4. **When "feed keeps too few items" closes**, and its name: COL-46 only describes the warning. The English name is a proposal.
5. **Precision of a historical event's date.** COL-20 defines exact, approximate and none for collected articles; a research result gives a date or a date and time. Whether `DatePrecision` also covers historical events (date only = `approximate`?) is for the domain model.
6. **One quota incident or several.** The French uses « quota atteint » for the classification quota (DET-11), the stats-source quota (STA-39) and any service limit (TRV-05). This glossary makes it one kind, `quota_reached`, with the service function; separate kinds would need new names.
7. **The decrease caveat (ALE-16).** « le joueur a tendance à jouer moins bien » is a present-tense claim close to what ALE-18 and SEN-42 forbid (12-oddities). The English uses the present perfect, "has tended to play worse", to keep it about past games; the owner may prefer the ALE-10 wording instead.
8. **Route segments.** The routes in 3.13 follow the conventions but are proposals for the interface module.
9. **The owner as actor in labels.** Origins « utilisateur » are labeled "You" (single-user app). If screens are ever shared, "Owner" would replace it everywhere.
