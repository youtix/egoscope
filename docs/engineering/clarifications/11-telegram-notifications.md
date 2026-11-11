# Clarifications — 11 Telegram notifications

Rulings on the unclear points of the French spec `docs/11-notifications-telegram.md`, numbered `CL-TEL-nn`.
The decision records (`docs/adr/`, listed in `docs/engineering/spec-deviations.md`) and these rulings override the spec text where they say so; the French spec is authoritative everywhere else, and `docs/engineering/glossary.md` fixes every English term used here.

### CL-TEL-01 — Identifiers of the acceptance criteria

- **Affects:** acceptance criteria 1 to 21 of file 11
- **Problem:** the criteria are a numbered list without IDs.
- **Ruling:** As written in the orchestrator's planning ruling on acceptance-criterion IDs: they are `CA-TEL-01` to `CA-TEL-21`, in document order; the register's `11 AC-n` cites the same criteria.
- **Why:** one citation scheme for every file.
- **Owner review:** no

### CL-TEL-02 — Examples without a link or without the standard first line

- **Affects:** TEL-07, TEL-08, TEL-15, TEL-16, TEL-29
- **Problem:** TEL-07 requires at least one link in every message and TEL-08 a first line « Egoscope · catégorie — sujet », but the « Incident résolu — statistiques » example has no link and the link confirmation has neither.
- **Ruling:** the requirements win. An incident's end message carries the same link as its start message: the press-sources screen for a source down, otherwise the activity journal filtered on the incident. The link confirmation starts with "Egoscope · " and the label for a linked conversation, keeps the example's two sentences and ends with a link to the notification settings. Every service message follows TEL-08 the same way.
- **Why:** a requirement wins over an example.
- **Owner review:** no

### CL-TEL-03 — Time zone and US date in messages

- **Affects:** TEL-04, the examples of TEL-09 to TEL-16; ADR 0010
- **Problem:** TEL-04 requires the zone to be named and the US date of a game when it differs, but most examples omit one or both (the TEL-10, TEL-11 and TEL-12 games after midnight Paris time, every source time).
- **Ruling:** in a message, every date with a clock time is in the owner's zone and followed by that zone's name (ADR 0010: the time zone is always named); a game shown by its date, with or without a time, is followed by its US date when that differs from its date in the owner's zone, as on screens (CL-IHM-07). A date without a clock time takes no zone name. The examples are read with these additions.
- **Why:** TEL-04 and ADR 0010 are requirements; the examples were shortened.
- **Owner review:** no

### CL-TEL-04 — Content of the quota incident message

- **Affects:** TEL-15, DET-11, CA-DET-06
- **Problem:** the « quota de classification atteint » example gives "140 of 210 articles" and "at the next pass", not the items DET-11 requires.
- **Ruling:** the message carries the items CL-DET-05 lists: waiting articles, the nearest player with his game, the planned resume as a date and time, and the cause.
- **Why:** DET-11 owns the incident's content, and a requirement wins over an example.
- **Owner review:** no

### CL-TEL-05 — The messages one fact may produce

- **Affects:** TEL-09, TEL-10, TEL-11, TEL-12, TEL-13, TEL-14, TEL-15, TEL-17
- **Problem:** TEL-17 says only the changes of TEL-09 and TEL-12 give a new message, yet TEL-10 sends reminders and TEL-15 incident reminders and end messages.
- **Ruling:** a fact produces exactly the messages its catalogue entry lists: a request, one message at creation, one per deadline change (TEL-09, CL-TEL-18) and one reminder per deadline (TEL-10); an alert, one at production (TEL-11) and one per update TEL-12 lists; a tracked case, one result (CL-SUI-09); a new type proposal, one (TEL-14); an incident, its start, a reminder every 3 days while it lasts and its end (TEL-15, CL-TEL-08). TEL-17's "changes" are changes of a fact's content; scheduled reminders belong to their entries.
- **Why:** TEL-17 summarizes the catalogue and must be read against it.
- **Owner review:** no

### CL-TEL-06 — No reply to conversations that are not linked

