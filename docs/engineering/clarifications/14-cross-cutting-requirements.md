# Clarifications — 14 Exigences transverses

Rulings on the unclear points of the French spec [`docs/14-exigences-transverses.md`](../../14-exigences-transverses.md), numbered `CL-TRV-nn`.
The decision records (`docs/adr/`, with the register `docs/engineering/spec-deviations.md`) and these rulings override the spec text where they say so; the French spec is authoritative everywhere else.

### CL-TRV-01 — English everywhere

- **Affects:** TRV-24, TRV-26, TRV-42, TRV-79, CA-TRV-13; record 0010
- **Problem:** the interface, messages, journal, task names and documentation are required in French, with French date usage and a decimal comma.
- **Ruling:** as decided: interface, messages, journal and documentation are in English, with American spelling; task names are plain English (glossary); every message answers the four questions of TRV-42 in plain English; numbers use a decimal point and a comma for thousands, with an explicit sign and a true minus (+0.62, −0.40); dates follow CL-TRV-02. Criteria that expect French strings are tested against their English equivalents.
- **Why:** record 0010.
- **Owner review:** no

### CL-TRV-02 — How instants and games are displayed

- **Affects:** TRV-24, TRV-71, CA-TRV-36, IHM-13, IHM-14, TEL-04; record 0010
- **Problem:** TRV-71 always gives a game's US date and local time, while IHM-14 recalls the US date only when it differs; the examples of 12 omit the time zone.
- **Ruling:** 14 owns the rule:
  - every instant shown to the owner — screens, Telegram, journal, readable exports — is in the owner's time zone (IHM-14, Paris by default), in the formats of record 0010 ("Wednesday 18 November 2026, 01:30 Paris time" in full, "Wed 18 Nov 2026, 01:30" in short), and the zone is named next to the instant or once in the heading of the list or table that holds it;
  - wherever a game's tip-off is shown, the game's day (CL-TRV-03) is recalled after it when it differs from the date shown in the owner's zone (IHM-14);
  - where one game is shown in full — the game block of a case, of an event's measured or expected game, of an alert sheet, of a request's deadline and of the player page's next game — the venue's local date and time are always added, with the venue's zone (TRV-71, CA-TRV-36);
  - machine formats stay ISO 8601 (record 0010).
- **Why:** the compact recall keeps lists short, as record 0010 and IHM-14 say; the full block keeps TRV-71 and its criterion.
- **Owner review:** no

### CL-TRV-03 — The day of a game, inside and outside the US

- **Affects:** TRV-70, TRV-71, TRV-72, H-TRV-11, SEN-02, STA-31, STA-32; record 0015
- **Problem:** "the day of a game is its US date" does not say which US time zone applies, nor what it means for a game played in Mexico or Europe.
- **Ruling:**
  - The day of a game is its date in US Eastern time (America/New_York), the date the league's schedule uses. The statistics source gives it directly, and it can always be computed from the tip-off instant. It is the "US date" recalled on screens and the competition day of STA-32.
  - Where a rule speaks of the local date at the venue (SEN-02, STA-31, the birthday of record 0015), the date is taken in the venue's time zone: the zone of the venue's city when the source names a known venue, otherwise the zone of the home team's arena, otherwise US Eastern time. A static table maps every NBA arena, and every venue of past international or neutral-site games, to its IANA zone. The same zone gives the local time of CL-TRV-02.
  - For official games at their usual hours both dates are the same, games played in Canada, Mexico, Europe or Asia included, since these start in the US morning, afternoon or evening.
- **Why:** one computable definition, the league's; the venue zone serves only the rules that name it.
- **Owner review:** no

### CL-TRV-04 — Backup storage: encryption, real deletion, privacy

