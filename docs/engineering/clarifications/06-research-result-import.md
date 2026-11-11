# Clarifications — 06 Research result import

Rulings on the unclear points of the French spec `docs/06-import-des-resultats-de-recherche.md`.
The decision records (`docs/adr/`, `docs/engineering/spec-deviations.md`) and these rulings override the spec text where they say so; the French spec is authoritative everywhere else.

### CL-IMP-01 — Acceptance-criterion IDs

- **Affects:** the 29 acceptance criteria of 06
- **Problem:** the criteria are numbered 1 to 29 with requirement IDs, but carry no `CA-` ID.
- **Ruling:** As decided (decisions, "Acceptance-criterion IDs"): `CA-IMP-01` to `CA-IMP-29` in document order; `CA-IMP-nn` is the criterion numbered nn, cited `06 AC-nn` in the deviations register. Each test names its `CA-IMP` ID and the requirement IDs printed in the criterion.
- **Why:** one citation scheme for every spec file.
- **Owner review:** no

### CL-IMP-02 — Error messages: English, location, problem, fix

- **Affects:** IMP-20, IMP-04 to IMP-17, IHM-29, CA-IMP-06, CA-IMP-07, CA-IMP-08
- **Problem:** IMP-20 requires plain French and a location by rank, type and date, while one of its own examples (« 7e événement : … ») omits the type and the date.
- **Ruling:**
  - Every import message is plain English (ADR 0010), in three parts: location, what is wrong, how to fix it.
  - Location is "the whole result", or the event by its rank, its type as read and its date as read. The rank is its 1-based position in the events list as pasted, every element counted, rejected and ignored ones included. A missing or unreadable type or date is shown with the glossary's placeholder. A source adds its own 1-based position in the event's sources; a lead or a limitation is located by its position in its list.
  - Messages quote dates, identifiers and links as read, never a description or another free text; a length problem gives the length and the maximum instead.
  - The requirement wins over the example: the « 7e événement » message also gives the type and the date. The glossary renders the French examples in this structure.
- **Why:** IMP-20 asks for the rank, type and date; not quoting free texts keeps messages short and sensitive wording out of them.
- **Owner review:** no

### CL-IMP-03 — Statistics and score heuristic in English

