# Clarifications — 03 News collection

Rulings on the unclear points of the French spec `docs/03-collecte-des-actualites.md`, numbered `CL-COL-nn`.
The decision records (`docs/adr/`, listed in `docs/engineering/spec-deviations.md`) and these rulings override the spec text where they say so; the French spec is authoritative everywhere else, and `docs/engineering/glossary.md` fixes every English term used here.

### CL-COL-01 — The feed's item identifier is kept with the article

- **Affects:** COL-25, COL-30, COL-31, COL-34
- **Problem:** COL-30 treats "the same identifier supplied by the same feed" as the same article, but COL-25 lists exhaustively what an article keeps and omits that identifier, so the test could only work inside a single read.
- **Ruling:**
  - For each source in which an article is seen, the article keeps the pair (source, item identifier) when the item carries one (RSS `guid`, Atom `id`), as the feed gives it, trimmed, compared character for character.
  - COL-30's identifier test compares an incoming item with the kept articles holding a pair for the same source and the same identifier.
  - The pairs are erased with the article (purge, COL-36; withdrawal, COL-37). The deduplication trace stays reduced to the cleaned link and the first-collection instant (COL-34), so the identifier test never applies to deleted articles.
- **Why:** COL-30 cannot work otherwise; the identifier is public, designates no more than the link does and leaves with the article, so the minimal storage of COL-25 (D-20) holds.
- **Owner review:** no

### CL-COL-02 — The zone where a day ends the latest, and the cautious instants

- **Affects:** COL-20, COL-21, COL-22, CA-COL-07, DET-30, SUI-03, ALE-15
- **Problem:** COL-21 says "the zone where this day ends the latest" and "the zone where this time occurs the latest" without naming it, while file 08 deems a date-only event public at the end of the day Pacific time (SEN-01); agents would pick different zones.
- **Ruling:**
  - "The latest" is UTC−12 (fixed offset −12:00, IANA `Etc/GMT+12`), the last zone on Earth to finish a calendar day.
  - Date without time: the candidate instant is 23:59:59.999 of that date in the outlet time zone when the source declares one, otherwise at UTC−12 (11:59:59.999 UTC the next day).
  - Time without zone: that wall time on that date in the outlet time zone when known (precision « exacte », COL-20), otherwise at UTC−12 (precision « approximative »). A wall time that occurs twice on a clock change takes the later instant; a wall time skipped by a clock change is shifted forward by the length of the gap (02:30 becomes 03:30).
  - The retained instant is the earlier of the candidate and the first-collection instant (COL-22).
  - The retained instant is shown in the owner's time zone with its precision; nothing else of the feed's date is kept (COL-25).
  - Through DET-30 this instant is the only reference instant of a detected event: the expected game (SUI-03, ALE-15) and the measured game use it as is (see "Ruled elsewhere" for SEN-01).
- **Why:** only the literal superlative keeps COL-21's promise whatever the outlet; in today's schedules no official game tips off between about 08:00 and 16:00 UTC, so the choice moves the displayed instant but, in practice, not the measured game, and the first-collection cap keeps the instant tight when the item is read on its own day.
- **Owner review:** yes

### CL-COL-03 — Date anomaly when the cautious instant passes the first collection

- **Affects:** COL-21, COL-22, COL-48, CA-COL-08
- **Problem:** COL-22 counts a date anomaly when "the feed announces" a publication after the first-collection instant; it does not say whether a cautious COL-21 instant that lands after the first collection is an anomaly too.
- **Ruling:**
  - An item is a date anomaly when the earliest instant compatible with its own date information is later than its first-collection instant. That earliest instant is the exact instant itself; for a date without time, 00:00 of that date; for a time without zone, that wall time; the last two in the outlet time zone when known, otherwise at UTC+14 (`Etc/GMT-14`).
  - An anomaly takes the first-collection instant, the precision « approximative » and one count in the run's date anomalies (CA-COL-08).
  - When only the cautious candidate of CL-COL-02 passes the first collection, the retained instant is still the first-collection instant and the precision stays « approximative », but nothing is counted.
  - An item without any date follows COL-21 (first-collection instant, precision « absente ») and is no anomaly.
