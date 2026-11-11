# Clarifications — 02 Taxonomie des événements

Rulings on the unclear points of the French spec [`docs/02-taxonomie-des-evenements.md`](../../02-taxonomie-des-evenements.md), numbered `CL-TAX-nn`.
The decision records (`docs/adr/`, with the register `docs/engineering/spec-deviations.md`) and these rulings override the spec text where they say so; the French spec is authoritative everywhere else.

### CL-TAX-01 — Acceptance-criterion IDs

- **Affects:** the seventeen acceptance criteria of 02
- **Problem:** the criteria are numbered without IDs.
- **Ruling:** as ruled in planning: `CA-TAX-01` to `CA-TAX-17` in document order; each keeps the requirement IDs written in its parentheses.
- **Why:** one citation scheme for every file without IDs.
- **Owner review:** no

### CL-TAX-02 — Type identifiers in English, and identifiers of new types

- **Affects:** TAX-02, TAX-15, annex; record 0010
- **Problem:** the annex fixes French identifiers that never change once seeded, and TAX-02 does not say how the identifier of a new type is built.
- **Ruling:** the nine seeded types take the English identifiers the glossary maps from the annex; the French identifiers are never stored, shown or used, in prompts, fixtures or tests. A type created later gets its identifier when its proposal is created, from its English name: Unicode NFKD, diacritics removed, lowercase, every run of characters other than a–z and 0–9 replaced by one hyphen, leading and trailing hyphens removed, cut at a hyphen to at most 40 characters; if a type in any state already uses it, the smallest suffix `-2`, `-3`… that makes it unused is appended. The identifier never changes afterwards, even when the name does (TAX-02).
- **Why:** record 0010 makes identifiers English; a deterministic rule keeps them unique without the owner's input.
- **Owner review:** no

### CL-TAX-03 — Sheets and exploration in English

- **Affects:** TAX-01, TAX-16; record 0010
- **Problem:** sheets are "written in French" and the exploration prompt demands an answer in French.
- **Ruling:** as decided: sheets are written in English, in short sentences an AI can apply (TAX-01); the exploration prompt is English and demands an answer in English (TAX-16). The admitted sources stay English- and French-language public, dated press; illustration-source titles stay as published.
- **Why:** record 0010.
- **Owner review:** no

### CL-TAX-04 — Format of the exploration return

- **Affects:** TAX-16, TAX-17, CA-TAX-07, CA-TAX-08, CA-TAX-17, H-TAX-06
- **Problem:** TAX-17 lists the elements "in plain language" and defers the exact form to the conventions of 05, which define field names for the research result only; whether the description length cap applies is not said.
- **Ruling:** the exploration return is one JSON object with this shape:

  ```json
  {
    "format": "egoscope-exploration",
    "format_version": "1.0",
    "proposed_types": [
      {
        "name": "string, required",
        "definition": "string",
        "inclusion_criteria": "string",
        "exclusion_criteria": "string",
        "dating_rule": "string",
        "known_in_advance": false,
        "generic_example": "string",
        "documentation_difficulty": "easy | medium | hard",
        "possible_overlaps": ["string"],
        "illustration_sources": []
      }
    ]
  }
  ```

  - Conventions of the research-result format 1.0 (BKT-24, English form): UTF-8, field names exactly as above, lowercase enumerated values, an optional field omitted rather than empty, never `null`, straight quotes only. The version key is `format_version` with the value `1.0`, spelled as in the research-result format; every key above is the glossary's.
  - `proposed_types` is required and may be empty (the preview then says that no type was proposed, and nothing is created). In each item only `name` is required; any other missing element is flagged in the preview, and the proposal can be created incomplete but validated only once complete (TAX-17). `possible_overlaps` holds one sentence per possible overlap with an existing type. Each `illustration_sources` item is a source object exactly as the research-result format defines `sources[]`; one that fails the source checks of IMP-14 is dropped with a warning.
  - Text elements are not capped by the description length of DSN-20, which governs event descriptions; only the maximum pasted-text size (IMP-02) bounds the whole. The wording rules of 13 apply on reading (DSN-10) and the TAX-12 checklist covers the example; no automatic length or quotation-mark check runs on sheet texts.
  - Reading follows the research import: text around the object, code fences and invisible characters are ignored (IMP-04); a syntax error is reported with its approximate location; a cut return is refused, with the advice to ask for fewer types; an unknown version is refused, with the advice to regenerate the prompt; a missing `format` or version with a recognized structure is read with a warning (IMP-06); any other `format` value, `egoscope-backtest` included, is refused with "this text is not an exploration return" (CA-TAX-17); unknown fields are ignored, flagged once and never stored, and texts are shown as plain text (IMP-16).
  - The return names no target: in targeted mode, the screen where it is pasted gives the proposal it is compared with. The prompt gives this skeleton and these rules.