- **Affects:** TEL-29, TEL-31, TRV-67, CA-TEL-12, CA-TEL-13, CA-TEL-20
- **Problem:** TRV-67 allows "at most the neutral answer of this document", which file 11 never defines, while TEL-31 allows no answer at all.
- **Ruling:** As written in TEL-31: « tout message d'une conversation non reliée est ignoré, sans réponse ni information ». The bot sends nothing to any conversation other than the linked one, refused codes and groups included; a refusal shows only on the settings screen (the code's expiry, a "new code" action) and in the activity journal. TRV-67's "at most" covers sending nothing.
- **Why:** file 11 owns the bot's behavior, and no reply discloses nothing.
- **Owner review:** no

### CL-TEL-07 — The daily cap

- **Affects:** TEL-16, TEL-22, TEL-33, TEL-34, CA-TEL-17
- **Problem:** TEL-22 does not say what counts toward the cap, what becomes of the messages suppressed after it, which status they take, or what the « plafond atteint » message says.
- **Ruling:**
  - Every Telegram message actually sent counts once — a digest counts once — service messages included, except the link confirmation, which is always sent and never counted, and the cap message itself. The day runs from 00:00 to 24:00 in the owner's zone.
  - When a message would be sent after the cap is reached, the app sends the cap message instead, once that day. That message and every later one that day, urgent ones included, take the status « abandonné », with "daily cap" as the reason in the activity journal, and are never sent later; their facts stay in the app (TEL-02).
  - The cap message: first line "Egoscope · " and the cap label; then the number of messages sent that day, that nothing more will be sent before 00:00 of the next day in the owner's zone, and that everything stays in the app; a link to the home screen. It leaves when the message it replaces would have left.
- **Why:** the cap guards against a runaway, and carrying the backlog to the next day would restart it.
- **Owner review:** yes

### CL-TEL-08 — An incident's end message waits for the recurrence delay

- **Affects:** TEL-15, TEL-24, CA-TEL-16
- **Problem:** an incident that restarts within 6 hours is not notified again, but its end message may already be out, leaving the owner to believe it is resolved.
- **Ruling:** the end message of a notified incident is sent only once the incident has stayed closed for the recurrence delay (default 6 hours). If an incident of the same nature and the same object opens again within that delay, neither an end message nor a new start message is sent, and the reminder cycle goes on from the first start. The end message gives the whole interruption, from the first start to the final end. Quiet hours and the « fin d'incident » sub-option apply as usual.
- **Why:** a "resolved" message followed by silence during a new outage would mislead; a late end message misleads no one.
- **Owner review:** yes

### CL-TEL-09 — Deleting messages after a withdrawal without keeping a trace

- **Affects:** TEL-38, H-TEL-04, DSN-27, DSN-28, DSN-29, IHM-68, TRV-41
- **Problem:** TEL-38 deletes the messages that mention a withdrawn event and points out those Telegram no longer lets the app delete, while the message text is erased with the event (DSN-27) and nothing may designate the event afterwards (DSN-29); the message data lacks Telegram's message identifier, and digests that also mention other facts are not addressed.
- **Ruling:**
  - Each sent message keeps its chat identifier and Telegram's message identifier; both are erased with its text.
  - Before confirmation, the withdrawal screen states how many messages already sent mention the event, as a number only, and that Telegram may refuse to delete older ones.
  - On confirmation, before the event's data is erased: messages about the event not yet sent are abandoned and erased; for each sent message whose facts include the event — single message, digest or catch-up — the app asks Telegram once to delete it in the chat it was sent to, even a chat no longer linked; the text and the identifiers of every such message are then erased whatever the answer, and their activity-journal entries lose their mention of the event (TRV-41).
  - A digest is deleted whole; its other facts stay in the app (TEL-02) and are not sent again.
  - The screen shown right after the withdrawal gives the number of messages deleted and, for each message Telegram refused or that could not be reached, its send date and time with the zone and whether it was a digest. That list is computed during the withdrawal, shown on that screen only, never stored, and gone when the owner leaves the screen.
- **Why:** the owner learns where to delete by hand at the only moment it is allowed, and nothing outlives the withdrawal but the counter and the keyed fingerprint (ADR 0017).
- **Owner review:** yes

### CL-TEL-10 — Detection-born proposals and intimate subjects