- **Affects:** TRV-47, TRV-50, TRV-53, TRV-56, TRV-75 (steps 3, 5, 13), DSN-28, Q-TRV-01; record 0018
- **Problem:** rotation and withdrawal require an old backup to really disappear, and "reachable only after login" has to be given a meaning for storage outside the application.
- **Ruling:**
  - Each backup is one object in the owner's private space, encrypted with authenticated encryption (for example AES-256-GCM) under the key from the deployment configuration; its name holds only its creation instant in UTC and its kind (weekly, manual, before an update). It holds no key and no token (TRV-51, TRV-64).
  - Storage must delete for real. The adapter stores each backup as one deletable object, deletes it through the provider's interface, then checks that no listing and no address returns it. It never stores a backup in a git history (commits, the contents interface), a gist, or any storage that keeps versions, revisions, snapshots or a recycle bin; versioning and soft deletion must be off, which the installation check verifies where the provider allows. Release assets of a private repository deleted through the interface, or the host's file storage, qualify; the service sheet records the choice (record 0011).
  - Rotation: after each successful backup, every backup beyond the configured number is deleted, the most recent being kept, all kinds counted together. A failed or unverified deletion opens the "backup failed" incident, and the backup stays in the application's backup register as still stored.
  - "Only after login" (TRV-56) means never public: the space is private, and no address that reads a backup without the owner's credentials is ever created (no public link, no "anyone with the link"). Before each upload the adapter checks that the space is private; if it is not, it uploads nothing and opens "backup failed" with that cause. The application offers no download of backups; exports are downloaded only after login.
  - A missing key or token, an unreachable space or a failed upload opens "backup failed" (TRV-50), one incident per cause, closed by the next successful backup (TRV-45).
  - The installation check (TRV-47) writes a test object, reads it back, decrypts it, deletes it, verifies that it is gone, and checks that the space is private.
- **Why:** a backup kept anywhere after rotation would break TRV-50 and DSN-28 (record 0018).
- **Owner review:** no

### CL-TRV-05 — What backups and full exports contain

- **Affects:** TRV-51, TRV-52, TRV-53, TRV-57, TRV-63, DSN-32; records 0017 and 0018
- **Problem:** TRV-51 lists the content loosely; the drafts, the fingerprints and the account data need an explicit answer.
- **Ruling:**
  - A backup holds all the application's data — players, types and sheets, requests, events of every origin, import traces, articles, cases, statistics, profiles and verdict history, alert sheets, tracked cases, Telegram texts and the link to the conversation, settings, the activity journal with its technical details, incidents and task-run history — and the value of the withdrawn-events counter.
  - It never holds: deployment configuration values; drafts (CL-DSN-17); the entries of the withdrawal ledger (CL-DSN-08); the account's password data (its hash and the fingerprint of the initial password, TRV-63); sessions and login-failure state.
  - A full export (TRV-52) holds the same as a backup, unencrypted, in its documented open format.
  - A restore keeps the target database's account data, if it has any, and closes all sessions; otherwise the account is initialized from the configured initial password (TRV-57) and the owner chooses a new one.
- **Why:** the exclusions are what 13 forbids or what must not travel between installations; the rest rebuilds the application identically.
- **Owner review:** yes — after a restore into a new database the owner logs in with the initial password and sets a new one.

### CL-TRV-06 — What a restore does with withdrawals and deletions made since the backup

- **Affects:** TRV-53, TRV-77, CA-TRV-16, CA-TRV-25, DSN-28, DSN-29, JOU-24; records 0017 and 0018
- **Problem:** restoring an older backup brings back events withdrawn and players deleted after it, and an older counter value.
- **Ruling:**
  - A restore targets either the current database, whose application data it replaces, or a new empty one (TRV-53). It needs the backup key (record 0018) and runs as one documented command.
  - It never overwrites the withdrawal ledger (CL-DSN-08) nor the account data (CL-TRV-05). When the target is a new database and the previous one is still reachable, as when the database service is replaced (TRV-77), the command first copies the ledger from the previous database.
  - After loading the data it re-applies the ledger, without changing the counter and without creating any fingerprint:
    - a restored player whose identifier matches a deleted-player entry (CL-JOU-24) is deleted again, with the scope of JOU-24;
    - for each live fingerprint, the restored events of the same player and type are compared with its day: exactly one on that day is withdrawn again with the scope of DSN-27, with no new attempt to delete Telegram messages; when several fall on that day, or none does but some fall within the matching window (CL-DSN-06), none is withdrawn and the restore summary lists them, each with a link, for the owner to check.
  - The counter keeps the larger of the ledger's value and the backup's.
  - Then a full recalculation (SEN-34) and the consistency check run. The summary (TRV-53, CA-TRV-16) shows the counts, the backup's date, the number of withdrawals and deletions re-applied (numbers only), the events to check, and these warnings: changes made after the backup's date — imports, corrections, dismissals, requalifications, settings — are lost; when the ledger could not be carried over, events withdrawn after that date may be back and must be withdrawn again; when the file is older than the fingerprint horizon (an old export), events withdrawn between the file's date and the start of the horizon may be back. Every draft is erased and every session closed.