- **Why:** the minimum that carries every TAX-16 element, reusing the conventions and checks the import already has.
- **Owner review:** no

### CL-TAX-05 — Possible duplicates between types

- **Affects:** TAX-17 (preview), TAX-18 (proposals close to each other), 02 « Cas limites »
- **Problem:** "a name or a definition close to an existing type" has no operational definition.
- **Ruling:** a name is normalized by Unicode NFKD, removal of diacritics, lowercase, splitting on every character that is not a letter or a digit, then removal of one-letter words and of the words `a, an, the, of, to, in, on, at, by, for, with, from, and, or, his, her, its, their, player, players`. Two types are possible duplicates when one normalized word set contains the other, or when they share at least half of the words of the smaller set. The TAX-17 preview compares each proposed type with every type in any state and with the other proposals of the same return; the page of a detection proposal lists the proposals that are possible duplicates of it (TAX-18). Definitions are not compared automatically: for each flagged pair, the preview shows both definitions side by side.
- **Why:** a deterministic hint is enough, since the owner always decides; names are short enough to compare reliably, definitions are not.
- **Owner review:** no

### CL-TAX-06 — Versions versus the modification history

- **Affects:** TAX-20, TAX-21, TAX-22, TAX-23, TAX-26, 02 « Données manipulées » (Version de fiche)
- **Problem:** only substantive changes create a version, yet the version data list includes the qualification « forme ».
- **Ruling:** a validated type has a current sheet content, a list of versions and a modification history.
  - Version 1 is created at validation; each substantive modification creates the next version; a merge creates a version of the surviving type (TAX-27). A version stores its number, its date, the full content at that moment, its qualification (validation; substantive, broadening, narrowing or both; merge), its reason and its effect counts (TAX-26).
  - A formal modification changes the current content without creating a version: prompts and classification then send the current content under the current version number.
  - The modification history (TAX-21) records every saved change of a validated sheet — formal, substantive, and the switch of CL-TAX-17 — with its date, the content before and after, its qualification and its reason. The « forme » value belongs to the history, never to a version.
- **Why:** TAX-22 is explicit that only substantive changes make versions; the data list merely lists every qualification value.
- **Owner review:** no

### CL-TAX-07 — "Both", and the version of a requalified event

- **Affects:** TAX-22, TAX-24, TAX-25, TAX-26, CA-TAX-12, SEN-46
- **Problem:** "both" is allowed but TAX-24 and TAX-25 are not said to apply together, and nothing says which version a requalified event takes.
- **Ruling:** a change qualified "both" applies TAX-24 and TAX-25 together: supplements are proposed (BKT-05), the profiles are marked incomplete until imported, and every event qualified under an earlier version is marked "to requalify". A broadening alone marks no event: existing events keep their version. Requalification outcomes: "conforms" gives the event the type's current version; "reassigned" gives it the target type and that type's current version; "does not conform" erases it (CL-TAX-09). The number of cases "on an earlier version" that profiles show is the number of the type's events marked "to requalify": ten right after the narrowing of CA-TAX-12, zero once all are requalified.
- **Why:** a narrowed type may exclude old events, a broadened one cannot; the count must fall as the owner works through the list.
- **Owner review:** no

### CL-TAX-08 — A merge whose sheet does not cover the union

