# Clarifications — 12 Interface and access

Rulings on the unclear points of the French spec `docs/12-interface-et-acces.md`, numbered `CL-IHM-nn`.
The decision records (`docs/adr/`, listed in `docs/engineering/spec-deviations.md`) and these rulings override the spec text where they say so; the French spec is authoritative everywhere else, and `docs/engineering/glossary.md` fixes every English term used here.

### CL-IHM-01 — Language of the interface

- **Affects:** IHM-12, IHM-15, IHM-50, CA-IHM-08; ADR 0010
- **Problem:** IHM-12 requires everything in French, labels, messages, errors and help.
- **Ruling:** As written in ADR 0010 and the register row IHM-12: everything is in English, with American spelling; article titles and proper names stay as published; the prompt is shown as file 05 produces it, now in English. CA-IHM-08 expects the error "described in English".
- **Why:** the owner's decision overrides H-11.
- **Owner review:** no

### CL-IHM-02 — Identifiers of the acceptance criteria

- **Affects:** acceptance criteria 1 to 24 of file 12
- **Problem:** the criteria are numbered without IDs.
- **Ruling:** As written in the orchestrator's planning ruling on acceptance-criterion IDs: they are `CA-IHM-01` to `CA-IHM-24`, in document order; the register's `12 AC-n` cites the same criteria.
- **Why:** one citation scheme for every file.
- **Owner review:** no

### CL-IHM-03 — Number formats

- **Affects:** IHM-13, IHM-47, IHM-62; ADR 0010 and the register's reading "decimal point, comma for thousands"
- **Problem:** IHM-13 sets French formats; ADR 0010 sets English ones, and neither says how a value that rounds to zero, counts or machine formats are written.
- **Ruling:** the register's reading is confirmed and completed:
  - decimal point, and a comma between thousands in every number of 1,000 or more shown to the owner (0.751; 1,000; 12,345);
  - a signed value — gap, mean gap, range bound — always carries "+" or the true minus sign "−" (U+2212); the sign is that of the displayed, rounded value, and a value that rounds to zero carries none ("0.00"); counts carry no sign;
  - the number of decimals is set by the file that owns the value (STA-12, SEN-09);
  - screen readers say "plus" or "minus" with the figure (IHM-62);
  - machine formats — the JSON of prompts and imports, exports and their spreadsheet files (TRV-52) — use a plain decimal point, no thousands separator and the ASCII hyphen-minus.
- **Why:** ADR 0010 fixes the display; zero has no direction (IHM-47), and a spreadsheet must read the exported numbers.
- **Owner review:** no

### CL-IHM-04 — Date formats and where the time zone is named

- **Affects:** IHM-13, IHM-14, TRV-24, TRV-71; ADR 0010
- **Problem:** ADR 0010 gives a full form ("Wednesday 18 November 2026, 01:30 Paris time") and a short one ("Wed 18 Nov 2026, 01:30") and says the zone is always named, but the short form names none.
- **Ruling:**
  - The full form is used where one instant is the subject of a block: an alert sheet's expected game and production, a request's deadline, an event's reference date, a case's game.
  - The short form is used in lists, tables and summaries, on screens that state once, at the top, the zone in use ("Times in Paris time").
  - The zone's name is the owner's zone as "<city> time" (Paris time, New York time); the glossary gives the exact names.
  - A date without a time shows neither time nor zone ("Wed 18 Nov 2026"); durations and relative times ("in 3 h 20", "12 min ago") show no zone.
  - Telegram messages, which have no screen statement, name the zone after every clock time (CL-TEL-03).
- **Why:** this names the zone everywhere, as ADR 0010 and TRV-24 require, while keeping the one-column phone layout of IHM-01 readable.
- **Owner review:** no

### CL-IHM-05 — The time-zone setting

- **Affects:** IHM-14, H-IHM-02, TRV-27; ADR 0010
- **Problem:** H-IHM-02 justified the Paris default by the French interface, which no longer exists, and IHM-14's offer to adopt the phone's zone has no rule for declines or repeats.
- **Ruling:** the register's reading is confirmed: Paris time (`Europe/Paris`) is the default and the setting of IHM-14 stays. When the device's zone differs from the setting, the app offers once, in a banner, to adopt the device's zone; accepting goes through TRV-27's announcement (task hours move with the zone) before saving; declining hides the offer on that device until the device's zone changes to yet another value, which only that device's storage remembers.
- **Why:** ADR 0010 keeps the setting; an offer repeated at every opening would nag an owner who travels.
- **Owner review:** no

### CL-IHM-06 — Start screen: Home or the last screen