- **Why:** every withdrawal and deletion made since the backup still holds whenever the application can know it; a restored event is withdrawn automatically only when it is certainly the same one.
- **Owner review:** yes — a restore withdraws and deletes again on its own, and asks the owner to check the ambiguous cases.

### CL-TRV-07 — Runs that crashed

- **Affects:** TRV-26, TRV-28, TRV-30, CA-TRV-08, CA-TRV-09; record 0002
- **Problem:** a task never starts while its previous execution is unfinished, and a crashed execution never finishes.
- **Ruling:**
  - Each run records its start, a progress mark at the end of each portion (TRV-30), its end and its result: succeeded, failed or interrupted.
  - A run counts as running while its latest progress mark, or its start, is more recent than the stale delay: twice the host's maximum duration of one invocation, a constant of the code recorded in the hosting service sheet.
  - At each wake-up, a run older than that is closed as "interrupted", its end being the moment it was found stale; this is written to the journal at the warning level and its lock is released. The next portion resumes from the last progress mark (TRV-30), in the same wake-up if the task is still due.
  - Repeated interruptions open no incident of their own: once no run succeeds in time, the missed-run rule (CL-TRV-08) opens "task not run".
  - The deferral of TRV-28 is written to the journal once per postponed occurrence, not at every wake-up.
- **Why:** on serverless hosting a crashed invocation never marks its run finished; without a stale delay, the lock would block the task for good.
- **Owner review:** no

### CL-TRV-08 — Missed runs for timed, chained and conditional tasks

- **Affects:** TRV-25, TRV-31, CA-TRV-10, H-TRV-07; record 0002
- **Problem:** the "planned interval" of TRV-31 is undefined for chained tasks, for the queue resumption that runs "while not empty", and for the notification task.
- **Ruling:** due occurrences are checked at each wake-up, at the end of each pass and at each opening of the application.
  - Timed tasks — collection and detection, statistics update, purge, backup: each configured time is an occurrence due at that time; the statistics update follows CL-TRV-23.
  - Chained tasks — detection after collection, game tracking after the statistics update: each successful run of the parent is an occurrence, due at the parent's end.
  - Conditional tasks — classification-queue resumption, retries of statistics fetches, sending of notifications: an occurrence is due one interval after the previous run started, and exists only if the condition holds then (queue not empty, fetch pending, message due).
  - An occurrence is missed when no run of the task started at or after its due time has succeeded by the due time plus the margin (TRV-31, 2 hours by default). The application then writes one journal entry per missed occurrence, opens one "task not run" incident per task (TRV-45) and starts one catch-up run at once, not one per missed occurrence; the owning file's catch-up rules apply (COL-45). The incident closes when a run of the task succeeds.
- **Why:** occurrences give every kind of task a precise due time, which an "interval" does only for timed ones.
- **Owner review:** no

### CL-TRV-09 — Collection and detection hours

- **Affects:** TRV-25, TRV-38, COL-12, CA-TRV-07, CA-TRV-40; record 0019
- **Problem:** TRV-25 allows "one or several" collections a day, while TRV-38 says the daily frequency is fixed and "only the hour" can be set.
- **Ruling:** as decided: two runs a day by default, at 16:30 and 23:00 Paris time, each a collection followed by detection in one pass. TRV-38 reads: the times of day can be set, from one to six a day (CL-TRV-16), but a daily run cannot be removed (D-15). CA-TRV-07 is tested with the 23:00 run; the announcement of CA-TRV-40 names both times in the new zone ("16:30 and 23:00 New York time").
- **Why:** record 0019; D-15 fixes a daily cadence, not a single run.
- **Owner review:** no

### CL-TRV-10 — Cleaning the journal when an event is withdrawn