- **Affects:** TAX-27, TAX-23, IMP-30
- **Problem:** in the "no" case, attached events keep a version of the absorbed type's sheet, and the surviving type's own events are not addressed.
- **Ruling:** an event's qualification is a pair (sheet type, version number), which may name a version of another type's sheet, such as an absorbed one. After a merge, every event of the surviving type — its own and the attached ones — is treated alike: if the merged sheet covers at least the union, all take the merged version, and TAX-24 also applies when it covers more; if not, all are marked "to requalify" against the merged version (TAX-25).
- **Why:** a merged sheet that is not a superset may exclude facts of either side.
- **Owner review:** no

### CL-TAX-09 — Erasures by requalification or split

- **Affects:** TAX-25, TAX-26, TAX-29, DSN-27, DSN-29
- **Problem:** TAX-29 lets the owner erase events that fit no new type, without saying where that erasure is counted or what it erases.
- **Ruling:** an event found "does not conform" (TAX-25) or fitting none of the types of a split (TAX-29) is erased with the scope of a withdrawal (DSN-27), with no fingerprint and no change of the global counter. The erasure is counted on the sheet: a requalification erasure in the new version's "erased" count, a split erasure in the last version of the split type, shown on that type's sheet (TAX-26). Journal references to the event then read "an item that no longer exists" (CL-TRV-10).
- **Why:** TAX-25 gives the model; a fingerprint exists only for sensitivity withdrawals (record 0017).
- **Owner review:** no

### CL-TAX-10 — Content of the do-not-repropose list

- **Affects:** TAX-11, TAX-16, TAX-18, CA-TAX-06, DET-14
- **Problem:** TAX-11 reduces entries to name and definition, while TAX-16 and CA-TAX-06 require rejected types with their reason.
- **Ruling:** as written, the specific rule winning over the general one: the classification receives name and definition of each entry (TAX-18, DET-14); the exploration prompt receives name and definition of each entry plus, for a rejected type, its rejection reason from the closed list of TAX-13, never the owner's comment. Calendar-derived types are not in this list (CL-TAX-21).
- **Why:** the reason helps an exploration avoid re-proposing; the classifier only needs to recognize the fact.
- **Owner review:** no

### CL-TAX-11 — Withdrawal reason, rejection comment, reactivation

- **Affects:** TAX-13, TAX-31, TAX-32
- **Problem:** TAX-31 requires a reason without a list, and does not say whether a reactivation creates a version.
- **Ruling:** withdrawing a type requires a reason typed by the owner, from 1 to the description length of DSN-20 in characters, subject to the wording rules of 13 (DSN-10); a merge or a split writes its own ("merged into <name>", "split into <names>"). The rejection comment is optional, with the same bound. A reactivation creates no version: the checklist is confirmed again on the current content, and an edit made then is a modification under TAX-21 and TAX-22.
- **Why:** withdrawals are rare and varied, so free text suffices; reactivating changes no fact of the type.
- **Owner review:** no

### CL-TAX-12 — The birthday type without a date of birth

- **Affects:** annex « Anniversaire du joueur », JOU-11, Q-TAX-01
- **Problem:** the birthday criterion cannot be checked by the application while no birth date is stored.
- **Ruling:** settled by record 0015: the day and month of birth are stored (CL-JOU-16) and birthday events are derived from the calendar (CL-TAX-18); the draft drops the press-article criterion.
- **Why:** owner decision.
- **Owner review:** no

### CL-TAX-13 — The bereavement type versus the private-life ban

- **Affects:** TAX-09, annex « Mort d'un proche », DSN-12, DSN-14
- **Problem:** TAX-09 forbids types about the player's private life, yet a bereavement type is admitted.
- **Ruling:** as written: DSN-14 makes the fact of a bereavement the only admitted exception, described within DSN-12 (no name, kinship, cause, circumstances or funeral); the type sheet carries the "intimate subject" mention (TAX-01).
- **Why:** 13 owns the boundary and states the exception.
- **Owner review:** no

### CL-TAX-14 — The coverage threshold of a media storm