- **Affects:** IHM-02, IHM-04, IHM-11, IHM-41, nominal scenario step 5, CA-IHM-01
- **Problem:** IHM-02 starts the installed app on Home, while IHM-41 reopens the last displayed screen at the same position, even after the phone closed the app in the background.
- **Ruling:** opening the app from its icon or its address shows the last screen displayed on that device, at its scroll position, whenever the device holds one (IHM-41); otherwise Home. A device holds none after installation and after logout (IHM-08); when the last screen's object no longer exists, Home opens. A link, from Telegram or elsewhere, opens its target instead, after login if needed (IHM-11). Home always shows the last known data first, then refreshes (IHM-04). CA-IHM-01, the first opening after installation, shows Home.
- **Why:** IHM-41 covers exactly the round trip to the research AI, and IHM-02 then gives the default.
- **Owner review:** no

### CL-IHM-07 — The US-date reminder

- **Affects:** IHM-14, ALE-15, TEL-04, TRV-71, TRV-72, CA-IHM-15, CA-TRV-36
- **Problem:** IHM-14 recalls a game's US date when it differs from the local date, without saying which US zone defines it or how "evening" is chosen, while TRV-71 also asks for the venue's local time.
- **Ruling:**
  - A game's US date is the calendar date of its scheduled start in US Eastern time (`America/New_York`), for every game, abroad included.
  - Wherever a game is shown, its US date follows when it differs from the date of its start in the owner's zone, with the part of day of its Eastern start: morning before 12:00, afternoon from 12:00 to 16:59, evening from 17:00. Example: "Wed 18 Nov 2026, 01:30 — Tuesday evening in the US", the zone being named as CL-IHM-04 says.
  - The venue's local time is not shown.
  - CA-IHM-15 checks "Wednesday 18 November 2026, 01:30 Paris time — Tuesday evening in the US" in the full form, or the short form under the screen's zone statement.
- **Why:** the league dates its games in Eastern time; IHM-14, ALE-15 and TEL-04 recall the US date only when it differs, and a third time on one phone line adds little.
- **Owner review:** no

### CL-IHM-08 — Accessibility level