- **Affects:** TRV-41, TRV-44, CA-TRV-39, DSN-29, IMP-37
- **Problem:** journal entries designate events by player, type and date, and these mentions must disappear at a withdrawal, which makes the journal mutable.
- **Ruling:**
  - An entry never copies an event's player, type, date, description or source into its text: it holds a fixed message and references by identifier (event, player, request, import, alert sheet, type), and the text shown is built when the entry is displayed or exported.
  - When an item is erased (withdrawal, deletion, replacement, requalification, dropped derivation, player deletion), its references are removed from every entry, which then reads "an item that no longer exists" or "a deleted player"; technical details of an entry that concerned only that event are deleted.
  - Counts about an import are read from the import trace, which a withdrawal reduces (IMP-37), and are never stored in the entry.
  - The withdrawal itself is written as "an event was withdrawn", with no player, type or date (TRV-41).
  - Apart from this scrubbing and the retention purge (TRV-48), entries are never changed.
- **Why:** references resolved at display time erase every mention at once and keep the journal otherwise append-only.
- **Owner review:** no

### CL-TRV-11 — The owner closing an incident

- **Affects:** TRV-45, IHM-20, TEL-15
- **Problem:** TRV-45 lets the owner close an incident, while 12 lets him hide one that stays open; whether a closed incident whose cause persists comes back is not said.
- **Ruling:** the owner can hide an open incident (IHM-20: it stays open, counted as hidden) or close it (TRV-45). Closing ends it at once, with "closed by the owner" in the journal; if the application observes the same cause again later, it opens a new incident. The TRV-06 incident, whose end the application cannot observe, closes when the owner saves a new value for that limit, or when he closes it.
- **Why:** closing must not silence a cause that persists.
- **Owner review:** no

### CL-TRV-12 — Quota periods and resets

- **Affects:** TRV-03, TRV-05, TRV-06, TRV-09, TRV-46, CA-TRV-02, CA-TRV-03
- **Problem:** "the limit is reached for the period" requires knowing when each period resets, which differs by provider.
- **Ruling:** each quota limit is a parameter with its service, its unit (calls, requests, tokens, bytes, files), its period (minute, day, month, or a rolling window of a stated length) and, for a fixed period, its reset instant and time zone (for example 00:00 UTC); the service sheet gives them (TRV-09 gains "period and reset"). Consumption is counted per limit and per period instance, and the warning of TRV-05 is given once per limit and period instance. A refusal for quota (TRV-06) marks the limit reached until the next reset or, for a rolling window, until the oldest counted operation leaves it. The status screen gives the next reset in the owner's time zone (TRV-46). A limit not yet entered makes the installation check fail for that service; consumption is still counted and TRV-06 still applies.
- **Why:** a period means nothing until its reset is known.
- **Owner review:** no

### CL-TRV-13 — What is reachable without a session

