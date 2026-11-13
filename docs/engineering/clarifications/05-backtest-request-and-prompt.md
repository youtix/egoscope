# Clarifications — 05 Backtest request and prompt

Rulings on the unclear points of the French spec `docs/05-demande-de-backtest-et-prompt.md`.
The decision records (`docs/adr/`, `docs/engineering/spec-deviations.md`) and these rulings override the spec text where they say so; the French spec is authoritative everywhere else.

## CL-BKT-01 — Acceptance-criterion IDs

- **Affects:** the 17 acceptance criteria of 05
- **Problem:** the criteria are numbered 1 to 17 and labeled with requirement IDs, but carry no `CA-` ID, so tests have nothing stable to cite.
- **Ruling:** As decided (decisions, "Acceptance-criterion IDs"): `CA-BKT-01` to `CA-BKT-17` in document order; `CA-BKT-nn` is the criterion numbered nn, the same one the deviations register cites as `05 AC-nn`. Each test names its `CA-BKT` ID and the requirement IDs printed at the head of the criterion.
- **Why:** one citation scheme for every spec file.
- **Owner review:** no

## CL-BKT-02 — The English exchange contract, format 1.0

- **Affects:** BKT-12, BKT-20 to BKT-24, H-BKT-05, H-BKT-07, H-BKT-08, prompt rules 2.5 and 2.6, « Données manipulées », CA-BKT-12, CA-BKT-13
- **Problem:** the prompt, the JSON keys, the enumerated values and the free texts are French, and BKT-24 makes any renamed key a new format version.
- **Ruling:**
  - As decided (ADR 0010, register row BKT-24): format 1.0 is the English-keyed form. `format` keeps the value `egoscope-backtest`. The French-keyed form is never implemented; the import reads no French key or value (a French key is an unknown field, IMP-16).
  - Key names and enumerated values are the glossary's one-to-one English mapping of the French ones. The structure, the required and optional fields and every rule of « Données manipulées » are unchanged.
  - The prompt is one fixed English template: a rule-by-rule translation of the reference text, with only these changes: free texts (description, context detail, unverified note, leads, limitations) are asked "in English"; article titles stay as published, in their own language; calendar-derived types never appear (CL-BKT-03); rule 2.5 loses its birthday example. Every placeholder keeps its meaning and no demand listed in BKT-21 is weakened.
  - Every date the prompt shows (today's date, the periods, the first NBA game in the player marker) is written `YYYY-MM-DD`, never in the owner's display format (ADR 0010: machine formats stay ISO 8601).
  - The full example of 05 is rewritten with English keys, English enumerated values, English free texts, English outlet labels and the glossary's English type identifiers, with the same facts, dates and links. `CA-BKT-13` tests that English example; its free texts still respect the length and quotation-mark rules.
  - The import does not check the language of free texts; a French description is imported like any other.
- **Why:** decided; the rest keeps one contract between the prompt and the import.
- **Owner review:** no

## CL-BKT-03 — Calendar-derived types and backtest requests

- **Affects:** BKT-02, BKT-04, BKT-05, BKT-08, BKT-09, BKT-10, BKT-15, BKT-21, BKT-23, BKT-30, Q-BKT-03, « Cas limites » (« Type dont la date se connaît d'avance »)
- **Problem:** birthday and former-team events now come from the calendar (ADR 0015), while every rule of 05 speaks of "all validated types".
- **Ruling:** In 05, read "validated type" as "research type": a validated type whose dating rule is not "derived from the calendar". Hence:
  - BKT-02: while no research type is validated, no request can be created, even if a calendar-derived type is validated; the action shows the BKT-02 explanation.
  - A request, its prompt (type blocks and `{{TYPE_LIST}}`, the spec's `{{LISTE_TYPES}}`) and an update (BKT-15) never contain a calendar-derived type.
  - Coverage (BKT-10) never holds a calendar-derived type, and "coverage includes the type" is never asked for one: no BKT-30 routing, no BKT-04 supplement, no BKT-05 proposal, no coverage warning on its profiles (register rows BKT-04, BKT-05, BKT-08, BKT-10, BKT-30; CL-SEN-03).
  - What the import does with an event of such a type: CL-IMP-29.
  - Q-BKT-03 is settled (register row Q-BKT-03). The edge case « Type dont la date se connaît d'avance » now concerns only a type known in advance that is not calendar-derived; no seeded type is one.
- **Why:** ADR 0015 takes these types out of the prompt and the coverage; one reading keeps every rule of 05 consistent with it.
- **Owner review:** no

## CL-BKT-04 — One covered period for several per-type periods

- **Affects:** BKT-09, BKT-10, BKT-25, prompt rule 2.11, format `periode_couverte`, IMP-10
- **Problem:** a request sets one period per type, but the result declares a single covered period, so the research AI cannot say it finished type A but stopped type B.
- **Ruling:** As written. The result keeps a single covered period; the retained coverage of each type is its requested period intersected with the declared period (IMP-10). No per-type covered period is added: that would be a new format version (BKT-24). A type the AI researched only in part must be left out of the covered types, as the format rules of the prompt already say ("garde dans types_couverts les seuls types réellement recherchés"). The import cannot detect a type declared covered but researched in part; the distribution by type and season in the preview (BKT-28, IMP-22) is the owner's check.
- **Why:** rule 2.11 processes the period in chronological order, all types mixed, so one stop date is coherent with the prompt.
- **Owner review:** no

## CL-BKT-05 — "First uncovered day": holes, sheet versions, unknown first game

- **Affects:** BKT-05, BKT-09, BKT-10, CA-BKT-07, « Cas limites » (« Compléter » alors que la couverture est complète)
- **Problem:** a type's coverage can have holes and periods researched under several sheet versions, while BKT-09 gives each type one period starting at "the first uncovered day".
- **Ruling:** For player P and research type T:
  1. A covered period counts for T when the sheet version recorded on it is not older than T's latest broadening version — a version created by a change to which TAX-24 applies, a merge or a split included (CL-BKT-06). If T has no broadening version, every covered period counts.
  2. Career start: P's first NBA game date (STA-47, CL-STA-12); if it is unknown, the earliest start among T's counting periods; if there is none, unknown.
  3. First uncovered day: the earliest day, on or after the career start, that lies in no counting period.
  4. Period of T in a supplement: with no counting period, the whole career (from the career start, or "from his first NBA game" when it is unknown) to the creation date; otherwise from the first uncovered day to the creation date. A first uncovered day later than the creation date means T is complete and is not requested.
  5. Holes are not requested one by one: the single period runs from the first uncovered day to the creation date and re-searches the covered spans after the hole. The import recognizes facts already saved as duplicates (IMP-25, IMP-26) and adds only the new ones.
  6. « Compléter » when every research type is complete: no request is created; the app says the coverage is complete up to today and offers « refaire ».
  - Example: T covered from 2019-10-23 to 2022-06-30 and from 2023-07-01 to 2025-06-30 under its current version; « compléter » on 2026-11-11 requests T from 2022-07-01 to 2026-11-11.
- **Why:** the request holds one period per type; re-searching covered spans only costs recognized duplicates. Rule 1 is BKT-09's "élargi depuis sa dernière recherche" made computable.
- **Owner review:** no

## CL-BKT-06 — Coverage after a type merge or split

- **Affects:** BKT-05, BKT-09, BKT-10, TAX-27, TAX-29
- **Problem:** coverage is kept per type; nothing says what the surviving type of a merge or the types born of a split inherit.
- **Ruling:**
  - Merge (TAX-27): for each player, the surviving type's coverage becomes the days that were covered for every merged type, surviving and absorbed alike; these periods are recorded under the surviving type's version in force before the merge. If TAX-24 applies to the merge, the merge version is a broadening version (CL-BKT-05, rule 1), so these periods stop counting and the next supplement asks for the whole career. The absorbed types' own coverage is kept as history and never consulted.
  - Split (TAX-29): each resulting type inherits the original type's covered periods, recorded under version 0, before its version 1. If TAX-24 applies to the split, version 1 of each resulting type is a broadening version.
  - An inherited period makes "coverage includes the type" (BKT-10) true like any other.
- **Why:** a period researched for every merged type covers their union; a period researched for the original type covers each of its parts.
- **Owner review:** no

## CL-BKT-07 — The supplement offered after an incomplete import

- **Affects:** BKT-06, BKT-15, IMP-35, CA-BKT-08
- **Problem:** BKT-06 offers the supplement covering what an import left out, including the part a reduction removed, but a reduced request no longer holds that part.
- **Ruling:**
  - A request stores its planned types: the types at creation, plus those an update adds, minus those an update removes because they are no longer validated. A reduction removes a type from the requested types but not from the planned types.
  - After an import, the import summary and the player page offer one supplement covering every planned type that still has an uncovered day up to today. Its periods are computed by CL-BKT-05 on the day the owner accepts it, which is also their end. Nothing is created without that acceptance.
  - If the player has a to-do request when the owner accepts, the app offers to update that request instead, as BKT-05 does.
  - `CA-BKT-08` holds: accepted on the import day, the supplement runs from 2022-07-01 to 2026-11-11.
- **Why:** BKT-15 promises that what a reduction removes comes back as a supplement; BKT-07 allows one open request per player.
- **Owner review:** no

## CL-BKT-08 — What an update adds

- **Affects:** BKT-07, BKT-15, H-BKT-02, CA-BKT-16
- **Problem:** BKT-15's update "adds the types validated since creation" without giving their periods, and BKT-07 says an update can include an attached detected event's type.
- **Ruling:** An update, in one step:
  1. adds every research type validated or reactivated after the request's creation and, in lot 2, the type of every attached detected event that is neither dismissed nor withdrawn and is not in the request, as for the deadline (CL-BKT-23);
  2. removes every requested type that is no longer validated;
  3. takes each type's current sheet version;
  4. moves every period end to the update day;
  5. gives each added type the period a new request of the same kind would give it on the update day: BKT-08 for an initial request or a full redo, CL-BKT-05 for a supplement;
  6. keeps the start of the types already requested;
  7. regenerates the prompt under the same reference (BKT-20).
  - Types validated before the creation but absent from the request are not added.
- **Why:** H-BKT-02 freezes the types except through an update; an added type needs the period a new request would give it.
- **Owner review:** no

## CL-BKT-09 — Reduction to the end of a chosen season

- **Affects:** BKT-15, STA-48, CA-BKT-10
- **Problem:** "the end of a chosen season" has no date, and a type whose period starts after that end is not addressed.
- **Ruling:**
  - The end of season S is the US date of the last official game of S's playoffs, league-wide (STA-48), read from the stored schedule. The reduction offers the finished seasons of the player's career whose last game is stored and that end before the current period end.
  - Each requested type's period end becomes the earlier of its end and the season end. A type whose period would become empty is removed from the requested types (it stays planned, CL-BKT-07). If no type would remain, the reduction is refused and the app says why.
  - Removing types is the other form of reduction; both may be combined in one reduction. The prompt is regenerated under the same reference (`CA-BKT-10`).
- **Why:** STA-48 defines the season; the next supplement then starts the day after the Finals, the first day STA-48 files under the next season.
- **Owner review:** no

## CL-BKT-10 — Which calendar the request's dates use

- **Affects:** BKT-08, BKT-09, BKT-15, BKT-20 (`{{DATE_DU_JOUR}}`), CA-BKT-01, CA-BKT-07
- **Problem:** "creation date", "date du jour" and "today" do not say in which time zone the day is taken (TRV-72).
- **Ruling:** Each is the owner's calendar date in the owner's time zone (IHM-14, Paris by default) at the moment of the action, TRV-72's default for the day of a task. Example: a request created at 00:30 Paris time on 12 November 2026 ends its periods on 2026-11-12.
- **Why:** TRV-72 requires every "day" to name its zone.
- **Owner review:** no

## CL-BKT-11 — Request reference format

- **Affects:** BKT-12, « Données manipulées » (Référence), IMP-07
- **Problem:** the spec gives only the indicative form « DEM-2026-0007 », with a French prefix.
- **Ruling:** `<PREFIX>-<YYYY>-<NNNN>`: PREFIX is the English prefix the glossary sets in place of « DEM » (`REQ`, as in `REQ-2026-0007`); YYYY is the creation year (CL-BKT-10); NNNN is a sequence that restarts at 0001 each year, zero-padded to four digits and longer beyond 9999. It is assigned at creation, never changed and never reused, canceled requests included. The import compares it after trimming spaces and ignoring case.
- **Why:** unique, stable and readable, as BKT-12 asks.
- **Owner review:** no

## CL-BKT-12 — "Share" counts as a copy

- **Affects:** BKT-20, IHM-27, IHM-40
- **Problem:** BKT-20 records the date of the last copy and warns when the prompt changes after it, but says nothing of « Partager ».
- **Ruling:** « Copier » and « Partager » both set the request's "last copied" instant: Copy when the clipboard write succeeds, Share when the share sheet reports that the text was shared (a canceled share sets nothing). The stale-copy warning (prompt changed after that instant) and the "backtest in progress" banner (IHM-40) use it.
- **Why:** either gesture hands the text to the research AI.
- **Owner review:** no

## CL-BKT-13 — Which types an event or a lead may carry

- **Affects:** format `type_evenement` (event and lead), the prompt skeleton, IMP-11, IMP-15
- **Problem:** the prompt says "a type of point 3" (requested types), the format says "a type of `types_couverts`" (researched types).
- **Ruling:** As written in 06, which 05 names as the judge of tolerated gaps: an event of a requested type that is absent from the covered types is accepted with a warning, and that type is not counted as covered (IMP-11). A lead whose type is missing, unknown or not requested is counted without a type (CL-IMP-23). The prompt keeps both wordings.
- **Why:** IMP-11 settles it.
- **Owner review:** no

## CL-BKT-14 — Citation of the wording rules for descriptions

- **Affects:** « Données manipulées » (general rules; `description`)
- **Problem:** the general rule cites DSN-12 to DSN-23 for every free text, the description row only DSN-19 to DSN-23.
- **Ruling:** As written: every free text follows DSN-12 to DSN-23 (general rule); the narrower citation of the description row adds nothing and removes nothing.
- **Why:** the general rule already covers descriptions.
- **Owner review:** no

## CL-BKT-15 — Sorting events whose dates mix dates and date-times

- **Affects:** format `evenements` (« triée par date publique croissante »), BKT-25, IMP-05, « Cas limites » of 06 (events not sorted)
- **Problem:** the list must be sorted by public date, but values mix dates and date-times with any offset, and no comparison rule is given.
- **Ruling:** A list is sorted when the date parts as written (the `YYYY-MM-DD` before any time) never decrease from one event to the next. Events of the same date may come in any order; times and offsets are not compared. The import's sortedness test (its warning and the IMP-05 recovery) uses this definition (CL-IMP-19).
- **Why:** this is how a research AI sorts, and it needs no time-zone arithmetic.
- **Owner review:** no

## CL-BKT-16 — Strict date patterns

- **Affects:** « Données manipulées » (dates), IMP-12, IMP-14
- **Problem:** the format admits only `YYYY-MM-DD` and `YYYY-MM-DDTHH:MM±HH:MM`, while research AIs often write `Z` or seconds.
- **Ruling:** As written for the format definition and the prompt, which keep asking for exactly these two forms. What the import accepts beyond them is ruled in CL-IMP-08.
- **Why:** the contract stays strict; tolerance belongs to the import.
- **Owner review:** no

## CL-BKT-17 — A public date earlier than its earliest source

- **Affects:** prompt rule 2.5, the full example (first event)
- **Problem:** the example's public date (23:10) is 30 minutes before its earliest source (23:40), while rule 2.5 says the public date is "usually" that of the first source.
- **Ruling:** As written: "en général" leaves room for a fact made public at a known moment, such as a press conference, and reported soon after. The import never refuses a public date earlier than its sources; it refuses an event only for a source dated more than one day before its public date (IMP-14, CL-IMP-11). Precedence over the game is decided by the sources (IMP-18).
- **Why:** rule 2.5 settles it.
- **Owner review:** no

## CL-BKT-18 — Context of a game not yet played

- **Affects:** prompt rule 2.7, format `contexte`
- **Problem:** rule 2.7 forces « inconnu » for a game not yet played even when its stakes are already known.
- **Ruling:** As written: the context describes the first game the player plays after the event, which is unknown until played. The owner may set the indications later (IMP-32); the import changes nothing.
- **Why:** the player may miss the next scheduled game.
- **Owner review:** no

## CL-BKT-19 — Identifying "the first game after the event" without statistics

- **Affects:** prompt rules 2.2, 2.3, 2.7
- **Problem:** the AI must find the first NBA game the player played after the event while being told not to look at statistics.
- **Ruling:** As written: rule 2.2 bans statistics and scores, not schedules or participation; no sentence is added to the prompt. The app checks precedence itself at import (IMP-18).
- **Why:** the reference text is clear enough, and the import is the safeguard.
- **Owner review:** no

## CL-BKT-20 — A canceled request imported while another request is to do

- **Affects:** BKT-07, BKT-13, BKT-14, IMP-08
- **Problem:** BKT-13 lets a canceled request become imported; meanwhile a new to-do request may exist, and two requests then feed the same coverage.
- **Ruling:** Allowed (H-IMP-05). The canceled request becomes imported; the other request stays to do, since BKT-07 limits only to-do requests. Coverage is one union per player and type: each import adds its own retained coverage, computed against its own request, in any order. Remaining refusals stay per request (CL-IMP-24). The preview of such an import says that the player has another request to do, gives its reference, and says it stays open.
- **Why:** nothing conflicts once coverage is a union.
- **Owner review:** no

## CL-BKT-21 — Quota of the research AI

- **Affects:** BKT-19, register row BKT-19
- **Problem:** BKT-19 describes a quota outside the app; its only behavior is negative.
- **Ruling:** As written: the app models no research-AI quota and keeps no timer on to-do requests — no reminder, no automatic cancellation, no change by age. Test: a to-do request of any age keeps its state and its rank (BKT-17).
- **Why:** the app cannot observe that quota.
- **Owner review:** no

## CL-BKT-22 — Detection-born and validation-born supplements are sized differently

- **Affects:** BKT-04, BKT-05, H-BKT-03
- **Problem:** a detection-born supplement covers every uncovered type, a validation-born one only the validated type.
- **Ruling:** As written (H-BKT-03): BKT-04 (lot 2) covers every uncovered research type; BKT-05 covers only the type validated, reactivated or broadened.
- **Why:** intended by the spec.
- **Owner review:** no

## CL-BKT-23 — "Upcoming" measured game and the urgent deadline (lot 2)

- **Affects:** BKT-16, BKT-18, CA-BKT-04, CA-BKT-05, CA-BKT-11
- **Problem:** BKT-18 shows each attached event's measured game as upcoming with the time remaining, but 08 knows the measured game only after the player has played it.
- **Ruling:** An attached detected event's measured game is « à venir » while its case is pending for the reason "game not yet played" (CL-SEN-05) and « joué » once the case leaves that reason. For an upcoming one, the time remaining runs to its expected game: the first official game of the player's current team whose scheduled start is after both now and the event's reference instant (SUI-03, ALE-15). An urgent request's deadline is the earliest of these expected games; urgent requests with the same deadline are ordered oldest first. Dismissed and withdrawn events are left out.
- **Why:** the expected game is the only deadline knowable before the game, and docs 09 and 10 use the same one.
- **Owner review:** no

## CL-BKT-24 — Deadline with a time to be determined

- **Affects:** BKT-16, BKT-18, STA-31, IHM-27
- **Problem:** STA-31 deems a game without a set time to start at the beginning of its local day, which a deadline would show as midnight.
- **Ruling:** When the next game's time is to be determined, the deadline shows the date and the glossary's "time TBD" mention, never 00:00, and the time remaining in whole days. Ordering and urgency use the deemed start of STA-31 (CL-STA-14).
- **Why:** the deemed start is a cautious bound for comparisons, not information to show.
- **Owner review:** no

## CL-BKT-25 — Which supplements are created and which are only proposed

- **Affects:** BKT-04, BKT-05, BKT-06, BKT-15, 00 « Variantes » (Joueur déjà profilé), TAX-20, TAX-24, TAX-32
- **Problem:** file 00 says a supplementary request is « créée ou proposée » without saying which, and file 02 speaks only of proposing one.
- **Ruling:** As written: BKT-04 (lot 2) creates the detection-born supplement at once, attached to its event, without asking the owner. BKT-05 (a type validated, reactivated or broadened, hence TAX-20, TAX-24 and TAX-32) and BKT-06 (an incomplete import, CL-BKT-07) only propose theirs and create nothing without the owner's agreement; for a player who already has a request to do, BKT-05 proposes its update instead (BKT-15), or waits (CL-BKT-26). File 00's « créée ou proposée » covers these two cases.
- **Why:** BKT-04 says the application « crée » the supplement; BKT-05 « ne crée rien sans accord », H-05 saying such a request « peut » be issued.
- **Owner review:** no

## CL-BKT-26 — The players a type's supplement is offered to: by coverage, not by dates

- **Affects:** BKT-05, BKT-06, BKT-07, BKT-10, BKT-15, CA-BKT-06; CL-BKT-05, CL-BKT-07, CL-BKT-08, CL-BKT-25
- **Problem:** BKT-05 lists the already-processed players who lack a type at the moment the type is validated, reactivated or broadened. A player whose request was created before that moment and imported after it, without an update, becomes already processed later and would never be offered the type; and BKT-05 proposes the update of a request to do even when the update would not add the type.
- **Ruling:**
  - The proposal for a research type T lists every already-processed player — at least one saved import (BKT-10) — whose coverage has no counting period for T (CL-BKT-05, rule 1), whatever the order of his imports and of T's validation, reactivation or broadening. It lasts as long as that gap lasts and is computed from the coverage when shown; no proposal is stored.
  - For a player with a request to do, the proposal is that request's update when the update would add T (CL-BKT-08, step 1); otherwise the player stays listed with a mention that the proposal waits until that request is imported or canceled (BKT-07).
  - The same gap can also be offered as the supplement after an incomplete import (BKT-06, CL-BKT-07). Accepting either creates the player's one open request, which the other entry point then shows (BKT-07).
- **Why:** a state does not depend on the order in which imports and validations happen; a request created before T was validated and imported later without an update would otherwise never be offered T.
- **Owner review:** yes — BKT-05 reads as a reaction to the validation; the list now lasts as long as the gap, so a player can be offered T long after T was validated, and a player whose request to do cannot take T waits.

## Passed to the glossary

- English key names of format 1.0: root (`format`, `version_format`, `reference_demande`, `joueur.identifiant`, `joueur.nom`, `types_couverts`, `periode_couverte.debut`, `periode_couverte.fin`, `evenements`, `pistes_non_verifiees`, `limites`), event (`type_evenement`, `date_publique`, `description`, `sources`, `contexte`, `retour_de_blessure`, `enjeu_du_match`, `precision`, `confiance`, `non_verifie`), source (`lien`, `media`, `titre`, `date_publication`), lead (`type_evenement`, `periode_approximative`, `description`, `raison`).
- English enumerated values: research confidence « haute, moyenne, faible »; return from injury « oui, non, inconnu »; game stakes « fort, normal, inconnu ».
- The English text of the research prompt, translated rule by rule under CL-BKT-02.
- English type identifiers used in the example: « approche-record », « conflit-joueurs », « humiliation-publique », « racisme-subi ».
- The reference prefix replacing « DEM ».
- Fixed phrases of the prompt: « non renseigné »; the player marker « premier match NBA le … » and « date du premier match NBA à établir »; the periods « du … au … inclus » and « de son premier match NBA au … inclus ».
- Labels and messages: « Demander un backtest », « compléter », « refaire », « Copier », « Partager », « mettre à jour », « réduire », « annuler »; states « à faire », « importée », « annulée »; kinds « initiale », « complément », « reprise complète »; origins « née d'une détection », « manuelle », « complémentaire »; the reason « joueur retiré »; « à venir » and « joué »; the stale-copy and stale-sheet-version warnings; the BKT-02 explanation; the "coverage complete, offer « refaire »" message; the reduction-refused message; "time TBD".
- The mention that a BKT-05 proposal waits for the player's request to do (CL-BKT-26).

## Ruled elsewhere

- Format of the exploration response (TAX-17, file 02): ruled by CL-TAX-04, which takes the conventions of format 1.0 and the reading rules of the import.
- The US date of a game, used here for season ends and the player marker (TRV-72, file 14): ruled by CL-TRV-03, its date in US Eastern time.
