# 0010. English product

- Status: Accepted
- Date: 2026-11-11

## Context

H-11 makes the interface French, while collection and classification handle English and French press. Many requirements derive from its first half:

- interface, messages, logs and documentation in French, with French date usage and a decimal comma (TRV-24); task names in plain French (TRV-26); messages in plain French (TRV-42, CA-TRV-13); documentation in French (TRV-79);
- screens entirely in French and French formats such as « mer. 18 nov. » and « 1 h 30 » (IHM-12, IHM-13, IHM-14); glossary terms and verdict words used exactly as written in French (VUE-08, IHM-15, IHM-50); Paris as default time zone because the interface is French (H-IHM-02);
- Telegram messages in French with fixed French sentences (TEL-04, TEL-05); fixed French sentences of the alert sheet (ALE-17, ALE-18);
- event descriptions in French whatever the source (DSN-23, H-DSN-08, DET-21), and French values in the classifier's output (DET-16);
- error messages and the correction message for the research AI in French (IMP-20, IMP-21), and a statistics heuristic based on French words (IMP-13);
- type sheets in French and type identifiers modeled on the French ones of the annex (TAX-01, TAX-02), an exploration prompt that requires an answer in French (TAX-16) in a format that follows the French conventions of 05 (TAX-17);
- a French research prompt whose rule 2.6 asks for descriptions in French (BKT-21), a result format with French field names and values (BKT-24, H-BKT-07, H-BKT-08), free texts in French (H-BKT-05);
- acceptance criteria that expect French strings (CA-TRV-13, CA-TRV-36, CA-TRV-40, CA-COL-06, `12 AC-8`, `12 AC-15`).

The press half of H-11 is separate: sources are in English or French (COL-05, COL-17, TRV-17), the language model understands both (TRV-16), and name matching handles both (JOU-09, DET-03).

## Decision

- The whole product is in English: screens, Telegram messages, event descriptions, the research prompt with its JSON keys, the activity log, the documentation. Code, comments, commits and pull requests are in English too. American spelling.
- This overrides H-11 and everything derived from it. The French specs stay untouched as the reference, tied to the code by requirement IDs and one French-to-English glossary, `docs/engineering/glossary.md`.
- The press the app reads stays English and French.
- Dates are shown in Paris time, day–month–year with month names, with a 24-hour clock.

## Consequences

- Every label, state, message, example and fixed sentence that the specs quote in French is rendered with the English term the glossary gives, the same everywhere (VUE-08). The [deviations register](../engineering/spec-deviations.md) lists the requirements that prescribe French; it does not list every quoted label.
- Result format 1.0 (BKT-24) has English field names and English enumerated values, mapped one to one to the French ones in the glossary. The format names « egoscope-backtest » and « egoscope-exploration » do not change. The French-keyed form is never implemented, so the English form is version 1.0 and the import knows no earlier version (IMP-06).
- Machine formats stay ISO 8601 — `YYYY-MM-DD`, or `YYYY-MM-DDTHH:MM±HH:MM` with a time — in the prompt, the JSON and the exports; the display rule below applies to what people read.
- Type identifiers follow TAX-02 with English words; the glossary maps each identifier of the annex of [02](../02-taxonomie-des-evenements.md).
- The research AI and the classifier write descriptions, justifications, unverified notes and limits in English whatever the source language (DSN-23, DET-21, rule 2.6 of the prompt). Article titles and proper names stay as published (DSN-08, IHM-12).
- Heuristics that read text follow the language of that text: IMP-13 looks for English statistics words in descriptions; collection and name matching keep both press languages (COL-05, DET-03).
- Display formats: "Wednesday 18 November 2026, 01:30 Paris time" in full, "Wed 18 Nov 2026, 01:30" in short; a decimal point and a comma for thousands (0.751; 1,000); an explicit sign with a true minus (+0.62, −0.40); the number of decimals set by the spec document that owns each value (STA-12, SEN-09). The time zone is always named (TRV-24, TRV-71) and the US date is recalled when it differs (IHM-14).
- Paris is the default time zone (H-IHM-02 confirmed); the time-zone setting of IHM-14 stays, since no decision removes it.
- Acceptance criteria that expect French strings are tested against their English equivalents.

## Alternatives considered

- A French product, as H-11 specifies. Not retained.

## Amendments

### 2026-11-11 — How games are shown (CL-TRV-02, CL-IHM-07)

- A game's local time at the venue is never shown. Wherever a game appears, its US date — its day in US Eastern time ([0028](0028-a-game-day-is-its-us-eastern-date.md)) — follows when it differs from the date of its start in the owner's time zone, with the part of day of its Eastern start: morning before 12:00, afternoon from 12:00 to 16:59, evening from 17:00. Example: "Wed 18 Nov 2026, 01:30 — Tuesday evening in the US". The "et son heure locale" of TRV-71 is read as that recall.
- CA-TRV-36 therefore expects "Wednesday 11 November 2026, 04:30 Paris time — Tuesday evening in the US".
- Where the zone is named — in the full form, once at the top of a screen that uses the short form, after every clock time in Telegram — is ruled by CL-IHM-04.