- **Affects:** TEL-06, TEL-14, DSN-35, TAX-01, TAX-18
- **Problem:** TEL-14 sends a proposed type's name and definition in clear, while TEL-06 and DSN-35 protect types marked « sujet intime »; nothing says whether a detection-born proposal can carry that mark before it is notified.
- **Ruling:** As written: DSN-35 protects « un type dont la fiche porte la mention « sujet intime » »; a detection-born proposal is created without that mark, which only the owner sets on a sheet (TAX-01), so TEL-14 sends its suggested name and one-sentence definition, both already held to file 13's wording rules (DET-21, CL-DET-18). The first line stays "Egoscope · " and the new-type label, with no subject. Facts of the intimate candidate types (bereavement, racism suffered) match their existing entries and create no new proposal (TAX-18).
- **Why:** the protection follows the sheet's mark, and the texts sent are already checked.
- **Owner review:** no

### CL-TEL-11 — Alerts beyond the grouping threshold, digest titles and order

- **Affects:** TEL-13, TEL-19, TEL-20, TEL-21
- **Problem:** beyond the threshold, alerts "are grouped too" — with the pass's other facts or on their own? — and no title is given for an ordinary pass digest.
- **Ruling:**
  - A pass sends its alerts one by one when it produces no more than the threshold (default 3); beyond it, every alert of the pass joins the pass's single digest. Urgent messages still leave alone (TEL-21).
  - A pass digest's first line is "Egoscope · " followed by the digest label, the pass's task name and its start date and time; a digest holding only tracked-game results is titled as the TEL-13 example ("Results of n tracked games"); the end-of-quiet-hours digest keeps its own title (TEL-20).
  - Lines come in this order: alerts and alert updates, backtest requests and reminders, tracked-game results, type proposals, incidents; within each kind, the nearest game first, then creation order. The first 10 lines are detailed (TEL-19).
- **Why:** one digest per pass is TEL-19's rule, and the order puts first what may matter before a game.
- **Owner review:** no

### CL-TEL-12 — Catch-up after failed messages

- **Affects:** TEL-16, TEL-19, TEL-20, TEL-21, TEL-23, TEL-35, TEL-36, edge case « Telegram indisponible plusieurs heures », CA-TEL-14
- **Problem:** TEL-36 starts the catch-up "as soon as a send succeeds again", but once retries are exhausted nothing makes the app try again, and neither the catch-up's content nor its place against quiet hours is given.
- **Ruling:**
  - While at least one message is « en échec » and a conversation is linked, the notification task tries to send the catch-up at most once per catch-up interval (new parameter, default 60 minutes), and right after any other send succeeds.
  - The catch-up is a service message and never urgent: during quiet hours it waits for their end and leaves just before the quiet-hours digest, each fact appearing in one of the two only. During quiet hours a failed message that is still urgent (TEL-21) is retried alone, as urgent, at the same interval.
  - Content: first line "Egoscope · " and the catch-up label; the period, from the first failed attempt of the oldest message covered to the moment of sending, with the zone; one line and one link per fact still current after TEL-23's check, at most 10 detailed and the rest summarized with a link to the home screen (TEL-19), a fact whose game has started carrying « après le coup d'envoi »; a last link to the home screen.
  - The messages covered take the status « regroupé », pointing to the catch-up; those no longer current take « abandonné ».
  - The home-screen banner of TEL-36 stays until the catch-up is sent or no message is left « en échec ».
- **Why:** without a probe a quiet day would delay the catch-up indefinitely; quiet hours and urgency keep their meaning.
- **Owner review:** no

### CL-TEL-13 — An alert whose profile values arrive after tip-off

- **Affects:** TEL-11, TEL-21, TEL-23, ALE-05, ALE-24
- **Problem:** for a sheet produced while its profile was being computed, the message waits for the values (TEL-11); if the game starts first, whether it is still sent is not said.
- **Ruling:** the message is composed when the values enter the sheet, even after tip-off; it then carries the « tardive » mark (ALE-24, CL-ALE-04), is never urgent and leaves with the next digest or alone, per TEL-19. If the values never enter, no alert message is sent and the sheet stays visible in the app.
- **Why:** TEL-11 notifies late sheets too, and the owner still learns the profile.
- **Owner review:** no

### CL-TEL-14 — Messages too long for Telegram