- **Affects:** IMP-13, register row IMP-13
- **Problem:** the heuristic looks for numbers followed by « points », « rebonds » or « passes », French words that English descriptions do not use.
- **Ruling:** A description, or a reservation (`unverified_note`, the spec's `non_verifie`, stored like it), gets the warning "may contain statistics or a score" when, ignoring case, it contains:
  1. a number written in digits (decimals allowed), followed after an optional space or hyphen by one of: point, points, pt, pts, rebound, rebounds, reb, rebs, assist, assists, ast, steal, steals, stl, block, blocks, blk, turnover, turnovers, tov, minute, minutes, min, field goal, field goals, free throw, free throws, three-pointer, three-pointers, pointer, pointers, threes;
  2. the word double-double or triple-double;
  3. a score: two numbers of two or three digits joined by a hyphen or a dash, such as 102-98 or 99–101 (a season such as 2023-24 does not match).
  - The warning never rejects (IMP-13); the event becomes "added with warning". The word list lives in one constant, covered by tests.
- **Why:** ADR 0010 makes heuristics follow the language of the text; the list renders the spec's examples and the score half of its rule.
- **Owner review:** no

### CL-IMP-04 — Template of the correction message for the research AI

- **Affects:** IMP-21, IMP-35, IHM-43, CA-IMP-24, register row IMP-21
- **Problem:** IMP-21 lists the message's contents but gives no template, and the message must now be English.
- **Ruling:** The message is composed only when the result is refused, cut, or holds rejected events, from this fixed structure (the reference wording below may be adjusted by the glossary, never its content or order):
  1. Title: "Correction request for an Egoscope backtest result".
  2. "Request reference: {reference}. Format version: 1.0."
  3. "The result you returned cannot be imported as it is. Correct the problems listed below and send back the complete corrected result: one JSON object in one piece, with no text before or after it, no code fence and no citation marker. Keep the other events unchanged. Invent nothing: a fact you cannot support with a dated public press article published before the next NBA game the player played goes in the unverified leads, never in the events."
  4. For a cut result: "Your answer stopped before the end of the JSON object{, during event {rank}}. Send the whole result again. If it does not fit in one answer, process the period in chronological order, stop at the end of a complete season and set the end of the covered period to the last day you actually covered; the rest will be requested separately."
  5. "Problems to correct:", then one numbered line per problem: whole-result problems first, then rejected events by rank, then, within an event, by field in the order of the format. Each line gives the location of CL-IMP-02, the field (its format 1.0 key), what is wrong and the expected correction, from a fixed table with one expected-correction text per rejection reason (IMP-11 to IMP-14).
  - Warnings and ignored events are never listed: they are not defects the AI is asked to fix. The message quotes no description or other free text (CL-IMP-02). It is English, carries the English keys of format 1.0 and is never stored (« Ce qui n'est pas conservé »).
- **Why:** gives every content item of IMP-21 a fixed place, so that the message is testable and identical across builds.
- **Owner review:** no

### CL-IMP-05 — Quotation marks and apostrophes

- **Affects:** IMP-13, IMP-15, DSN-10, DSN-21, DSN-24, CA-IMP-24; CL-DSN-03 (file 13 ruling)
- **Problem:** IMP-13 rejects a description containing "straight or typographic quotation marks", but English and French text is full of apostrophes, and the typographic apostrophe is the same character as the right single quotation mark.
- **Ruling:**
  - The check is the one file 13 defines (CL-DSN-03), applied as it is: a text fails when it contains one of the quotation-mark characters CL-DSN-03 lists, and only then; an apostrophe, straight or typographic, always passes ("player's", "players' union", "l'équipe"), and no single-quoted span is looked for.
  - A description that fails is rejected (IMP-13), and the message names the character found.
  - A reservation (`unverified_note`) or a limitation that fails is ignored with a warning, like a too-long one (IMP-15), because both are stored and DSN-10 subjects them to the same wording rules. Precisions and leads are not checked, since they are never stored; titles never are (DSN-08).
- **Why:** one check for every stored text, whoever writes it; file 13 owns the wording rules.
- **Owner review:** no

### CL-IMP-06 — Research-AI output quirks: what the import strips, rejects and flags

- **Affects:** IMP-04, IMP-05, IMP-06, IMP-09, IMP-12, IMP-15, IMP-16, IMP-19, BKT-25, BKT-26, register rows IMP-04 and IMP-05, ADR 0013
- **Problem:** the owner decided that the import is tested against the usual output quirks of research AIs (ADR 0013), but the spec says only that the import ignores surrounding text, code fences and invisible characters and corrects nothing else.
- **Ruling:** The import handles each quirk as below and nothing else; each row has a fixture in the import's tests (ADR 0013).

  | Quirk | What the import does |
  | --- | --- |
  | Introduction, report, conclusion or source list around the JSON | Stripped (IMP-04). |
  | Code-fence lines (three or more backticks or tildes, with or without a language tag) | Stripped. |
  | Invisible characters U+FEFF, U+200B, U+200C, U+200D, U+2060, anywhere in the text | Stripped. |
  | No-break spaces and other Unicode spaces between JSON tokens | Read as whitespace. |
  | The same JSON object twice (in a report and again at the end) | Copies equal value for value count as one. |
  | Several different objects with format `egoscope-backtest` | Refused: paste only one (IMP-04). |
  | A citation marker between JSON tokens, such as `"…" [3],` | Not stripped: syntax error with its approximate location, whole result refused, correction message (ADR 0013). |
  | Curly quotes as string delimiters, trailing commas, comments | Not repaired: syntax error, as above. |
  | A citation marker inside a text value | Not stripped; flagged (CL-IMP-07). |
  | Answer cut in the middle of an event or of a string | Recovered under IMP-05 when it allows (CL-IMP-18); otherwise refused with the cut message and the correction message. |
  | `null` or an empty string for an optional field | Treated as absent, without a warning. |
  | `null` or an empty string for a required field | Treated as missing: that field's own rule applies (rejection, or default value with a warning). |
  | Enumerated values or identifiers in another case, with accents or surrounding spaces | Accepted (CL-IMP-22). |
  | `format_version` written `1`, or as the number 1 or 1.0 | Read as version 1.0, with a warning. |
  | `format` or `format_version` missing, structure recognized | Warning, version 1.0 assumed (IMP-06). The structure is recognized when the object has the keys of the covered types, the covered period and the events. |
  | Date written with `Z`, seconds, a compact offset or a space instead of `T`; date-time without offset; time 00:00 | CL-IMP-08. |
  | Keys renamed by the AI (camel case, French keys) | Unknown fields, ignored and never saved (IMP-16); the rules of the missing required fields apply. |
- **Why:** each row either applies a rule the spec already states or settles an unambiguous form; nothing that would change meaning is repaired.
- **Owner review:** no

### CL-IMP-07 — Citation markers inside text values

- **Affects:** IMP-04, IMP-19, IMP-14, register row IMP-04, ADR 0013 open point
- **Problem:** a marker left inside a description, a title or another text value passes every check of the spec and would be stored.
- **Ruling:**
  - A text value contains a citation marker when it matches one of: a bracketed number list (`[1]`, `[2, 5]`, `[3–4]`); a footnote call `[^…]`; a bracketed token starting with `cite` (`[cite_start]`, `[cite: 1]`); any text between `【` and `】`; a superscript digit (U+00B9, U+00B2, U+00B3, U+2070, U+2074 to U+2079); a dagger `†` or `‡`; a private-use character (U+E000 to U+F8FF); a Markdown link `[text](http…)`. The patterns live in one constant, each with a fixture.
  - In a description, a reservation, an outlet name or an article title: the value is stored as written, never rewritten, and the event gets the warning "possible citation marker in {field}", so its outcome is "added with warning" if nothing else rejects it (IMP-19). The owner can correct it (IMP-32).
  - In a limitation: kept as written, with a whole-result warning.
  - In a link: the link fails the complete-address check (IMP-14, CL-IMP-15) because of the space or brackets, and the source is dropped with a warning.
  - Precisions and leads are not checked, since they are never stored.
- **Why:** ADR 0013's recommended handling: a visible warning, never a silent rewrite.
- **Owner review:** no

### CL-IMP-08 — Date values: accepted variants and cautious readings

- **Affects:** IMP-09 (`periode_couverte`), IMP-12, IMP-14, IMP-18, « Données manipulées » of 05 (dates), CL-BKT-16
- **Problem:** the format admits only `YYYY-MM-DD` and `YYYY-MM-DDTHH:MM±HH:MM` and IMP-12 rejects everything else, while research AIs often write `Z`, seconds, or a time without offset, or turn a date into a midnight time.
- **Ruling:**
  - Accepted as written: `YYYY-MM-DD`; `YYYY-MM-DDTHH:MM±HH:MM`.
  - Accepted with a warning "date written in a non-standard form", meaning unchanged: the offset `Z` (+00:00); an offset without colon (`±HHMM`) or with hours only (`±HH`); seconds and fractional seconds, kept in the instant; a space instead of `T`; lowercase `t` or `z`.
  - Read as a date only, its date part as written, with a warning "time ignored": a date-time without any offset; a date-time whose time is exactly 00:00 (seconds zero), whatever its offset.
  - Anything else — other field orders, month names, missing parts, impossible dates such as 2021-02-30 — keeps the spec's outcome: the event is rejected for a public date (IMP-12), the source is dropped for a publication date (IMP-14), the whole result is refused for the covered period (IMP-09).
  - A covered-period bound written with a time keeps its date part as written, with a whole-result warning.
- **Why:** `Z`, seconds and compact offsets are unambiguous, so accepting them keeps measurements exact and spares a correction round. A time without offset, or a midnight that stands for "no time", would make a fact look earlier than it was; reading them as dates applies the cautious date rules (SEN-01, IMP-18, TRV-73).
- **Owner review:** yes — the import accepts date forms the spec rejects, and treats any midnight time from the AI as "time unknown", which can move a case to a later game.

### CL-IMP-09 — Calendar date of a value; periods tested per type

- **Affects:** IMP-05, IMP-10, IMP-12, IMP-29, IMP-32
- **Problem:** the import tests dates against periods without saying which calendar date a date-time has, and IMP-12's "requested period" does not say whether it is the request's overall period or the event type's own period.
- **Ruling:**
  - The calendar date of an imported value is its date part as written; for a date-time, that is its local date in its own offset. Public dates and source dates are stored as that calendar date plus, when timed, the absolute instant and the original offset (decisions, "Representation of time"; TRV-68).
  - Every "inside a period" test of the import (requested, declared, retained coverage, replacement, career up to today) compares calendar dates, bounds included.
  - IMP-12's requested period is that of the event's own type: an event of type A dated outside A's requested period is ignored, even inside another requested type's period.
  - "Before the player's first NBA game" means a calendar date earlier than the US date of that game (STA-47); an event dated on that day is kept.
- **Why:** the AI dates facts by calendar day. The type blocks of the prompt give each type its own period and rule 2.10 tells the AI to ignore facts outside it; a fact found outside its type's systematic search would favor the striking stories D-32 warns about, and it would not match the coverage.
- **Owner review:** yes — an event of a requested type found outside that type's requested period is ignored, even when it lies inside the request's overall period.

### CL-IMP-10 — "Published after the import day"

- **Affects:** IMP-14, IMP-32, TRV-72
- **Problem:** IMP-14 drops a source published "after the import day" without saying in which time zone the day is taken.
- **Ruling:** A source date is in the future, and the source is dropped with a warning, when it is a date-time later than the import's instant, or a date later than the date of the import's instant in the zone UTC+14, the latest calendar date anywhere at that instant. For a manual correction (IMP-32), the correction's instant replaces the import's.
- **Why:** drops only dates that cannot have happened yet in any zone.
- **Owner review:** no

### CL-IMP-11 — A source more than one day before the public date

- **Affects:** IMP-14, H-IMP-02, CA-IMP-08
- **Problem:** the one-day tolerance has no rule for values with and without a time.
- **Ruling:** The import takes the smallest lead the two values allow. When both have a time, it is the difference between instants. Otherwise it is counted in calendar days, a timed value standing for every calendar date it has in a zone from UTC−12 to UTC+14, as in CL-IMP-12. The event is rejected when that smallest lead exceeds the parameter: more than 24 hours between two instants, more than 1 calendar day otherwise. `CA-IMP-08` (five days) and the « 9e événement » example (three days) are rejections; a date-only source dated the day before a date-only public date is accepted.
- **Why:** "for absorbing time-zone offsets" (H-IMP-02) is honored by taking the smallest possible lead.
- **Owner review:** no

### CL-IMP-12 — Distance between public dates when matching events

- **Affects:** IMP-25, IMP-26, DET-58, TRV-73, CA-IMP-13, CA-IMP-26
- **Problem:** "the smallest distance the possible time zones allow" does not define the possible zones, nor how two dates without time compare.
- **Ruling:**
  - Both values with a time: the distance is the difference between instants; the two are within the window when it is at most 2 days (48 hours, the IMP-25 parameter).
  - Otherwise the comparison is in calendar days. A date-only value is its date. A timed value — a historical date-time, or a detected event's reference date, which is always an instant (DET-30) — stands for every calendar date it has in some zone from UTC−12 to UTC+14: two or three consecutive dates. The distance is 0 when the sets share a date, else the number of days between their nearest dates; within the window when at most 2.
  - Hence two date-only values match when at most 2 calendar days apart (`CA-IMP-13`: 14 and 15 January), and `CA-IMP-26` holds (a reference date on 1 March and a public date of 2 March).
  - The 2 days are the single window parameter of CL-IMP-34.
- **Why:** where a time is missing, every zone is allowed for the timed side, so no match is missed. Spreading a date-only day over 50 hours of absolute time on both sides would stretch the 2-day window to 4 calendar days and, since a duplicate is not added by default (IMP-26), silently drop distinct facts (H-01).
- **Owner review:** yes — this fixes how wide "2 days apart" is in practice; a wider reading would merge more distinct facts by default.

### CL-IMP-13 — A shared link between events of different types

- **Affects:** IMP-17, IMP-25, IMP-26, TAX-06
- **Problem:** IMP-25 makes two events match when they cite a same link, whatever their types, so one article reporting two facts (allowed by TAX-06) would lose one of them by default.
- **Ruling:** A match, handled as a duplicate (IMP-26, IMP-27), needs the same type: same type with public dates within the window, or same type with a common link. Two events of different types that share a link or have public dates within the window are a possible duplicate when one of them is already saved (the owner decides, saving waits), and are both added, with IMP-17's same-link warning, when both come from the result being imported.
- **Why:** TAX-06 lets one article report two distinct facts; the owner still sees every close pair.
- **Owner review:** yes — two events of different types citing the same article are no longer merged automatically; the owner is asked instead.

### CL-IMP-14 — Comparing links; the cleaning of COL-28 is built in lot 1

- **Affects:** IMP-25, COL-28
- **Problem:** IMP-25 (lot 1) compares links after the tracking-element cleaning of COL-28, a lot-2 requirement.
- **Ruling:** The link cleaning of COL-28 is built in lot 1, in one shared module that lot 2's collection reuses; the list of tracking elements belongs to file 03. Two links are equal when they are identical after that cleaning, with scheme and host in lowercase and a default port (80, 443) and the fragment removed; the path and the remaining query are compared exactly, as CL-COL-18 compares feed addresses. Nothing else is normalized: `http` and `https` differ, a `www.` prefix makes a different host, a trailing slash makes a different path.
- **Why:** lot 1 needs the comparison; one module and one normalization avoid two cleaning rules.
- **Owner review:** no

### CL-IMP-15 — What a "home page" is

- **Affects:** IMP-14, CA-IMP-07
- **Problem:** IMP-14 drops a link that designates a home page, without an operational definition.
- **Ruling:** After the CL-IMP-14 cleaning, a link is a home page when its path is empty, `/`, `/index.html`, `/index.htm` or `/index.php` (any case) and it has no query. Any other path, or any query (such as `/?p=1234`), passes. Search pages and section pages are not detected. The rest of IMP-14's address check is unchanged: it starts with `https://` or `http://`, has a domain name and no space.
- **Why:** a definition that never rejects a real article address.
- **Owner review:** no

### CL-IMP-16 — Order of sources, and which ones are "the oldest"

- **Affects:** IMP-14, IMP-26, format `sources` of 05
- **Problem:** "keep the oldest" sources has no rule for sources with and without a time on the same day.
- **Ruling:** Sources are ordered by calendar date (CL-IMP-09); on the same date, a source with a time comes before one without, and timed sources come by instant; full ties keep the list order. Keeping the oldest — beyond the maximum number of sources (IMP-14), or when sources are added to an existing event (IMP-26) — keeps the first ones in that order.
- **Why:** a timed source on a game day carries more information for precedence (IMP-18) than an undated one.
- **Owner review:** no

### CL-IMP-17 — Precedence over the game with mixed precision

- **Affects:** IMP-18, IMP-26, IMP-32, SEN-44, CA-IMP-09, CA-IMP-10, CA-IMP-29
- **Problem:** IMP-18 compares "the oldest source" with the game, while a source dated the game day without a time cannot be ordered against a timed one, and the day of a date-only source has no time zone.
- **Ruling:**
  - Inputs: the event's sources, and the measured game G of SEN-01 to SEN-03 before any shift (CL-SEN-05), with its scheduled start K and its US date U (TRV-72).
  - A source precedes G when it has a time and its instant is before K, or when it is date-only and its date is before U. It is "same-day undated" when it is date-only and its date is U.
  - Classification uses every source, in this order: « établie » if at least one source precedes G; otherwise « incertaine » if at least one is same-day undated; otherwise « non établie ».
  - The result is computable as soon as a source precedes the first official game of the player's teams after the reference instant (it then precedes G, whatever G turns out to be), or once G is known. Until then the event is « à vérifier ».
  - It is recomputed whenever the sources, the public date, the schedule or the player's participation in a game changes.
- **Why:** follows IMP-18's three rules with one test per source; comparing a date-only source with the game's US date is how IMP-18's "game day" reads under TRV-72, and the shortcut only spares the owner a « à vérifier » that can only end « établie ».
- **Owner review:** no

### CL-IMP-18 — Recovering a cut result

- **Affects:** IMP-05, IMP-12, BKT-06, CA-IMP-04
- **Problem:** IMP-05 does not say what "complete" means for a cut text, and the last recovered event falls outside the covered period that the recovery itself shortens.
- **Ruling:**
  - A result is cut when the isolated text ends inside the JSON object (an unclosed string, array or object).
  - Recovery is offered when the text holds complete values of the request reference, the player, the covered types and the covered period, at least one complete event, and the complete events are sorted (CL-IMP-19). A complete event is an element of the events list closed before the cut; the event being written at the cut is dropped whole. Recovered events go through every check.
  - The covered period ends on the day before the calendar date of the last recovered event. If that end is before the period's start, the retained coverage is empty, the recovered events can still be saved, and the gaps cover the whole requested period.
  - Leads and limitations are lost (IMP-05), except complete ones written before the events list.
  - Recovered events dated on the last recovered date fall outside the shortened period and carry IMP-12's "outside the declared period" warning, as written: that day is searched again by the supplement, which recognizes them as duplicates.
  - The import trace records the recovery and the number of events recovered.
- **Why:** the shortened period must end where the cut list is still complete; that day's other events may have been lost.
- **Owner review:** no

### CL-IMP-19 — Sortedness check

- **Affects:** IMP-05, « Cas limites » (events not sorted)
- **Problem:** the import needs a sort test for dates mixing dates and date-times.
- **Ruling:** The events are sorted when their calendar dates never decrease along the list (CL-BKT-15). Unsorted events are accepted with a whole-result warning that gives the rank of the first event out of order; recovery of a cut result is then not offered.
- **Why:** the order matters only for cut recovery (« Cas limites »).
- **Owner review:** no

### CL-IMP-20 — Scope of a replacement

- **Affects:** IMP-29, BKT-09, CA-IMP-16
- **Problem:** IMP-29 deletes events "whose public date falls within its period" — each type's retained period or the result's declared period — and does not say what happens to the coverage of the replaced imports.
- **Ruling:** For each type T of the new import's retained coverage, with its retained period P, replacement deletes the player's historical events of type T brought by any earlier import, whatever its request, whose calendar date lies in P. Events of other types, events outside P and detected events are untouched. Coverage periods brought by earlier imports are kept, since coverage is a union; the new import's periods are added. The preview counts the deletions and, among them, the manually corrected events (IMP-29).
- **Why:** coverage is per type, so the deletion follows each type's retained period.
- **Owner review:** no

### CL-IMP-21 — Sheet version of an event attached after a merge or a split

- **Affects:** IMP-11, IMP-30, TAX-25, TAX-27, TAX-28, TAX-30, CA-IMP-23
- **Problem:** IMP-30 says the version of the request's prompt applies "except attachment after a merge or a split", without saying which version then applies.
- **Ruling:** An event of a type absorbed by a merge (TAX-28) is attached to the surviving type with the version the merge created when the owner declared that the merged sheet covers the union (TAX-27 "yes"); otherwise with the absorbed type's version that the request's prompt used, and it joins the events to requalify (TAX-25). An event of a split type takes the chosen resulting type's version in force at import (TAX-30). In both cases the type counts as covered only if it was in the request (IMP-11, as written).
- **Why:** follows what TAX-27 does with the events already saved at the merge.
- **Owner review:** no

### CL-IMP-22 — Normalizing identifiers and enumerated values

- **Affects:** IMP-07, IMP-11, IMP-15, CL-BKT-11
- **Problem:** type identifiers ignore case and extra spaces, enumerated values ignore case and accents, and nothing is said for the reference, the player identifier or the format name.
- **Ruling:** Type identifiers, enumerated values, the format name, the format version, the request reference and the player identifier are all compared after trimming leading and trailing whitespace, ignoring case and ignoring diacritics (Unicode NFD, combining marks removed). Inner whitespace and punctuation are kept: a hyphen differs from an underscore. The stored value is always the canonical one — the request's, the taxonomy's or the glossary's — never the AI's spelling.
- **Why:** one comparison rule for every closed value.
- **Owner review:** no

### CL-IMP-23 — Repeated covered types, and the count of leads per type

- **Affects:** IMP-09, IMP-10, IMP-15, H-IMP-10, format of 05 (`types_couverts`, leads)
- **Problem:** the format forbids repeated covered types without an import rule, and leads may carry no type or an unrequested one.
- **Ruling:** A covered type listed more than once (after CL-IMP-22) counts once, with a whole-result warning. A lead counts under its type when that type is a requested type, otherwise under "no type"; an incomplete or too-long lead is ignored (IMP-15) and not counted. Only the counts are kept (H-IMP-10).
- **Why:** the repetition is harmless; every kept lead is counted somewhere.
- **Owner review:** no

### CL-IMP-24 — Remaining rejections

- **Affects:** IMP-24, H-IMP-12, SEN-46, CA-IMP-12
- **Problem:** remaining rejections are "those of the last import", so a later import could hide earlier rejections that were never corrected.
- **Ruling:** As written, per request: a request's remaining rejections are those of its last confirmed import (H-IMP-12), so re-importing the corrected result into the same request (supplement mode) replaces them, and an import into another request never touches them. The player sheet lists the remaining rejections of each of the player's requests (IMP-24), and the profiles show their sum (CL-SEN-22).
- **Why:** H-IMP-12 is per request; summing over requests keeps every uncorrected rejection visible.
- **Owner review:** no

### CL-IMP-25 — The link check: when a source is "not found"

- **Affects:** IMP-17, H-IMP-08
- **Problem:** fetching every article link meets paywalls, bot blocking and rate limits, which would mark many real articles « introuvable »; no retry or timeout is given.
- **Ruling:** After saving, a background job (chunked, TRV-30) fetches each new or corrected link once: `GET`, a generic user agent carrying no personal data, up to 5 redirects followed, a 10-second timeout (parameter), one request at a time. The source is marked « introuvable » only when the final status is 404 or 410 or the host name does not resolve; any other outcome (401, 403, 429, 5xx, timeout, certificate error) marks nothing and is not stored. No retry. The mark is removed only when the link is corrected, which checks it again. The IMP-17 parameter turns the job off.
- **Why:** only those answers mean the page does not exist; everything else is noise the owner cannot act on.
- **Owner review:** no

### CL-IMP-26 — "Too long" texts

- **Affects:** IMP-13, IMP-15, DSN-20
- **Problem:** IMP-15 ignores a too-long precision, reservation, limitation or lead without restating the limit.
- **Ruling:** As written through 05's general rule: too long means longer than the maximum description length of DSN-20 (200 by default). Lengths are counted in Unicode code points after trimming, for descriptions and for every other free text alike.
- **Why:** one limit and one way of counting.
- **Owner review:** no

### CL-IMP-27 — Size limit of the pasted text

- **Affects:** IMP-02, H-IMP-02
- **Problem:** the limit is « 2 Mo » while the screen counts characters, and MB versus MiB is not stated.
- **Ruling:** The limit applies to the UTF-8 encoded size of the pasted text or of the chosen file: 2 MB means 2,000,000 bytes (the parameter is in MB, 1 MB = 1,000,000 bytes). The screen keeps showing the character count (IMP-02); the refusal message gives the size received and the limit, in MB.
- **Why:** the limit protects the server, which handles bytes.
- **Owner review:** no

### CL-IMP-28 — Withdrawal fingerprints in the import preview

- **Affects:** IMP-25, IMP-37, DSN-29, ADR 0017 and its open point 1, register rows IMP-37 and IHM-68, CA-IMP-28; CL-DSN-04, CL-DSN-06 (file 13 rulings)
- **Problem:** an exact-date fingerprint misses a withdrawn fact reported again one day apart, and the preview's handling of a match is not described.
- **Ruling:**
  - Every accepted event of the result is checked against the live fingerprints as CL-DSN-06 rules: its player, its type after any merge or split attachment, and its day d — the date as recorded for a date without time, the calendar date of the instant in the owner's time zone (TRV-72) otherwise. It matches when a fingerprint equals the hash for one of the days from d − g to d + g, g being the window of CL-IMP-34 (2 days by default).
  - A matching event shows, beside it, the flag "matches an event you withdrew", with no other detail, and the choice "don't record — sensitive data". Nothing is preselected and nothing is declined automatically (ADR 0017). Declining increases the withdrawn-events counter (IMP-37, CL-DSN-04).
  - The save confirmation says how many flagged events will be recorded. Recording a flagged event erases the fingerprints it matches (CL-DSN-06).
- **Why:** follows ADR 0017 and file 13's ruling; the confirmation keeps a withdrawn sensitive fact from coming back unseen without asking a separate answer per event.
- **Owner review:** yes — the save confirmation counts the recorded events that match a withdrawal, and recording one of them takes that withdrawal back.

### CL-IMP-29 — Calendar-derived types in an import; no matching with calendar-derived events

- **Affects:** IMP-10, IMP-11, IMP-19, IMP-21, IMP-25, IMP-27, DET-58, ADR 0015, register row IMP-25 and the reading applied on duplicate matching
- **Problem:** birthday and former-team events now come from the calendar (ADR 0015); the import must say what happens when a result holds such an event, and whether calendar-derived events take part in duplicate matching.
- **Ruling:**
  - An event of a calendar-derived type in a result is ignored with the reason "type derived from the calendar" (glossary), whatever its request. It is not a rejection: it does not enter the remaining rejections or the correction message.
  - A calendar-derived type listed among the covered types is ignored with IMP-10's warning and never enters coverage. A lead of such a type counts under "no type" (CL-IMP-23).
  - Confirmed: calendar-derived events never take part in matching or possible duplicates, in either direction — a research or detected event never matches one, and the derivation never looks for matches. Fingerprints are never checked against them at import, since they are never imported. Co-occurrence (SEN-06) still applies when such an event and another event attach to the same game.
- **Why:** these types are never requested (ADR 0015); a calendar fact is never the same fact as a press report, and including them in matching would make every press fact near a birthday game a possible duplicate.
- **Owner review:** no

### CL-IMP-30 — A result event that duplicates a detected event and has older sources (lot 2)

- **Affects:** IMP-26, IMP-27, DET-31, DET-48
- **Problem:** the import never modifies a detected event, so a backtest source older than the detected event's reference date is dropped, although it could move its measured game earlier.
- **Ruling:** As written, the import never modifies a detected event (IMP-27). When a result event matches a detected event and one of its sources is older than the detected event's reference date, the preview says so next to the duplicate and points to advancing the reference date with that source (DET-48). The result's sources are not stored.
- **Why:** the owner can correct a possibly wrong measured game; the import changes nothing by itself.
- **Owner review:** no

### CL-IMP-31 — Corrections: reference period and dates typed by hand

- **Affects:** IMP-32, IMP-12, IMP-14, CA-IMP-19
- **Problem:** a correction checks the event against the career rather than the request period (intended), and nothing says how a time typed by the owner is read.
- **Ruling:** As written for the period: a correction runs IMP-11 to IMP-14 against the player's NBA career up to the correction day (from the first NBA game, or with no lower bound when it is unknown). A date typed by the owner is a date, an optional time and, with a time, a time zone that defaults to the owner's (IHM-14); it is stored like an imported value (CL-IMP-09). A 00:00 time typed by the owner is a real time: the midnight reading of CL-IMP-08 applies only to the AI's output.
- **Why:** the owner states times deliberately; the AI's midnights are usually placeholders.
- **Owner review:** no

### CL-IMP-32 — Missing or unknown reference: finding the player

- **Affects:** IMP-07, IMP-09, CA-IMP-03
- **Problem:** IMP-07 searches the player "by identifier, then by name" without saying how names compare or what happens with several matches.
- **Ruling:** The reference is compared per CL-IMP-22. When it is missing or matches no request, the result's player identifier is compared with the current request's player, then with the other followed players; if no identifier matches, the name is compared (case and diacritics ignored) with each followed player's name and spelling variants (JOU-08). A match on the current request's player offers to attach the result to the current request or to another of that player's requests, listed with their state and creation date. A match on exactly one other player says so and offers to open his requests. No match, or a name matching several players, refuses the result.
- **Why:** the import screen is always tied to a request (IHM-28), so its player is checked first.
- **Owner review:** no

### CL-IMP-33 — Journal entry of an attempt refused in full

- **Affects:** IMP-31, IMP-03, DSN-11
- **Problem:** a fully refused attempt is logged in the app journal, without saying what the entry holds.
- **Ruling:** The entry holds the date, the request reference, the category of the refusal and the size of the pasted text, never any of its content (DSN-11, IMP-03).
- **Why:** the journal must hold no pasted text.
- **Owner review:** no

### CL-IMP-34 — One window for duplicates, possible duplicates and fingerprints

- **Affects:** IMP-25, IMP-26, IMP-37, DET-58, H-IMP-02; CL-DET-10, CL-DET-21 (file 04 rulings), CL-DSN-06 (file 13 ruling), CL-IMP-12, CL-IMP-28
- **Problem:** IMP-25's window ("2 days at most", configurable) is reused by detection's possible-duplicate mark and by the withdrawal-fingerprint checks, and nothing says whether they share it.
- **Ruling:** One parameter of file 06 — H-IMP-02's "maximum gap between the public dates of two matching events", 2 days by default — sets them all: matching and possible duplicates at import (IMP-25, measured as CL-IMP-12); detection's search for a matching historical event and its « doublon possible d'un événement historique » mark (DET-58, CL-DET-10); and the fingerprint checks at import (CL-IMP-28) and at detection (CL-DET-21), which test every day within that many days of the event's day (CL-DSN-06). Changing it changes them all at once.
- **Why:** each asks whether two records can be the same fact; one parameter keeps the answers consistent, as the file-04 rulings recommend.
- **Owner review:** no

## Passed to the glossary

- Every message of IMP-20 and the « Cas limites », in the structure of CL-IMP-02: the five French examples, « ce texte n'est pas un résultat de backtest », « cette demande a été annulée le … : importer quand même ? », « N événements refusés manqueront au backtest tant qu'ils n'auront pas été corrigés et réimportés », « Aucun résultat reconnaissable : vérifiez que vous avez copié toute la réponse de l'IA. », « aucun événement nouveau », « vers le 12e événement », and the placeholders for a missing type or date.
- Ignore reasons: « type non validé à ce jour », "not part of the request", "type derived from the calendar".
- Warnings named here: "date written in a non-standard form", "time ignored", "may contain statistics or a score", "possible citation marker in {field}", "matches an event you withdrew".
- The reference wording of the correction message (CL-IMP-04) and its table of expected corrections per rejection reason.
- Screen labels: « Coller le résultat », « Coller », « Vérifier », « Effacer », « Abandonner le brouillon », « Enregistrer », « Abandonner », « Copier le message de correction », « Backtest en cours »; the modes « premier import », « complément » (an import mode, distinct from the request kind), « remplacement »; « même fait », « faits distincts », « événements distincts »; « ne pas enregistrer — donnée sensible »; « conforme », « non conforme », « inaccessible »; « introuvable »; outcomes « ajouté », « ajouté avec avertissement », « doublon, non ajouté », « ignoré », « refusé », « non enregistré pour donnée sensible »; precedence « établie », « incertaine », « non établie », « à vérifier »; the deletion reasons of IMP-33.

## Ruled elsewhere

- The list of tracking elements removed from links (COL-28, file 03), which CL-COL-18 and CL-IMP-14 rely on: ruled by CL-COL-23 (the `utm_*` parameters and the usual click identifiers `fbclid`, `gclid`, `mc_cid`, `mc_eid`, in one constant of the shared link module).
- The day hashed in a withdrawal fingerprint (DSN-27, file 13): ruled by CL-DSN-06, which CL-IMP-28 follows.
- The quotation-mark check of DSN-21 and DSN-24 (file 13): ruled by CL-DSN-03, which CL-IMP-05 applies.
- The sheet version of events distributed after a split (TAX-29, file 02): ruled by CL-TAX-22 (the version of the chosen type in force at distribution, as CL-IMP-21 does at import and CL-TAX-07 does for a reassignment).