- **Why:** the counter must flag feeds that announce the future, not every date-only item read on its own day.
- **Owner review:** no

### CL-COL-04 — Reactivation, catch-up and possible gaps

- **Affects:** COL-09, COL-45, COL-46, CA-COL-20, CA-COL-22
- **Problem:** after a week of deactivation the last successful read is older than the maximum age, which literally triggers catch-up (COL-45) and a gap (COL-46), while COL-09 and CA-COL-22 forbid catching up the deactivation period.
- **Ruling:**
  - Each source has a reference instant R: the later of its last successful read and its last reactivation.
  - Catch-up applies when the time since R exceeds the maximum age; the admitted age is then the time since R. Right after a reactivation R is the reactivation instant, so the ordinary maximum age applies (CA-COL-22).
  - The gap test of COL-46 starts from R, so a deactivation period is never recorded as a possible gap.
  - The first collection run after a reactivation writes, in its entry for that source, « période non collectée (source désactivée) » with the deactivation and reactivation instants.
- **Why:** deactivation is the owner's choice and is already reported as an uncollected period; catching it up or counting it as a gap would contradict COL-09.
- **Owner review:** no

### CL-COL-05 — "Collection impossible" and per-source failures

- **Affects:** COL-41, COL-43, COL-44, CA-COL-17, CA-COL-19
- **Problem:** COL-44 replaces per-source incidents with one incident when every active source fails in a run, without saying whether sources still move toward « en panne », when that incident closes, or what one active source does.
- **Ruling:**
  - COL-44 applies to a run in which at least two sources are active and every active source failed after its attempts. With a single active source, COL-41 alone applies.
  - In such a run the app opens one « collecte impossible » incident, or keeps it open, opens no « flux en panne » incident, does not count the run in any source's consecutive failures and changes no health state; each failure still appears with its reason in the run's journal entry.
  - The incident closes at the end of the first later run in which at least one active source is read successfully; that run's entry records how long collection was impossible.
  - A « flux en panne » incident opened before stays open and follows COL-43.
- **Why:** COL-44's premise is a cause on the app's side; charging those runs to the sources would mark them down for a fault that is not theirs.
- **Owner review:** yes

### CL-COL-06 — Health transitions that COL-40 leaves implicit

- **Affects:** COL-40, COL-41, COL-42, COL-43, variant A step 4
- **Problem:** the text never says how a source leaves « jamais lue », nor what a successful read that brings no new article does to a source « en panne ».
- **Ruling:** after each read the health state is the first that applies:
  1. « en panne » when the source's reads failed in its last N counted runs (COL-41, default 2; runs in which every source failed do not count, CL-COL-05);
  2. « jamais lue » when the source has had no successful read yet;
  3. « muette » when it has brought no new article during its silence period, counted from the latest of its last new article, its first successful read and its last reactivation;
  4. « fonctionnelle » otherwise.
  - A successful read therefore ends « en panne » even without a new article: the « flux en panne » incident closes and the journal records the interruption, from the first failed run of the streak to that read. If rule 3 then applies, the source goes straight to « muette » and the silent-source warning opens; that warning closes when the state leaves « muette ».
  - Each change of state is dated (COL-40).
- **Why:** COL-41 defines failure as an unreadable feed; once it reads again, « en panne » no longer describes it, and COL-42 already covers a feed that reads but stays empty.
- **Owner review:** no

### CL-COL-07 — Origin of a run in the collection journal