- **Affects:** TRV-58, TRV-65, CA-TRV-19, DSN-33
- **Problem:** "what is strictly necessary to install the application" is not listed.
- **Ruling:** without a session, only these answer: the login page and the static files it needs; the web app manifest; the icons; the service worker script; `robots.txt`; and the machine endpoints that check their own secret (the task trigger, TRV-65; Telegram updates if a webhook is used, with Telegram's secret token). Every other page redirects to the login page and every other data request is refused. Every response carries `X-Robots-Tag: noindex, nofollow`, and `robots.txt` disallows everything. The service worker caches no data before login and clears its data at logout (DSN-33).
- **Why:** a closed list makes TRV-58 testable.
- **Owner review:** no

### CL-TRV-14 — Replacing the statistics source

- **Affects:** TRV-12, TRV-15, TRV-77, STA-03, STA-42
- **Problem:** a replacement must lose no data, while stored statistics rest on the old source's identifiers.
- **Ruling:** a replacement keeps every stored statistic — schedules, results, box-score lines — with the identifiers of the source it came from, and never fetches a consolidated game again (STA-42). Players are mapped to the new source by its published crosswalk where one exists, otherwise by a new JOU-10 confirmation; teams and games are matched between the sources by date, home team and away team for the seasons still open. No case changes because of the replacement alone. The procedure is the one of the statistics service sheet (TRV-77).
- **Why:** "without loss of data" holds only if stored data never depends on the new source.
- **Owner review:** no

### CL-TRV-15 — TRV-60 cited twice by IHM-09

- **Affects:** TRV-60, IHM-09
- **Problem:** IHM-09 cites TRV-60 for two different rules.
- **Ruling:** as written: TRV-60 covers both the minimum length and the closing of the other sessions when the password changes.
- **Why:** both rules are in TRV-60.
- **Owner review:** no

### CL-TRV-16 — Bounds of every parameter

- **Affects:** TRV-34, TRV-35, TRV-38, TRV-39, TRV-40, CA-TRV-11, CA-TRV-28
- **Problem:** TRV-34 requires the allowed values of each parameter, and no file gives them.
- **Ruling:** the settings screen shows and enforces these bounds, inclusive, integers unless a step is given; a value outside is refused with the bounds in the message. A bound stated by the owning file or its clarifications wins over this table.

  | Parameter (requirement) | Default | Allowed values |
  | --- | --- | --- |
  | Maximum active players (JOU-04) | 30 | 1 to 100 |
  | Indicative minimum (JOU-04) | 20 | 0 to 100, at most the maximum; 0 means no reminder |
  | Exposure period (JOU-03) | 30 days | 1 to 90 days |
  | Prolonged absence (JOU-22) | 10 games | 1 to 82 games |
  | Source-indicator period (COL-11) | 30 days | 1 to 90 days |
  | Collection times (COL-12) | 16:30 and 23:00 | 1 to 6 distinct times of day, at least 60 minutes apart |
  | Read attempts (COL-13) | 3 | 1 to 5 |
  | Maximum article age (COL-24) | 3 days | 1 to 14 days |
  | Excerpt length (COL-27) | 500 characters | 100 to 1,000 |
  | Title-dedup window (COL-30) | 6 hours | 1 to 72 hours |
  | Dedup-trace retention (COL-34) | 180 days | 7 to 365 days, at least the maximum article age |
  | Non-relevant article retention (COL-36) | 30 days | 1 to 180 days |
  | Failed runs before "down" (COL-41) | 2 | 1 to 10 |
  | Silence delay (COL-42) | 3 days | 1 to 30 days |
  | Priority horizon (DET-09) | 48 hours | 1 to 240 hours |
  | Queue resumption interval (DET-10) | 6 hours | 1 to 24 hours |
  | Classification attempts (DET-22) | 2 | 1 to 5 |
  | Detection threshold (DET-24) | 70 | 1 to 100 |
  | Grouping window (DET-29) | 72 hours | 1 to 240 hours |
  | Maximum sources per event (H-BKT-09) | 3 | 1 to 10 |
  | Maximum pasted size (IMP-02) | 2 MB | 0.5 to 4 MB, step 0.5 |
  | Tolerated source lead (IMP-14) | 1 day | 0 to 7 days |
  | Disallowed domains (IMP-14) | list of H-IMP-13 | 0 to 500 domain names, lowercase, without scheme or path |
  | Link check (IMP-17) | on | on, off |
  | Sources offered for sampling (IMP-23) | 3 | 1 to 20 |
  | Maximum gap between public dates (IMP-25) | 2 days | 0 to 7 days |
  | Playing-time floor (STA-14) | 15 minutes | 0 to 48 minutes |
  | Fraction of average minutes (STA-14) | 50 % | 0 to 100 % |
  | Baseline for play-in and playoffs (STA-18) | playoffs | playoffs, regular season |
  | Minimum baseline size (STA-19) | 10 games | 2 to 82 games |
  | Partial-baseline threshold (STA-24) | 20 % | 0 to 100 % |
  | Delay after the last tip-off (STA-32) | 3 hours | 1 to 12 hours |
  | Correction window (STA-33) | 7 days | 1 to 30 days |
  | Delay before "unavailable" (STA-35) | 30 days | 1 to 365 days, at least the correction window |
  | Retry delays (STA-36) | 1 hour, then every 4 hours | first 0.25 to 24 hours, then 1 to 24 hours, step 0.25 |
  | Delay before incident (STA-37) | 12 hours | 1 to 72 hours |
  | Quota reserve (STA-39) | 10 % | 0 to 50 % |
  | Maximum attachment delay (SEN-04) | 10 days | 1 to 60 days |
  | Concomitant cases as doubtful (SEN-06) | no | yes, no |
  | Return from injury: games missed, first games (SEN-13) | 4, 2 | 1 to 82; 1 to 10 |
  | Every playoff game as unusual stakes (SEN-14) | no | yes, no |
  | Opponent level: low, high (SEN-15) | 25 %, 75 % | 0 to 49 %; 51 to 100 % |
  | Opponent's minimum games (SEN-15) | 10 | 1 to 82 |
  | Valid cases for a player verdict (SEN-23) | 5 | 2 to 100 |
  | Signal-to-noise for "possible", "probable" (SEN-23) | 2, 3 | 0.5 to 10, step 0.1; "probable" at least "possible" |
  | Mean gap for "possible", "probable" (SEN-23) | 0.25, 0.40 | 0 to 5, step 0.01; "probable" at least "possible" |
  | Profile confidence: medium from, high from (SEN-25) | 8, 15 cases | 1 to 200; 2 to 500, above medium |
  | Dispersion drop (SEN-25) | 1.5 | 0.1 to 10, step 0.1 |
  | Doubtful-share drop (SEN-25) | 30 % | 0 to 100 % |
  | Trend: minimum players, top player's share (SEN-29) | 3, 50 % | 1 to 30; 1 to 100 % |
  | Counts instead of proportions below (SEN-39) | 20 cases | 1 to 200 cases |
  | Vigilance margin (ALE-16) | 10 points | 0 to 100 points |
  | Category threshold (SUI-22) | 0.25 | 0 to 5, step 0.01 |
  | Minimum tracked cases for an assessment (SUI-26) | 10 | 1 to 200 |
  | Reminder delay (TEL-10) | 6 hours | 1 to 48 hours |
  | Incident reminder, incident recurrence delay (TEL-15) | 3 days, 6 hours | 1 to 30 days; 0 to 48 hours |
  | Grouping threshold, facts per grouped message (TEL-19) | 3, 10 | 1 to 20; 1 to 50 |
  | Quiet hours (TEL-20) | 23:00 to 08:00 | any start and end; equal means none; may span midnight |
  | Urgency exception and category switches (TEL-21, TEL-24) | on | on, off |
  | Daily cap (TEL-22) | 20 messages | 1 to 200 |
  | Link-code validity (TEL-29) | 15 minutes | 5 to 60 minutes |
  | Retry intervals (TEL-35) | 1, 5, 15, 30, 60 minutes | 1 to 10 values, strictly increasing, each 1 to 1,440 minutes |
  | Time zone (IHM-14) | Europe/Paris | any zone of the IANA time-zone database |
  | List page size (IHM-18) | 50 | 10 to 200 |
  | "Deadline near" delay (IHM-20) | 24 hours | 1 to 168 hours |
  | Draft lifetime (IHM-42) | 7 days | 1 to 30 days |
  | Research tool address (IHM-44) | none | empty, or an https address of at most 2,000 characters |
  | Maximum description length (DSN-20) | 200 characters | 80 to 500 |
  | Quota limits (TRV-03) | none | empty until entered, then an integer of at least 1 |
  | Quota warning share (TRV-05) | 80 % | 1 to 99 % |
  | Volume warning share (TRV-07) | 80 % | 1 to 99 % |
  | Statistics update: start, cut-off (TRV-25, CL-TRV-23) | 15:00, 20:00 | any times of day, the cut-off at least one hour after the start |
  | Statistics update: probe interval while waiting (CL-TRV-23) | 60 minutes | 15 to 120 minutes |
  | Statistics update: late days before the incident (CL-TRV-23) | 2 | 1 to 7 |
  | Purge time (TRV-25) | 04:00 | any time of day |
  | Backup day and time (TRV-50) | Monday 05:00 | a weekday or "every day", and a time of day |
  | Backups kept (TRV-50) | 8 | 1 to 52 |
  | Missed-run margin (TRV-31) | 2 hours | 0.25 to 24 hours, step 0.25 |
  | Journal retention (TRV-48) | 90 days | 7 to 365 days |
  | Export reminder delay (TRV-54) | 30 days | 1 to 365 days |
  | Minimum password length (TRV-60) | 12 | 12 to 128 |
  | Login failures, observation period, lockout (TRV-61) | 5, 15 minutes, 15 minutes | 3 to 20; 1 to 1,440 minutes; 1 to 1,440 minutes |
  | Session idle timeout (TRV-62) | 30 days | 1 to 365 days |
  | Coverage threshold of a sheet (CL-TAX-14) | 3 outlets in 2 days (media-storm draft) | 2 to 10 outlets; 1 to 7 days |

- **Why:** bounds stop values that would empty a rule of meaning (a verdict on zero cases, a "probable" threshold below "possible") without choosing for the owner; the password floor keeps the security default from being weakened.
- **Owner review:** yes — values outside these ranges are refused, and the minimum password length cannot go below 12.

### CL-TRV-17 — Which parameters affect calculations

- **Affects:** TRV-35, TRV-36, IHM-51, SEN-37, SUI-25; record 0016
- **Problem:** the date of the last change of a parameter that affects calculations is shown, but the set of such parameters is only hinted at ("documents 07, 08 and 10").
- **Ruling:** the date moves when any parameter owned by 07, 08 or 10 changes, and when a type's doubtful-criterion switch changes (CL-TAX-17). It does not move for the detection threshold (not retroactive, TRV-36), for the import parameters of 06 or for the description length of 13. The registry marks the parameters concerned, and the settings screen shows the mark.
- **Why:** TRV-35 names the three files; record 0016 adds the switch.
- **Owner review:** no

### CL-TRV-18 — Local times that do not exist or occur twice

- **Affects:** TRV-27
- **Problem:** "a single execution" does not say when it happens.
- **Ruling:** a configured time that does not exist on a spring clock-change day runs at the first instant after the gap; a time that occurs twice on an autumn clock-change day runs at its first occurrence only. The default times (04:00, 05:00, 15:00, 16:30, 23:00 Paris time) are never affected.
- **Why:** one testable instant for each case.
- **Owner review:** no

### CL-TRV-19 — No structure change without a backup first

- **Affects:** TRV-55, TRV-76, TRV-77, CA-TRV-25
- **Problem:** nothing says what happens when the backup that must precede a structure change fails.
- **Ruling:** the step that changes the database structure during an update (TRV-76) first makes a backup of kind "before an update" and checks that it is stored. If that backup fails, no structure change is applied, the update stops with its cause shown, the previous version keeps running on unchanged data, and the "backup failed" incident opens. Only the first installation, on an empty database, has nothing to back up.
- **Why:** the rollback of CA-TRV-25 is only possible if the backup exists.
- **Owner review:** no

### CL-TRV-20 — The deployment checklist

- **Affects:** TRV-74, TRV-75, TRV-77, TRV-79, CA-TRV-24; records 0002, 0008, 0014, 0017, 0018
- **Problem:** the guide is now written for a developer; some of the sixteen steps assume options the decisions removed.
- **Ruling:** as decided, the guide is a developer's checklist; each of the sixteen steps of TRV-75 has an action and a check, with the exact command where one is needed, and:
  - step 3 always creates the backup space, and the trigger account if the trigger needs one;
  - step 5 lists every value of the single list of record 0008, the fingerprint secret, the backup key and the backup token included;
  - step 7 programs one external wake-up call — its address, cadence and secret — instead of one schedule per task, since the application keeps its own schedule (record 0002);
  - step 12 checks, on the status screen, each task's next run as the application computes it;
  - step 13 always runs a manual backup and checks it in the space, decrypting it with the key.

  CA-TRV-24 is read for a developer who has the repository and the owner's accounts (register).
- **Why:** record 0014; the other records remove the "if one exists" options.
- **Owner review:** no

### CL-TRV-21 — The robot's "neutral answer"

- **Affects:** TRV-67, CA-TRV-34, TEL-31
- **Problem:** TRV-67 allows "at most the neutral answer" of 11, which 11 never defines and which TEL-31 replaces with no answer.
- **Ruling:** the neutral answer is no answer: the robot never replies to a conversation other than the linked private one, except within the linking exchange of TEL-29 and TEL-30. Each attempt is written to the journal with its instant and the kind of conversation (private, group, channel), never the text or the sender's identity.
- **Why:** "at most" allows none; silence gives a stranger nothing.
- **Owner review:** no

### CL-TRV-22 — When the export reminder starts

- **Affects:** TRV-54, CA-TRV-18, TEL-15
- **Problem:** the delay "since the last export" has no start when no export was ever made.
- **Ruling:** the delay counts from the last full export downloaded or, when none was, from the first start. The reminder stays on the status screen until a full export is downloaded; in Lot 2 it sends one message per reminder (TEL-15). Partial exports do not reset it.
- **Why:** only a full export can rebuild the application (TRV-53).
- **Owner review:** no

### CL-TRV-23 — Daily statistics update: default hour and waiting for the source

- **Affects:** TRV-25, TRV-28, TRV-31, TRV-38, TRV-45, H-TRV-07, STA-32, STA-36, STA-37, SUI-12; statistics service sheet
- **Problem:** the default hour of the daily statistics task is 12:00 Paris time, but the chosen source published the previous night between about 11:30 and 13:30 UTC on 22 days out of 23, and at 16:31 UTC on the other: a noon run would never see the previous night's games.
- **Ruling:**
  - The update starts by default at 15:00 in the owner's time zone, an editable parameter that replaces the 12:00 of H-TRV-07. From that time it waits for the source: it checks the source's refresh instant (the publication probe of the service sheet) at each probe interval, 60 minutes by default, and starts fetching as soon as the source has refreshed after the last scheduled tip-off of the past competition day plus the STA-32 delay. After a competition day without games it does not wait. The wait ends at the cut-off, 20:00 by default, editable, at least one hour after the start; the run then fetches what is published and ends with the result "source late". A manual run (TRV-33) never waits.
  - Waiting is not running: no lock is held between checks (TRV-28), so a manual run can take place meanwhile; any run, manual or scheduled, that ingests a refresh made after the last game satisfies the day's occurrence.
  - For missed runs (TRV-31, CL-TRV-08) the occurrence is due at the start time and each check counts as an execution: the occurrence is missed only if no check or run happened within the margin of the start or of the previous check, or if by the cut-off plus the margin it has neither ingested a refresh nor ended "source late". A late source is never "task not run".
  - While waiting, the status screen shows "Statistics: waiting for the source's daily refresh (last refresh <instant>); next check at <time>; cut-off at <time>". A day that ends "source late" writes a warning to the journal and shows on the status screen "Last night's games not yet published by the source (last refresh <instant>); next attempt tomorrow at <start>"; the cases waiting for those games keep the reason "statistics pending" (STA-36); no Telegram message is sent for one late day. When the source is late on a number of consecutive competition days, 2 by default, editable, the incident "statistics source unavailable" (STA-37) opens with the cause "not refreshed since <instant>", is notified like any incident (TEL-15), and closes when a refresh lands. Failed checks (no answer, errors) follow STA-36 and STA-37 as written.
  - Nothing downstream needs statistics at noon: detection at 16:30 and 23:00 reads the next game from the schedule; game tracking stays chained to the update (SUI-12) and the validation table follows it; result messages (TEL-13) go out in the afternoon, outside the default quiet hours; frozen forecasts are taken at tip-off, after the update. When the update lands before 16:30, that run's alert sheets include the previous night's cases; when it lands later, they use the profiles as they stand, and the 23:00 run's sheets include them.
  - The three new settings — cut-off, probe interval, late days before the incident — are parameters of 14 and join the registry (TRV-38, TRV-40; bounds in CL-TRV-16).
- **Why:** at 15:00 the refresh has landed, or lands within the next hour, on 22 days out of 23 measured; the cut-off bounds the wait and keeps the day's results ahead of the evening run.
- **Owner review:** yes — the default hour moves from 12:00 to 15:00, tracked results arrive in the afternoon, a late source is shown as a warning and then an incident, and three settings are added.

## Ruled elsewhere

- **Venue time zones and the waiting rule in 07's terms** — owned by 07 (STA-31, STA-32, STA-36, STA-37): recommendation, use the venue-zone table of CL-TRV-03 for STA-31 and apply the wait and the late-source incident of CL-TRV-23 as written.
- **Mechanics of a statistics-source replacement and of two combined sources** — owned by 07 (STA-03; record 0012): recommendation, follow CL-TRV-14 and the service sheet's crosswalk procedure, one source per season.
- **End message of an incident the owner closed** — owned by 11 (TEL-15): recommendation, send none, since the owner closed it himself.
- **Placement of the date recall and of the full game block** — owned by 12 (IHM-14): recommendation, compact recall in lists and messages, full block in the game views CL-TRV-02 names, the part-of-day word ("evening") taken from the venue's local time.

## Passed to the glossary

- Task names (TRV-26), incident names — "task not run", "backup failed", "statistics source unavailable" with its cause "not refreshed since …" — and the journal levels.
- The English form of the TRV-42 example.
- Date and time patterns, zone labels ("Paris time"), the phrasing of the US-date recall and of the venue's local time.
- Run results "succeeded", "failed", "interrupted", "source late"; "on demand"; "closed by the owner"; "an event was withdrawn"; "an item that no longer exists"; "a deleted player".
- The status-screen lines of CL-TRV-23 and the restore summary's warnings (CL-TRV-06).