- **Affects:** annex « Tourmente médiatique », TAX-01, TAX-33, TRV-38
- **Problem:** the media-storm date is the article that crosses a coverage threshold, a value TRV-38 says is set in the sheet, but the sheet has no field the application can apply.
- **Ruling:** a sheet may carry an optional coverage threshold: a minimum number of distinct outlets (integer 2 to 10) within a window (integer 1 to 7 days), used only by a type whose dating rule refers to it. The media-storm draft sets 3 outlets within 2 days, values the owner confirms or changes at validation. When it is set, the sentence "Coverage threshold: N distinct outlets within D days." is appended to the dating rule wherever the sheet is sent (research prompt, classification), so the text and the value cannot differ.
- **Why:** detection needs numbers to date such events (04); TRV-38 already places the values in the sheet.
- **Owner review:** no

### CL-TAX-15 — « Statut particulier » and the former-team variant

- **Affects:** annex « Match contre l'ancienne équipe », TAX-01, TAX-15
- **Problem:** the draft carries a « Statut particulier » line and an open variant (first meeting or every meeting), neither of which is a sheet field.
- **Ruling:** « Statut particulier » is not a field and is not seeded: the type is seeded like the other candidates, proposed, origin scoping. The variant is settled: only the first meeting after a departure counts (record 0015, CL-TAX-18).
- **Why:** the owner has since decided how the type works; validating it remains the owner's act (D-12).
- **Owner review:** no

### CL-TAX-16 — Illustration sources

- **Affects:** TAX-03, TAX-17, DSN-08, DSN-09
- **Problem:** real examples (link, outlet, title, date) are kept "apart" and "only serve to judge the proposal", with no retention stated, and their titles name real people.
- **Ruling:** illustration sources are stored with the proposal they support: link, outlet, title as published (DSN-08) and publication date, after the source checks of IMP-14. They are shown only on the proposal's page and are never sent to the research prompt or the classification. They are erased when the proposal is validated or rejected; a reopened type (TAX-14) has none until a new exploration brings some.
- **Why:** they have no use after the decision, and when in doubt the application stores less.
- **Owner review:** yes — the real examples behind a type disappear once the owner validates or rejects it.

### CL-TAX-17 — The per-type switch of one doubtful-case criterion

- **Affects:** TAX-01, TAX-21, TAX-22, TRV-35, IHM-51; record 0016
- **Problem:** record 0016 adds the switch; the sheet must say what it holds and how a change is recorded.
- **Ruling:** the sheet has an optional field, "criterion switched off", empty by default (seeds included), naming at most one of: playing time too low (SEN-12), return from injury (SEN-13), unusual stakes (SEN-14), opponent level (SEN-15), concomitance (SEN-06, offered only while its parameter is on). While it names a criterion, that criterion is not applied to the type's cases, and the type's profiles and trend carry the permanent warning of record 0016. A change of the field is recorded in the modification history with before and after (CL-TAX-06), creates no version, triggers a full recalculation whose verdict changes carry the cause "parameter change" (SEN-37), is written to the journal, and updates the date of the last change that affects calculations (CL-TRV-17).
- **Why:** record 0016.
- **Owner review:** no

### CL-TAX-18 — Which games the calendar derivation turns into events

- **Affects:** Q-TAX-01, annex « Anniversaire du joueur » and « Match contre l'ancienne équipe », TAX-05; record 0015
- **Problem:** record 0015 makes the application create these events itself; the exact games must be fixed.
- **Ruling:** for each validated calendar-derived type and each active or paused player with a confirmed mapping (CL-JOU-05), over the official games (STA-04) of covered seasons:
  - **birthday:** every official game of the player's team whose day (CL-TRV-03, which also stands for the local date at the venue) has his recorded day and month of birth (29 February: CL-JOU-17); a player without a recorded birthday has none (CL-JOU-16);
  - **former team:** for each stint of the player with a former team (CL-JOU-18), the first official game between his team and that team after his last game played for it, while he belongs to another team; one event per stint, later meetings never count.

  "His team" at a game is the team he belonged to at that date, as 07 establishes for the missed-games count; whether he played is not part of the condition, and if he did not play, the case is non-measurable (record 0015). Each qualifying game gives one event of the type, and that game is its measured game.
- **Why:** record 0015 and its rejected alternatives (every meeting, sliding to the next game).
- **Owner review:** yes — games the player misses still create cases, non-measurable ones, and every birthday game and first reunion counts, with or without press coverage.