- **Affects:** COL-48, COL-49, variant C, variant D
- **Problem:** COL-48 lists the origin as scheduled, on demand or with catch-up, but catch-up happens per source inside a scheduled or an on-demand run.
- **Ruling:** each entry has an origin, « planifiée » (including the run TRV-31 starts after a missed run) or « à la demande », and a separate mark « avec rattrapage » when at least one source was read with an admitted age extended by COL-45; the entry names those sources and their admitted age. The journal's origin filter offers both origins and the mark.
- **Why:** the two facts are independent, and keeping both loses nothing COL-48 asks for.
- **Owner review:** no

### CL-COL-08 — Retention clocks of not-relevant, attached and proposal-linked articles

- **Affects:** COL-36, COL-37, COL-38, CA-COL-15, CA-COL-16, DSN-09
- **Problem:** COL-37 erases an attached article's excerpt "at the term of COL-36", whose clock runs from first collection or from becoming not relevant, yet an attached article never becomes not relevant; DSN-09 also keeps the excerpt of a proposal-linked article until the decision.
- **Ruling:**
  - An article made « non pertinent » by the prefilter (reason « aucun joueur suivi ») is deleted at the first purge run on or after its first collection plus the retention duration; any other « non pertinent » article, at the first purge run on or after the instant it last became « non pertinent » plus that duration (every classified article waited first, COL-38).
  - The excerpt of an article in state « rattaché » is erased at the first purge run on or after its first collection plus the same duration (CA-COL-16), unless the article is also linked to a pending type proposal, in which case it is erased at the first purge run after that proposal is decided.
  - An article that becomes « non pertinent » through a detachment (DET-47) starts its clock at the detachment.
  - The state that applies is the one CL-DET-01 derives from the article's per-player results.
- **Why:** CA-COL-16 fixes the attached case at first collection, and the excerpt only serves detection (DSN-09), which is over once the article is attached.
- **Owner review:** no

### CL-COL-09 — Number of read attempts in a run

- **Affects:** COL-13, H-COL-04
- **Problem:** "up to a number of attempts (default 3)" can be read as three attempts or three retries, and no delay is given.
- **Ruling:** the parameter is the total number of reads of one source in one run, the first included: by default one read and at most two retries. Retries follow within the run after short pauses that technical design fixes and documents (not a setting), with at most 30 seconds of waiting per source in all. A run counts as failed for a source only when all its attempts failed.
- **Why:** H-COL-04 says « Tentatives de lecture par exécution : 3 »; the pauses must fit the hosting's execution limits (TRV-30).
- **Owner review:** no

### CL-COL-10 — Trial-read preview before the outlet time zone is entered

- **Affects:** variant A steps 2 and 3, COL-04, COL-20, CA-COL-03
- **Problem:** step 2 shows instants "as they would be retained" and the share of exactly dated items, but the outlet time zone, which changes both, is only entered at step 3.
- **Ruling:** step 2 computes the preview without an outlet time zone. When the owner enters or changes the outlet time zone at step 3, the app recomputes the instants, precisions, share of exactly dated items and the COL-04 warning from the trial read's items held in memory, without reading the feed again, and shows the result before confirmation; the warning shown at confirmation uses the zone entered. Nothing of the trial read is stored.
- **Why:** the owner must confirm on what will really be retained, and a second read is not needed.
- **Owner review:** no

### CL-COL-11 — The language "check" uses declared languages only

- **Affects:** COL-17, nominal scenario step 3
- **Problem:** the scope and step 3 speak of checking that an item is written in English or French, while COL-17 only uses declared languages.
- **Ruling:** As written: COL-17 settles it — « La langue d'un article est celle que déclare l'élément du flux, sinon celle de la source ». The app runs no language detection: an item declared in another language is counted and dropped, an undeclared item takes its source's language.
- **Why:** COL-17 is the rule; step 3 summarizes it.
- **Owner review:** no

### CL-COL-12 — Where purge runs are recorded