- **Affects:** edge case « Message trop long pour Telegram », TEL-19
- **Problem:** the edge case gives the method but not the limit.
- **Ruling:** a message's text is at most 4,096 characters, Telegram's limit for a text message, a constant of the transport recorded in its service sheet and not a setting. A longer composition drops whole fact lines from the end, adds "and N more" with a link to the home screen, and is never cut inside a line.
- **Why:** the edge case gives the method and the transport the number.
- **Owner review:** no

### CL-TEL-15 — Language of the messages

- **Affects:** TEL-04, TEL-05, H-11; ADR 0010
- **Problem:** TEL-04 and TEL-05 require French messages and a fixed French closing line.
- **Ruling:** As written in ADR 0010 and the register rows TEL-04 and TEL-05: messages are in English, with the date rules of TEL-04 in the English format, and the closing line and the restricted word « pronostic » take their glossary equivalents; names and article titles stay as published.
- **Why:** the owner's decision overrides H-11.
- **Owner review:** no

### CL-TEL-16 — A tracked result for a player with no backtest shows profile values too

- **Affects:** TEL-13, CA-TEL-21
- **Problem:** the example's line for player D, who has no backtest, omits the new profile values TEL-13 requires.
- **Ruling:** TEL-13 wins: every result line gives the new profile values (mean gap, range, number of valid cases) and any change of verdict, with SEN-31's label below the threshold — for player D, in the glossary's words, "−0.35 over 1 valid case, range −2.35 to +1.65, inconclusive for this player (1 valid case of 5 needed)". The "no backtest yet" mention applies only to researched types, never to calendar-derived ones (CL-TEL-21).
- **Why:** a requirement wins over an example.
- **Owner review:** no

### CL-TEL-17 — Warnings that are not notified

- **Affects:** TEL-15, TRV-05, TRV-07, COL-46
- **Problem:** TEL-15 cites TRV-05 only for a quota reached; whether the quota warning at 80 % and the other warnings are notified is not said.
- **Ruling:** As written: TEL-15's list is exhaustive — the incidents it names, the silent-source warning (COL-42) and the export reminder (TRV-54). The quota warning at 80 % (TRV-05), the database-volume warning (TRV-07) and the "add a collection time" warning (COL-46) are not notified; they show on the status screen and in the activity journal.
- **Why:** TEL-15 names the two warnings that follow the incident rules, and no other.
- **Owner review:** no

### CL-TEL-18 — The « échéance modifiée » message