### CL-TAX-19 — When the derivation runs, upcoming events, and changes

- **Affects:** Q-TAX-01, TAX-20, TAX-24, TAX-32, STA-26, STA-28, SUI-03; record 0015; register open point "When an upcoming calendar-derived event is created"; CL-SUI-14
- **Problem:** nothing says when the application derives these events, nor what happens when the schedule, the player's team or his birthday changes.
- **Ruling:** the derivation is a Lot 1 function; this ruling owns its timing, which CL-SUI-14 applies to the Lot 2 flow.
  - **Regular runs**, at the end of every statistics update and, in Lot 2, of every collection-and-detection pass, for each active or paused player with a confirmed mapping and each validated calendar-derived type: every qualifying game (CL-TAX-18) that started since the player's previous run, and his next game (STA-26) if it qualifies, gets an event when it has none, once the fingerprints are checked (CL-DSN-06). Each player keeps the instant of his previous run, so a player withdrawn then reactivated gets the games of the gap at the next run.
  - Every regular run re-checks the upcoming events: before tip-off, one whose game no longer qualifies — date or opponent changed, game canceled, player no longer with that team, birthday or team history corrected — is deleted with its case (CL-SUI-14). A game that still qualifies after a change of time stays the event's game.
  - When a season of a player's history is stored for the first time, its qualifying games get events, with the same fingerprint check.
  - **Full derivations** cover every game already started in covered seasons: they create the missing events, fingerprints checked, and delete the events whose game no longer qualifies. They run at the validation, the reactivation and the substantive change of a calendar-derived type, for every eligible player; and for one player, at a change of his day and month of birth (birthday type), of his statistics mapping, or at a box-score correction that changes his team history (former-team type). Upcoming events always come from the regular runs (CL-SUI-14).
  - A deletion by the derivation is not a withdrawal: no fingerprint, no counter. Each creation and deletion is written to the journal, and an event whose game had already started also counts among its profile's exits, as a number without date or game (CL-SEN-25).
  - A withdrawn player's events are neither created nor deleted while he stays withdrawn (CL-JOU-05); a withdrawn type keeps its events and gets no new one (CL-TAX-20).
- **Why:** creating upcoming events at the next-game stage keeps alerts timely and spares churn from schedule changes (recommended handling of record 0015, which CL-SUI-14 applies in Lot 2); regular runs never revisit a game already derived, so they cannot bring back an event the owner withdrew (CL-DSN-09), while full derivations apply corrections and the first fetch of a season adds its games.
- **Owner review:** yes — upcoming calendar events appear a day or so before their game and may vanish before tip-off if the game moves.

### CL-TAX-20 — Calendar-derived types in the type lifecycle

- **Affects:** TAX-10 to TAX-12, TAX-20 to TAX-32; record 0015
- **Problem:** the lifecycle rules were written for researched types.
- **Ruling:**
  - The two seeded calendar-derived types are the only ones: the "derived from the calendar" mark of their dating rule is fixed at seeding, cannot be removed from them and cannot be given to another type; the `known_in_advance` element of an exploration return sets only the "known in advance" mark of SEN-02.
  - Validation uses the TAX-12 checklist with the item "established by the schedule" (register row TAX-12); no supplementary request is proposed (TAX-20); the derivation runs (CL-TAX-19).
  - A formal change only rewrites the sheet. A substantive change creates a version and re-runs the derivation, which gives every event of the type the new version; nothing is "to requalify", because the derivation rule of record 0015 does not depend on the sheet's wording.
  - These types take part in no merge and no split: the screens do not offer them.
  - Withdrawal (TAX-31) stops the derivation from creating events of the type. No event is erased: its existing events and cases, upcoming ones included, are kept; a pending case is still measured and counts only in the type's archived profiles and trend (TAX-31, SEN-19), and it feeds no alert sheet. No ruling deletes an event because its type is withdrawn (CL-SUI-14 included). Reactivation (TAX-32) runs a full derivation, which creates every qualifying event missed meanwhile.
  - Their events can be withdrawn like any event but are never dismissed (CL-DSN-09, CL-SUI-14).