- **Affects:** COL-39, TRV-41
- **Problem:** COL-39 records each purge run "in the journal" without naming which.
- **Ruling:** in the activity journal, as a run of the purge task (TRV-41), with three article figures: articles deleted, excerpts erased, deduplication traces expired. The collection journal holds collection runs only.
- **Why:** the purge is a task of file 14, whose runs the activity journal already lists.
- **Owner review:** no

### CL-COL-13 — Computing a possible collection gap

- **Affects:** COL-46, CA-COL-20, CA-COL-21
- **Problem:** COL-46 does not say which date the oldest item uses, how "no run was missed" is decided, or what a source's first read does.
- **Ruling:**
  - The oldest item is the dated item of the feed, recorded or not, with the earliest instant computed by COL-19 to COL-21 before the first-collection cap; undated items are ignored, and a feed with no dated item gets no gap test.
  - A gap is recorded when that instant is after the source's reference instant R (CL-COL-04); it runs from R to that instant.
  - A source's first successful read gets no gap test.
  - The "add a collection time" warning is raised when a gap is recorded and the source's previous successful read took place in the previous collection run, scheduled or on demand, with no missed or failed run for it in between.
- **Why:** a cautious instant can only enlarge a gap, the safe side for H-01; undated items would fake a gap at every read.
- **Owner review:** no

### CL-COL-14 — Operational values the rules need

- **Affects:** COL-11, COL-36, COL-41, COL-42, COL-49
- **Problem:** the data lists omit what several rules need: the run that recorded an article, the instant it became not relevant, a source's consecutive failed runs and its last new article.
- **Ruling:** besides the listed data the app keeps: on each article, the collection run that first recorded it (COL-49) and the instant it last became « non pertinent » (COL-36); on each source, its number of consecutive failed runs (COL-41), the instant of its last read that brought a new article (COL-42), its last reactivation instant (CL-COL-04) and the daily counters of CL-COL-21. These are operational values, not article content, so COL-25's list is unchanged.
- **Why:** the rules cannot be computed otherwise, and none of these values reveals anything COL-25 or file 13 protects.
- **Owner review:** no

### CL-COL-15 — Pending articles of a withdrawn source

- **Affects:** COL-10, COL-38
- **Problem:** COL-10 sends a withdrawn source's unattached articles to ordinary retention, while articles still « à analyser » or « en attente de classification » are never deleted (COL-38); whether detection still processes them is not said.
- **Ruling:** As written: COL-10 says a withdrawn source « n'est plus lue » and that its other articles « suivent les règles de conservation ordinaires ». Withdrawing or deactivating a source stops reading it and nothing else; its articles already collected go through detection and retention exactly like the others.
- **Why:** an article's fate depends on its content and state, not on the later status of the feed it came from.
- **Owner review:** no

### CL-COL-16 — A collected article that matches a withdrawal fingerprint

- **Affects:** COL-34, COL-37, DSN-34, DET-58, edge case « Retrait d'un événement récent »; open point 4 of ADR 0017
- **Problem:** with no deduplication trace, an article still in a feed can bring a withdrawn event back (the edge case); with the keyed fingerprint of ADR 0017 detection now creates no event for such a fact, but nothing says what becomes of the article, which may not leave a deduplication trace.
- **Ruling:**
  - The classification result of the matching part (CL-DET-21) is erased at once, with no deduplication trace and no mention in the collection or detection journal beyond the run's generic counts (received, classified, quota used).
  - If the article has no other role — no other attachment, no pending proposal, no other pending part — it is erased at once like an article of a withdrawn event (COL-37, DSN-34); otherwise it keeps its other roles.
  - An erased article still offered by a feed within the admitted age is collected again as new at a later run and classified again; the app accepts that quota cost.
  - Once the fingerprint has expired (at the end of its horizon, eight weeks by default, CL-DSN-07), the edge case applies as written: the event can come back and must be withdrawn again.
- **Why:** keeping the article or its link would designate the withdrawn event beyond the keyed fingerprint, the only exception DSN-29 now allows; this is the handling ADR 0017 recommends.
- **Owner review:** yes