- **Affects:** IHM-60, IHM-61, IHM-62, IHM-63, CA-IHM-16
- **Problem:** IHM-61 requires level AA of WCAG without a version; touch-target size reaches level AA only in WCAG 2.2.
- **Ruling:** every screen meets WCAG 2.2 level AA, touch targets included: at least 24 by 24 CSS pixels, or the spacing exception of success criterion 2.5.8. The automated checks of the key journeys run the WCAG 2.2 AA rule set (axe tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`). No information rests on color alone (IHM-61).
- **Why:** 2.2 is the current W3C recommendation and the only one with a target-size criterion at AA.
- **Owner review:** no

### CL-IHM-09 — One Help screen

- **Affects:** IHM-16, IHM-37, IHM-53
- **Problem:** Help is both an entry of the "More" menu (IHM-16) and a section of the settings (IHM-37).
- **Ruling:** there is one Help screen — installing the app, glossary, relaunching the onboarding guide, version — reached from "More" and from the settings, which link to it.
- **Why:** two copies would drift apart.
- **Owner review:** no

### CL-IHM-10 — The import draft kept by the application

- **Affects:** IHM-08, IHM-42, H-IHM-08, DSN-32, IMP-03, TRV-51, TRV-52
- **Problem:** the pasted text is kept by the application to be found from another device, yet excluded from saved data, the import trace, the journal and backups, and called "the only copy" though it sits on the device and on the server; logout erases only the device's data.
- **Ruling:**
  - The device copy and the server copy are two copies of one draft; "the only copy" means that no other record holds the pasted text.
  - The server copy lives in a store left out of backups and exports (TRV-51, TRV-52) and out of every journal; the journal may record that a draft was saved or discarded, never its text.
  - Logging out of a device erases that device's copy only; the server copy stays retrievable from its request until the import is saved, the draft discarded or expired (CL-IHM-11). Before logout the app warns when the device holds a draft not yet sent to the server, which would be lost, and says that a draft already on the server stays retrievable.
  - Logging out of all devices erases every device copy and keeps the server copy the same way.
- **Why:** the draft exists so that another device can resume it (H-IHM-08), and DSN-32 limits where it may live, not that it lives on the server.
- **Owner review:** no

### CL-IHM-11 — When a draft expires

- **Affects:** IHM-42, H-IHM-03, DSN-32, TRV-25
- **Problem:** the draft disappears "after a duration (7 days)" without saying from when; H-IHM-03 says "7 days at most".
- **Ruling:** a draft expires 7 days (parameter) after its last modification, the only date it keeps. An expired draft is never shown again; the server copy is deleted by the first daily purge run after its expiry (TRV-25), and a device copy by the same rule on that device.
- **Why:** the last modification is the date the draft records, and an import still in progress is not cut short.
- **Owner review:** no

### CL-IHM-12 — Which parameter changes are dated and confirmed

- **Affects:** IHM-35, IHM-37, IHM-51, TRV-35, SUI-25, CA-IHM-17; ADR 0016
- **Problem:** IHM-51 dates the last change of "a parameter that influences verdicts", IHM-35 of "a calculation parameter", and IHM-37 confirms "a change that changes verdicts": three wordings for one set.
- **Ruling:** the set is TRV-35's parameters that influence calculations — those of files 07, 08 and 10, and the per-type criterion switch of ADR 0016 — each marked so in file 14's register. The date shown on profile detail (IHM-51) and on the validation table (IHM-35) is the date of the last change of any of them, linked to its journal entry. Every change of one of them asks IHM-37's confirmation, which states its consequence: all profiles recalculated for files 07 and 08, the validation table recalculated for file 10.
- **Why:** TRV-35 already defines the set and its date; one flag in the register serves all three screens.
- **Owner review:** no

### CL-IHM-13 — The "request in progress" banner

- **Affects:** IHM-19, IHM-39, IHM-40, CA-IHM-05
- **Problem:** "the most recent" request is not defined, nor how long « Plus tard » hides the banner.
- **Ruling:** the banner shows the request whose prompt was copied most recently, with the number of the other requests in progress. « Plus tard » hides it on every device, the setting being kept by the application, until the next prompt copy of any request, which shows it again.
- **Why:** the banner exists for the copy-and-paste round trip, which the most recent copy starts.
- **Owner review:** no

### CL-IHM-14 — Offline input and the draft's upload

- **Affects:** IHM-39, IHM-42, IHM-57, IHM-58, H-IHM-07, BKT-20
- **Problem:** IHM-58 and H-IHM-07 forbid sending an action later without the owner's knowledge, while IHM-42 sends the draft to the server as soon as the network returns; nothing says whether a prompt copied offline records its copy time.
- **Ruling:** sending a draft to the server saves input and is no action: it happens automatically when the network returns and changes no data (no import is saved, no state changes). A prompt copied offline goes to the clipboard, but its copy time is not recorded, which the confirmation says; the request is not "in progress" until its prompt is copied again online. No other offline input is ever sent later.
- **Why:** H-IHM-07 targets actions with effects; a copy time sent later would be exactly such a deferred action.
- **Owner review:** no

### CL-IHM-15 — Offline copies are replaced, not merged

- **Affects:** IHM-57, IHM-59, DSN-33
- **Problem:** IHM-57 refreshes the kept screens at each connection, and IHM-59 wants a withdrawn event to disappear at the next refresh, which a merge of old and new data would not guarantee.
- **Ruling:** at every connection — opening the app online, the network's return — the app reloads every kept screen and replaces each copy whole; a copy whose object no longer exists, or that has left IHM-57's list, is deleted. Nothing is merged.
- **Why:** replacing whole copies is the only way a withdrawal surely reaches every device at its next connection.
- **Owner review:** no

### CL-IHM-16 — Order of requests in the Lot 1 to-do list

- **Affects:** IHM-20, BKT-17, BKT-18, CA-IHM-04
- **Problem:** IHM-20 details only the Lot 2 order, urgent requests first.
- **Ruling:** As written in BKT-17: « La liste des demandes à faire présente les demandes de la plus ancienne à la plus récente » (H-BKT-04); in Lot 1 no request is urgent, so that order applies alone.
- **Why:** IHM-20 delegates the order to file 05.
- **Owner review:** no

### CL-IHM-17 — Clock changes in conversions

- **Affects:** IHM-14, TRV-70, CA-IHM-15
- **Problem:** the weeks when only Europe or only the United States has changed clock make the Paris–New York offset five hours instead of six.
- **Ruling:** As written in TRV-70: « Aucun décalage fixe n'est supposé ». Every conversion goes through a time-zone database; tests cover the weeks when only one side has changed clock.
- **Why:** TRV-70 settles it.
- **Owner review:** no

### CL-IHM-18 — An object changed elsewhere while the owner edits it

- **Affects:** edge case « Objet modifié ailleurs »
- **Problem:** the app must notice a change made by another device or a scheduled task before saving, but no mechanism is given.
- **Ruling:** every editable object carries a version that changes at each save; a screen that changes an object sends the version it showed. When the stored version differs, the change is refused, the screen shows the current version with a message saying it was changed elsewhere (another device or a scheduled task), and keeps the owner's input visible so that it can be applied again. This covers every owner action that changes data: edits, dismissals, corrections, exclusions, settings.
- **Why:** this is the edge case's behavior made checkable, without locking anything.
- **Owner review:** no

### CL-IHM-19 — A link to an object that no longer exists

- **Affects:** IHM-17, IHM-68, TEL-07, edge case « Lien vers un objet disparu », DSN-29; ADR 0017
- **Problem:** the edge case says a link to a vanished object (a withdrawn event, a cancelled request) explains what became of it, while after a withdrawal no screen may mention the event and the counter is its only trace (DSN-29).
- **Ruling:**
  - An object that still exists in another state — dismissed event, cancelled request, closed or cancelled sheet, archived profile, withdrawn player or type — opens normally and shows its state and reason: that is "what became of it".
  - An identifier that matches no object shows one generic screen, the same for every kind of object and every cause (withdrawal, deletion of a historical event or of a player's data, merge, or an identifier that never existed): "This item no longer exists", with a link to the home screen. The app keeps no record of erased identifiers and never consults the withdrawal fingerprints for this (ADR 0017).
  - Identifiers are never reused (ALE-30 for sheet numbers; database identifiers likewise).
- **Why:** a withdrawn event cannot be explained without a trace of it; one message for every missing object reveals nothing.
- **Owner review:** yes

### CL-IHM-20 — Hiding an incident, not closing it

- **Affects:** IHM-20, TRV-45, TEL-15, TEL-24
- **Problem:** TRV-45 lets an incident be closed "automatically ... or by the user", while IHM-20 only lets the owner hide one, which stays open while its cause lasts.
- **Ruling:** the owner's only action on an incident is to hide it (IHM-20): it leaves the to-do list, stays open while its cause lasts, stays in the activity journal and on the status screen, and counts among the « incidents masqués » until it closes; its Telegram messages are unaffected, the category settings governing them (TEL-24). Incidents close only automatically, when their cause disappears (TRV-45, CL-COL-05, CL-DET-04). An incident opened after a closure shows again even if the previous one was hidden.
- **Why:** a closure by the owner while the cause persists would contradict TRV-45's « reste ouvert tant que la cause subsiste », and every incident of the specs has an automatic end.
- **Owner review:** yes

### CL-IHM-21 — The sheet of a calendar-derived event

- **Affects:** IHM-24, IHM-25, IHM-32, IHM-67, IHM-68; ADR 0015
- **Problem:** the event sheet lists press sources, confidences and marks, and actions that do not fit an event derived from the calendar (birthday game, first game against a former team).
- **Ruling:**
  - The sheet shows player, type and the sheet version it was qualified under, "derived from the schedule" with the derived game (date, time, opponent, home or away), the reference date (that game's day, before tip-off), the description written by the app, context indications with their origin, the case's state and the correction history.
  - It shows no source, no research or detection confidence, no precedence and no mark.
  - Its actions are correcting the context indications (H-09) and withdrawing the event (IHM-68); there is no dismissal, no deletion and no correction of type, player or date, which are derived (ADR 0015).
  - Such events never appear in the detected-events list (IHM-32); in case lists they show their case origin like any other (IHM-46).
- **Why:** these are the event data ADR 0015 defines and the only corrections it leaves open.
- **Owner review:** no

### CL-IHM-22 — Open sheets whose expected game is unknown

- **Affects:** IHM-19, IHM-33
- **Problem:** open alert sheets are listed nearest tip-off first, without saying where sheets with no known expected game go.
- **Ruling:** open sheets are sorted by their expected game's scheduled start, earliest first; those with no known expected game follow, the most recently produced first; ties go by sheet number.
- **Why:** the owner sees first what comes first, and nothing open is hidden.
- **Owner review:** no

## Passed to the glossary

- Navigation labels, screen titles, banners, empty states and the short notice « Mesure du passé, hypothèse non démontrée, aucune recommandation de pari ».
- The screen's zone statement ("Times in Paris time"), the zone names, the part-of-day words of CL-IHM-07 and the generic "This item no longer exists" text.
- « Rien à faire pour le moment », « Backtest en cours : … », « prompt copié », « brouillon gardé à … », « incidents masqués », « Hors connexion — données du … à … », « Plus tard ».
- « retiré »: a withdrawn player or type keeps its data, archived, while the withdrawal of an event erases it; the two English words must differ, as IHM-68 asks.

## Ruled elsewhere

- File 14, TRV-24, TRV-71 and TRV-72: recommendation — a game's US date is its Eastern date, recalled only when it differs (IHM-14), without the venue's local time, the zone being named by the full form or the screen's statement (CL-IHM-04, CL-IHM-07); CA-TRV-36's "plus the US date and local time" then reads "plus the US date when it differs".
- File 14, TRV-45: recommendation — read « ou par l'utilisateur » as the hiding of IHM-20 (CL-IHM-20).
- File 14, TRV-38: recommendation — the register marks each parameter that influences calculations, ADR 0016's switch included (CL-IHM-12).
- File 14, TRV-51: the store of server-held drafts stays out of backups (CL-IHM-10).