- **Why:** the derivation, not the sheet text, decides which games are events; merging a derived type with a researched one would mix two kinds of evidence.
- **Owner review:** no

### CL-TAX-21 — Articles that report a birthday or a reunion

- **Affects:** TAX-18, DET-14, DET-16, DET-34; register open point "Articles that report a birthday or a reunion"
- **Problem:** the classifier does not receive calendar-derived types, so an article about a birthday could become a new-type proposal.
- **Ruling:** as ruled for detection (CL-DET-22): in Lot 2 the classification receives, besides the validated types and the do-not-repropose list, a list of types "handled by the calendar": name and definition of every type whose dating rule says "derived from the calendar", whatever its state; such types are never in the do-not-repropose list. A fact the model reports against an entry of that list gives no event, no proposal and no occurrence; one it reports as a new-type proposal without naming that entry goes through DET-34 like any other (CL-DET-22).
- **Why:** these facts are covered by the derivation once the type is validated, and must not become proposals before; recommended handling of record 0015.
- **Owner review:** no

### CL-TAX-22 — The sheet version an event keeps

- **Affects:** TAX-23, TAX-27, TAX-29, TAX-30, DET-47, DET-53, IMP-30, IMP-32
- **Problem:** TAX-23 names the version in force at detection or in the request's prompt, while DET-53 also replaces it at each correction of the event's type.
- **Ruling:** an event keeps the version in force when it was created — at its detection (04), in the prompt of the request that brought it (05, IMP-30), or at its derivation for a calendar-derived event — replaced by the type's version in force at each later correction of its type (DET-47 for a detected event, IMP-32 for a historical one), at a requalification or a reassignment (CL-TAX-07), at a merge whose sheet covers the union (CL-TAX-08), at its distribution after a split (TAX-29: the chosen type's version in force at distribution), and, for a calendar-derived event, at the full derivation that follows a substantive change (CL-TAX-20). An event imported after a merge or a split takes the version CL-IMP-21 gives it.
- **Why:** DET-53 and TAX-23 agree (CL-DET-17); naming every case keeps one reading.
- **Owner review:** no

## Ruled elsewhere

- **Dating a media storm in detection** — owned by 04: ruled by CL-DET-27 (the event is created only when the grouped articles reach the sheet's coverage threshold, CL-TAX-14, in distinct outlets within its window; the reference instant is that of the article that reaches it).
- **One event per record** (« approche-record ») — owned by 04: ruled by CL-DET-28 (the sheet's exclusion criterion and the recent events sent to the classifier, DET-14; no record tracking in the application).
- **"Proposes" versus "creates" a supplementary request** — owned by 05: ruled by CL-BKT-25 (BKT-05 proposes, nothing is created without agreement).
- **What a dropped calendar-derived event leaves in its profile** — owned by 08 (SEN-33): ruled by CL-SEN-25 (an event whose game had started counts among the exits, as a number only).
- **Already settled consistently by the rulings on Lot 2:** the fate of a fact handled by the calendar (dropped, CL-DET-22), the version kept at a type correction (CL-DET-17), and an upcoming calendar-derived event deleted before tip-off — its sheet canceled when no other event remains (CL-ALE-13), its tracked case never counted (CL-SUI-14), no message after the owner's own change (CL-TEL-21). A withdrawn type keeps its events, upcoming ones included (CL-TAX-20, TAX-31).

## Passed to the glossary

- English identifiers and names of the nine seeded types, and the English text of their drafts.
- Type states; rejection reasons; qualifications (formal; substantive: broadening, narrowing, both); marks "to requalify" and "to distribute".
- Automatic reasons "merged into …" and "split into …"; documentation difficulty values.
- The TAX-12 checklist items, including "established by the schedule".
- The marks "derived from the calendar", "known in advance", "handled by the calendar".
- The exploration format's key and value spellings, which CL-TAX-04 takes from the glossary (`format_version`, `possible_overlaps` among them; the shape of CL-TAX-04 stays), and the message "this text is not an exploration return".
- The coverage-threshold sentence of CL-TAX-14.