### CL-COL-17 — Two runs a day, and thresholds counted in runs

- **Affects:** COL-12, COL-41, COL-46, H-COL-01, CA-COL-05; ADR 0019
- **Problem:** ADR 0019 sets two collection runs a day, at 16:30 and 23:00 Paris time, while COL-41 counts consecutive failed runs and COL-46 speaks of the interval between collections, both written for one run a day.
- **Ruling:**
  - The default of « heure ou heures de collecte » is 16:30 and 23:00 in the owner's time zone; each run is one pass with its chained detection (TRV-26).
  - COL-41 keeps counting runs: with the defaults, two consecutive failed runs, 6.5 to 17.5 hours apart, make a source « en panne », where one run a day needed two days.
  - COL-46's interval between two collections is the interval between consecutive configured times.
  - CA-COL-05 keeps its own 22:00 setting as test data.
- **Why:** the record changes the hours, not how the thresholds are defined; a parameter counted in runs keeps one meaning whatever the setting.
- **Owner review:** yes

### CL-COL-18 — When two feed addresses are the same

- **Affects:** COL-07, COL-08, CA-COL-04
- **Problem:** COL-07 refuses an address already registered but does not say how addresses are compared.
- **Ruling:** two addresses are the same when they are equal after lower-casing the scheme and the host, removing a default port (80, 443) and the fragment, and removing the ad-tracking parameters that COL-28 removes from links; the path and the remaining query are compared exactly. Redirects are not followed for this comparison.
- **Why:** reusing the link cleaning keeps one rule, and following redirects would make the refusal depend on the network.
- **Owner review:** no

### CL-COL-19 — A feed that announces its own new address

- **Affects:** edge case « Flux qui change d'adresse », COL-08, IHM-36
- **Problem:** the edge case follows an address the feed itself signals, for the current run, and proposes an update, without saying what counts as a signal or where the proposal appears.
- **Ruling:** a permanent HTTP redirect (301 or 308) is the signal; temporary redirects (302, 303, 307) are followed silently and change nothing. On a permanent redirect the app reads the new address for that run, writes the old and new addresses in the run's entry for the source, and shows on that source in the press-sources screen (IHM-36) a proposal to replace the address; accepting it is a COL-08 address change, with a new trial read before saving. Without acceptance every run starts from the stored address.
- **Why:** a permanent redirect is how a feed says it moved, and the proposal belongs where sources are managed.
- **Owner review:** no

### CL-COL-20 — On-demand collection while a pass runs

- **Affects:** COL-14, COL-15, CA-COL-24, TRV-28
- **Problem:** COL-14 defers an on-demand request while another collection runs, without saying when the deferred run starts or what repeated requests do.
- **Ruling:** the unit is the pass, collection plus its chained detection (TRV-26). A request made during a pass is recorded once, as a requested run that has not started — further requests during that pass change nothing — and starts as soon as the pass ends; the screen says the collection is deferred until then. The deferred run is marked « à la demande » and does not cancel the next scheduled run (variant C).
- **Why:** TRV-28 forbids overlapping runs, and merging repeated taps keeps COL-15's no-duplicate rule trivially true.
- **Owner review:** no

### CL-COL-21 — Source indicators that survive the purge

- **Affects:** COL-11
- **Problem:** COL-11's shares over a 30-day window need articles the purge may already have deleted (retention can be set shorter than the window), and do not say which source an article seen in several feeds counts for.
- **Ruling:**
  - Each article counts for the source whose read first recorded it.
  - Per source and per day of first collection, in the owner's time zone, the app keeps three counters set at collection and prefilter time: new articles, articles kept by the prefilter, exactly dated articles. They are numbers only and survive the purge.
  - The daily average, the prefilter share and the exact-dating share come from these counters over the window; the attached share is the number of the source's articles first collected in the window that are attached now, divided by the window's new articles.
- **Why:** the owner judges a source by what it brought; counting each article once keeps the indicators additive across sources.
- **Owner review:** no