- **Affects:** TEL-09, TEL-17, TEL-21, BKT-07, BKT-18
- **Problem:** TEL-09 names a « échéance modifiée » message without an example or a list of contents.
- **Ruling:** it is sent when file 05 attaches a new detected event to a request and the request's deadline (BKT-18) changes. Contents:
  - first line as TEL-09's, the deadline-changed label following the player;
  - « pas encore de backtest »; the new event's type and source (media, date, time and zone), or « événement sensible » (TEL-06);
  - the new deadline (expected game's date, time and zone, its US date when it differs, opponent, time remaining) and, on one line, the previous deadline's date and time;
  - when the new event's type is not in the request, that updating the request would include it (BKT-07); that the prompt is ready; TEL-09's sentence if tip-off has passed when it leaves;
  - a link to the request screen.
  - Category « demandes de backtest »; it can be urgent (TEL-21).
- **Why:** these are TEL-09's contents plus what changed, which TEL-12 also states for alerts.
- **Owner review:** no

### CL-TEL-19 — The test message

- **Affects:** TEL-16, TEL-22, TEL-25, TEL-29, TEL-32, TRV-47
- **Problem:** "a test message can be requested at any time", but its contents and sending conditions are not given.
- **Ruling:** the notification settings offer it while a conversation is linked, and the installation check can send it (TRV-47). Contents: first line "Egoscope · " and the test label; one line saying it is a test and that notifications reach this conversation, with the date and time of sending and the zone; a link to the notification settings. It leaves at once, during quiet hours too, since the owner asked for it; it is not sent when the master switch is off (TEL-16) or the daily cap is reached (TEL-22), and the screen says why. It counts toward the cap and is never retried: the settings screen shows "sent" or the failure's reason.
- **Why:** a test must answer now; a retry minutes later would answer nothing.
- **Owner review:** no

### CL-TEL-20 — Master switch, unlinking and pending messages

- **Affects:** TEL-25, TEL-26, TEL-30, TEL-36, TEL-37
- **Problem:** nothing says what becomes of messages waiting, deferred or failed when the owner suspends notifications or unlinks, nor after a broken link is relinked.
- **Ruling:** turning the master switch off, or unlinking, abandons every message not yet sent — to send, deferred, being retried or failed — and nothing is sent for them later (TEL-25). Linking a new conversation in place of the old one sends the pending messages to the new one. After a definitive failure (TEL-37), unsent messages become « en échec »; once a conversation is linked again, the catch-up (CL-TEL-12) covers those still current.
- **Why:** this is the rule TEL-26 gives for a disabled category, while a broken link is a failure the owner did not choose.
- **Owner review:** no

### CL-TEL-21 — Calendar-derived events in messages

- **Affects:** TEL-06, TEL-11, TEL-12, TEL-13, TEL-18; open point 1 of ADR 0015
- **Problem:** the catalogue designates an event by player, type and press source, and the Telegram flow of an upcoming calendar-derived event is left open by ADR 0015.
- **Ruling:**
  - The alert of a sheet holding a calendar-derived event (CL-ALE-13) follows TEL-11, designating that event by player and type name and, in place of a source, "from the schedule" with the derived game; every other content of TEL-11 applies.
  - When such an event is deleted before tip-off (CL-SUI-14) on a sheet already notified, an alert update (TEL-12) says in one or two lines that the event no longer applies and why, with the sheet's state, if this is known before the game's scheduled start; when the deletion follows the owner's own change, such as a corrected birthday, nothing is sent (TEL-18).
  - Tracked-game results follow TEL-13; the mention « pas encore de backtest : ce cas compte déjà dans son profil, qui ne repose que sur ses cas suivis » never applies to a calendar-derived type.
  - Since upcoming events come only from scheduled runs (CL-SUI-14), their alerts are notified like any other.
- **Why:** this completes ADR 0015's recommended flow without new message kinds.
- **Owner review:** yes

### CL-TEL-22 — The 23:00 pass inside quiet hours

- **Affects:** TEL-19, TEL-20, TEL-21; ADR 0019
- **Problem:** the default 23:00 pass starts when the default quiet hours (23:00 to 08:00) begin.
- **Ruling:** As written in ADR 0019's consequences: its messages about games that start before 08:00 leave as urgent (TEL-21), each alone; the others wait until 08:00 and leave in the quiet-hours digest. A message composed at 23:00 or later is inside the quiet period, whose start is included and end excluded.
- **Why:** the record states the consequence; the bounds make the 23:00 case testable.
- **Owner review:** no

### CL-TEL-23 — The one-time code in the "Open Telegram" link

- **Affects:** TEL-07, TEL-29, TEL-31, IHM-10
- **Problem:** TEL-07 and IHM-10 forbid secrets in links, while TEL-29 carries a one-time code in the "Open Telegram" button.
- **Ruling:** As written: TEL-29 says the code is « porté par le bouton « Ouvrir Telegram » »; TEL-07 and IHM-10 concern the return links to the app and its screens' addresses. The code is single-use, valid 15 minutes, and its value is never written to the activity journal, refused attempts included (TEL-31).
- **Why:** the code is the linking mechanism itself, short-lived and single-use.
- **Owner review:** no

## Passed to the glossary

- Category names, the first-line labels of every catalogue entry and of the service messages: link confirmation, test, catch-up, cap reached, quiet-hours digest, pass digest, "deadline changed", "urgent".
- Message statuses « à envoyer », « différé », « envoyé », « regroupé », « abandonné », « en échec »; link states « non reliée », « en attente de confirmation », « reliée depuis le… », « rompue ».
- The closing line « Mesure du passé, pas un pronostic. »; « après le coup d'envoi »; « événement sensible »; « pas encore de backtest : ce cas compte déjà dans son profil, qui ne repose que sur ses cas suivis »; « Cette conversation n'est plus reliée à Egoscope »; « Tout est dans l'application ».
- The new parameter "catch-up interval" (CL-TEL-12).

## Ruled elsewhere

- File 14, TRV-67: recommendation — read "at most the neutral answer" as "no answer", as TEL-31 says (CL-TEL-06).
- File 13, DSN-28: the limits shown before a withdrawal include the number of Telegram messages concerned (CL-TEL-09).