### CL-COL-22 — Labels and date display in English

- **Affects:** CA-COL-06, COL-48, COL-49, H-11; ADR 0010
- **Problem:** the labels quoted in file 03 (« à analyser », « en panne »…) and the expected display of CA-COL-06 (« mercredi 11 novembre 2026 à 5 h 10, heure de Paris ») are French, while the product is English.
- **Ruling:** As written in ADR 0010 and the register row CA-COL-06: labels take their glossary terms, and CA-COL-06 expects "Wednesday 11 November 2026, 05:10 Paris time" with the precision « exacte » in its English form. Collection still reads English and French feeds (COL-05, COL-17).
- **Why:** the owner's decision overrides H-11 for the interface, not for the press.
- **Owner review:** no

### CL-COL-23 — The ad-tracking elements removed from links

- **Affects:** COL-28, COL-30, COL-34, CA-COL-26, edge case « Lien changeant »; CL-COL-18, CL-IMP-14 (file 03 and 06 rulings)
- **Problem:** COL-28 removes "the ad-tracking elements that do not change the article designated" without listing them, while deduplication (COL-30), feed-address comparison (CL-COL-18) and the lot-1 link comparison of the import (CL-IMP-14) all rely on that cleaning.
- **Ruling:**
  - The cleaning removes from the query of a link every parameter whose name starts with `utm_`, and the parameters `fbclid`, `gclid`, `mc_cid` and `mc_eid`, names compared without regard to case. Nothing else is removed: the other parameters keep their order and values.
  - The list is one constant of the shared link module that lot 1 builds for the import (CL-IMP-14) and lot 2 reuses for collection, covered by tests; extending it is a change of that constant, never a setting.
- **Why:** these are the parameters that mark a campaign or a click without changing the page they open; a closed list keeps two links to different articles from ever being taken for one.
- **Owner review:** no

### CL-COL-24 — When the "Add a collection time" warning closes

- **Affects:** COL-46, CA-COL-21, TRV-43; CL-COL-13
- **Problem:** COL-46 raises a warning suggesting a further collection time when a gap is recorded although no run was missed (CL-COL-13), but does not say when the warning ends.
- **Ruling:** the warning belongs to its source and closes at the end of the first later successful read of that source that runs the gap test of CL-COL-13 and records no gap; a later gap recorded under the same conditions opens it again. Adding a collection time does not close it by itself: the next read shows whether the feed now keeps enough items. The warning is never notified (CL-TEL-17).
- **Why:** COL-46 only says when the warning is raised; a read without a gap is the first evidence that the feed now covers the interval between two collections.
- **Owner review:** no

## Passed to the glossary

- Health states « jamais lue », « fonctionnelle », « en panne », « muette »; activation states « active », « désactivée », « retirée » (a withdrawn source, not a withdrawn event).
- Run origins « planifiée », « à la demande » and the mark « avec rattrapage »; « période non collectée (source désactivée) ».
- Precisions « exacte », « approximative », « absente »; journal counters « incomplet », « en langue non traitée », « anomalie de date ».
- « trou de collecte possible », « flux en panne », « collecte impossible », the silent-source warning and the "add a collection time" warning.
- The attestation label « presse sportive publique ».
- The full date display of CA-COL-06, given by ADR 0010 as "Wednesday 11 November 2026, 05:10 Paris time".

## Ruled elsewhere

- File 08, SEN-01: ruled by CL-SEN-02 — the end-of-day Pacific rule applies only to events whose public date has no time (imported historical events); a detected event always carries an instant (DET-30, CL-COL-02) that SEN-03 uses as is, so its measured game and its expected game (SUI-03) come from the same instant.
- File 14, TRV-31: ruled by CL-TRV-08 — the run that TRV-31 starts after a missed collection run is a scheduled run for the collection journal (CL-COL-07) and applies COL-45's catch-up like any other run.
