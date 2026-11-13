# Domain model — news collection (Lot 2)

Press sources, articles, deduplication, collection runs and possible collection gaps: file 03 (COL-01 to COL-50) as ruled by `CL-COL-01` to `CL-COL-24`, with ADR 0017, ADR 0019 and `CL-DSN-10`. Detection's use of articles (parts, results, attachments) is in [detection.md](detection.md); the shared entities this file points to (players, events, incidents, task runs, parameters, withdrawal fingerprints) belong to the core model.

**Conventions.** Tables are snake_case plural, enumerations are `text` with a `CHECK` on the glossary's snake_case values, `id` is an `integer` identity primary key. An instant is `timestamptz` (`EpochMs` in code); a calendar date is `date` (`IsoDate` in code) and its calendar is stated on the column. Columns that reference core tables take the type of the referenced key: `integer`, except `followed_players.id`, a `uuid`, and `event_types.id`, a `text` slug; core table and column names are those of the core model. Parameter keys are the module map's (section 6, namespaced by family) and task keys its section 4's; the optimistic-concurrency counter is `row_version` (CL-IHM-18).

**Sensitive-data classes** used in the column tables are the core model's (domain-model README §3) — `—` nothing sensitive, `PI` about a followed player, `EV` designates or reveals one event, `TX` a free text under the wording rules, `PR` a press reference as published — plus two that only Lot 2 needs:

| Class | Meaning | Erased by | In backups and full exports |
| --- | --- | --- | --- |
| `EX` | Feed text beyond the reference (an article's excerpt): serves detection only (DSN-09). | the purge on schedule, or with its article | yes, while it exists |
| `OW` | Identifies the owner's Telegram account: a chat identifier, a link code's digest. | unlinking empties the link; a code's digest by the purge; a message's identifiers with its text | the chat identifiers yes, link codes no |

A press reference (`PR`) of an attached article also designates its event, so the event's withdrawal erases it (DSN-27, DSN-34).

## 1. Entities

### 1.1 Press source — `press_sources`

A public sports-press feed the owner registered after a trial read and the attestation (COL-02 to COL-10). Never deleted: withdrawal is a status (COL-10).

| Column | Type | Null | Default | Constraint or reference | Class | Spec |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | integer identity | no | — | primary key | — | COL-02 |
| `outlet_name` | text | no | — | `CHECK (btrim(outlet_name) <> '')` | — | COL-06, COL-08 |
| `feed_url` | text | no | — | `CHECK (feed_url ~ '^https?://')`; the address as the owner entered it | — | COL-02, COL-08 |
| `feed_url_key` | text | no | — | comparison form of `feed_url` (CL-COL-18): scheme and host lower-cased, default port and fragment removed, ad-tracking parameters of COL-28 removed | — | COL-07, CL-COL-18 |
| `language` | text | no | — | `CHECK (language IN ('en','fr'))` | — | COL-05 |
| `outlet_time_zone` | text | yes | null | IANA zone name, checked by the service against the time-zone database | — | COL-04, COL-08, COL-20 |
| `silence_period_days` | smallint | yes | null | `CHECK (silence_period_days BETWEEN 1 AND 30)`; null means the parameter `collection.silencePeriodDays` | — | COL-08, COL-42, CL-TRV-16 |
| `public_sports_press_attested_at` | timestamptz | no | — | set once, when the source is added | — | COL-03 |
| `activation_status` | text | no | `'active'` | `CHECK (activation_status IN ('active','deactivated','withdrawn'))` | — | COL-09, COL-10, COL-40 |
| `withdrawn_at` | timestamptz | yes | null | `CHECK ((activation_status = 'withdrawn') = (withdrawn_at IS NOT NULL))` | — | COL-10 |
| `health_status` | text | no | `'never_read'` | `CHECK (health_status IN ('never_read','working','down','silent'))` | — | COL-40 |
| `health_status_changed_at` | timestamptz | no | — | instant the current health status began ("down since …") | — | COL-40, CA-COL-28 |
| `first_successful_read_at` | timestamptz | yes | null | | — | CL-COL-06 |
| `last_successful_read_at` | timestamptz | yes | null | `CHECK (last_successful_read_at >= first_successful_read_at)` | — | COL-11, COL-45, COL-46 |
| `last_new_article_at` | timestamptz | yes | null | instant of the last read that stored a new article | — | COL-42, CL-COL-14 |
| `consecutive_failed_runs` | smallint | no | 0 | `CHECK (consecutive_failed_runs >= 0)`; runs in which every active source failed are not counted (CL-COL-05) | — | COL-41, CL-COL-05, CL-COL-14 |
| `failure_streak_started_at` | timestamptz | yes | null | instant of the first failed counted run of the current streak; `CHECK ((consecutive_failed_runs = 0) = (failure_streak_started_at IS NULL))` | — | COL-43, CL-COL-06 |
| `proposed_feed_url` | text | yes | null | address a permanent redirect announced (CL-COL-19); `CHECK (proposed_feed_url ~ '^https?://')` | — | CL-COL-19 |
| `row_version` | integer | no | 1 | incremented at every save; a save carrying another version is refused | — | CL-IHM-18 |

- **Unique and indexes:** `press_sources_feed_url_key_uq` unique `(feed_url_key) WHERE activation_status <> 'withdrawn'` — refuses an address already used by an active or deactivated source while freeing a withdrawn source's address (COL-07, COL-10). No other index: the table holds tens of rows.
- **Deletion:** never deleted; every reference to it is `ON DELETE RESTRICT`.
- **TypeScript:** `id: PressSourceId` (branded `number`); `language: Language`, `activationStatus: ActivationStatus`, `healthStatus: HealthStatus` are unions; instants are `EpochMs`; `feedUrlKey` is not exposed outside the module.

### 1.2 Deactivation period — `press_source_deactivations`

One period during which the owner had a source deactivated; never caught up (COL-09) and never counted as a collection gap (CL-COL-04).

| Column | Type | Null | Default | Constraint or reference | Class | Spec |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | integer identity | no | — | primary key | — | COL-09 |
| `press_source_id` | integer | no | — | → `press_sources.id` `ON DELETE RESTRICT` | — | COL-09 |
| `deactivated_at` | timestamptz | no | — | | — | COL-09 |
| `reactivated_at` | timestamptz | yes | null | `CHECK (reactivated_at > deactivated_at)`; stays null if the source is withdrawn while deactivated | — | COL-09, CL-COL-04 |

- **Unique and indexes:** `press_source_deactivations_open_uq` unique `(press_source_id) WHERE reactivated_at IS NULL` — at most one open period; `press_source_deactivations_source_idx` `(press_source_id, reactivated_at)` — the last reactivation that enters the reference instant R (CL-COL-04) and the uncollected-period note of the next run.
- **Deletion:** never deleted.
- **TypeScript:** `reactivatedAt: EpochMs | null`.

### 1.3 Source daily counts — `press_source_daily_counts`

Numbers per source and day of first collection that keep the indicators of COL-11 correct after the purge (CL-COL-21).

| Column | Type | Null | Default | Constraint or reference | Class | Spec |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | integer identity | no | — | primary key | — | CL-COL-21 |
| `press_source_id` | integer | no | — | → `press_sources.id` `ON DELETE RESTRICT`; the source whose read first stored the article | — | CL-COL-21 |
| `collected_on` | date | no | — | day of first collection, **owner's time zone** (parameter `display.timeZone`) at counting time | — | CL-COL-21 |
| `new_articles` | integer | no | 0 | `CHECK (new_articles >= 0)` | — | COL-11, CL-COL-21 |
| `prefilter_kept` | integer | no | 0 | `CHECK (prefilter_kept BETWEEN 0 AND new_articles)`; incremented by detection's prefilter through this module's API | — | COL-11, DET-06, CL-COL-21 |
| `exactly_dated` | integer | no | 0 | `CHECK (exactly_dated BETWEEN 0 AND new_articles)` | — | COL-11, CL-COL-21 |

- **Unique and indexes:** `press_source_daily_counts_uq` unique `(press_source_id, collected_on)` — the window sums of COL-11 and the upsert at collection.
- **Deletion:** deleted by the daily purge once `collected_on` is more than 90 days old, the largest allowed `collection.indicatorWindowDays` (CL-TRV-16).
- **TypeScript:** `collectedOn: IsoDate`.

### 1.4 Article — `articles`

A stored feed item reduced to the COL-25 minimum, dated cautiously (COL-19 to COL-23). Its processing status is derived by detection (CL-DET-01) and written through this module's API.

| Column | Type | Null | Default | Constraint or reference | Class | Spec |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | integer identity | no | — | primary key | — | COL-25 |
| `title` | text | no | — | `CHECK (btrim(title) <> '')`; as published, never changed by a later read | PR | COL-18, COL-23, COL-25 |
| `title_key` | text | no | — | title normalized for COL-30: NFKD, diacritics removed, lower case, punctuation removed, white space collapsed; technical column for the title index | PR | COL-30 |
| `outlet_name` | text | no | — | origin outlet of an aggregator item when the feed gives it, else the source's name at collection; never changed afterwards | PR | COL-06, COL-25 |
| `link` | text | no | — | cleaned link (COL-28); unique | PR | COL-25, COL-28, COL-30 |
| `retained_published_at` | timestamptz | no | — | retained publication instant, fixed at first collection; `CHECK (retained_published_at <= first_collected_at)` | PR | COL-19 to COL-23, CL-COL-02, CL-COL-03 |
| `retained_published_at_precision` | text | no | — | `CHECK (retained_published_at_precision IN ('exact','approximate','none'))` (`DatePrecision`) | — | COL-20, COL-22, CL-COL-03 |
| `first_collected_at` | timestamptz | no | — | | — | COL-22 |
| `language` | text | no | — | `CHECK (language IN ('en','fr'))`; the item's declared language, else the source's | — | COL-17, CL-COL-11 |
| `excerpt` | text | yes | null | feed-supplied text without formatting, truncated to `collection.excerptMaxLength`; `CHECK (char_length(excerpt) BETWEEN 1 AND 1000)`; null when the feed gave none or once erased | EX | COL-25, COL-27, COL-37, DSN-09 |
| `processing_status` | text | no | `'to_analyze'` | `CHECK (processing_status IN ('to_analyze','awaiting_classification','not_relevant','attached','linked_to_proposal'))` (`ArticleProcessingStatus`) | — | COL-35, CL-DET-01 |
| `not_relevant_reasons` | text[] | no | `'{}'` | every distinct non-relevance reason of the article's parts and facts (detection.md §2.3); `CHECK (not_relevant_reasons <@ ARRAY['no_followed_player','no_fact','below_threshold','below_coverage_threshold','old_fact','already_reported_by_backtest','type_rejected_or_withdrawn','proposal_rejected','detached_by_user'])`; `CHECK (processing_status <> 'not_relevant' OR cardinality(not_relevant_reasons) > 0)` | — | DET-54, CL-DET-01, CL-DET-12, CL-DET-27 |
| `retention_clock_started_at` | timestamptz | yes | null | start of the not-relevant retention (CL-COL-08): `first_collected_at` when the prefilter found no followed player, else the instant the article last became not relevant; `CHECK ((processing_status = 'not_relevant') = (retention_clock_started_at IS NOT NULL))` | — | COL-36, COL-38, CL-COL-08, CL-COL-14 |
| `first_press_source_id` | integer | no | — | → `press_sources.id` `ON DELETE RESTRICT`; the source whose read first stored it | — | CL-COL-21 |
| `first_task_run_id` | integer | yes | null | → core `task_runs.id` `ON DELETE SET NULL`; the collection run that stored it | — | COL-49, CL-COL-14 |
| `row_version` | integer | no | 1 | incremented whenever the article, its parts or its results change | — | CL-IHM-18 |

- **Unique and indexes:**
  - `articles_link_uq` unique `(link)` — the same-link test of COL-30 at every item;
  - `articles_title_dedup_idx` `(outlet_name, title_key, retained_published_at)` — the same outlet, same title and instants under `collection.titleDedupWindowHours` apart test of COL-30;
  - `articles_to_analyze_idx` `(first_collected_at) WHERE processing_status = 'to_analyze'` — the prefilter's input (DET-01);
  - `articles_not_relevant_idx` `(retention_clock_started_at) WHERE processing_status = 'not_relevant'` — the purge of COL-36 and the not-relevant list of IHM-71, oldest clock first;
  - `articles_reasons_gin` GIN `(not_relevant_reasons)` — the filter by reason of the not-relevant list (CL-DET-01);
  - `articles_excerpt_idx` `(first_collected_at) WHERE excerpt IS NOT NULL AND processing_status = 'attached'` — the excerpt erasure of COL-37;
  - `articles_source_collected_idx` `(first_press_source_id, first_collected_at)` — the attached share of COL-11 (CL-COL-21);
  - `articles_run_idx` `(first_task_run_id)` — the articles of a run (COL-49);
  - `articles_retained_idx` `(retained_published_at)` — the re-prefiltering of articles within the maximum age (DET-07).
- **Deletion cascades to:** `article_sightings`, and detection's `article_parts` (then `classification_results`, `classification_facts`). A row of `article_attachments` blocks the deletion (`ON DELETE RESTRICT`): an attached article is never deleted while attached (COL-37). Daily counts and exposure counts are numbers and stay (CL-COL-21, DET-57).
- **TypeScript:** `id: ArticleId`; `processingStatus: ArticleProcessingStatus`; `notRelevantReasons: readonly NotRelevantReason[]`; `retainedPublishedAtPrecision: DatePrecision`; `titleKey` is not exposed outside the module.

### 1.5 Article sighting — `article_sightings`

One source in which an article was seen, with the feed's item identifier when the item carries one (COL-31, CL-COL-01).

| Column | Type | Null | Default | Constraint or reference | Class | Spec |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | integer identity | no | — | primary key | — | COL-31 |
| `article_id` | integer | no | — | → `articles.id` `ON DELETE CASCADE` | — | COL-25, COL-31 |
| `press_source_id` | integer | no | — | → `press_sources.id` `ON DELETE RESTRICT` | — | COL-25, COL-31 |
| `feed_item_id` | text | yes | null | RSS `guid` or Atom `id` as given, trimmed; `CHECK (feed_item_id <> '')`; compared character for character | PR | COL-30, CL-COL-01 |
| `first_seen_at` | timestamptz | no | — | | — | COL-31 |

- **Unique and indexes:** `article_sightings_uq` unique `(article_id, press_source_id)` — one sighting per source; `article_sightings_item_uq` unique `(press_source_id, feed_item_id) WHERE feed_item_id IS NOT NULL` — the same-identifier test of COL-30.
- **Deletion:** cascades from its article; cascades to nothing.
- **TypeScript:** `feedItemId: string | null`.

### 1.6 Deduplication trace — `dedup_traces`

What remains of a purged article so that a feed still offering it does not bring it back (COL-34). Never created for an erased article (§1.11).

| Column | Type | Null | Default | Constraint or reference | Class | Spec |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | integer identity | no | — | primary key | — | COL-34 |
| `link_sha256` | bytea | no | — | SHA-256 of the cleaned link; unique; `CHECK (octet_length(link_sha256) = 32)` | PR | COL-34 |
| `first_collected_at` | timestamptz | no | — | | — | COL-34 |
| `article_deleted_at` | timestamptz | no | — | instant of the purge that deleted the article; the trace expires `collection.dedupTraceRetentionDays` later | — | COL-34 |

- **Unique and indexes:** `dedup_traces_link_uq` unique `(link_sha256)` — the trace test at every item; `dedup_traces_deleted_idx` `(article_deleted_at)` — the purge of expired traces.
- **Deletion:** by the purge only; cascades to nothing.
- **TypeScript:** `linkSha256: Uint8Array`; the expiry instant is derived.

### 1.7 Collection run (derived) — `CollectionRun`

A collection run is the core's task run of task `news-collection` (TRV-26). It has no table of its own: its journal entry (COL-48) is the task run plus its source reads (§1.8), its gaps (§1.9) and the incidents it opened or closed (§4). Its origin is the task run's trigger: `on_demand`, otherwise `scheduled`, including the run TRV-31 starts after a missed run (CL-COL-07).

- **TypeScript:** `interface CollectionRun { taskRunId: TaskRunId; origin: CollectionRunOrigin /* 'scheduled' | 'on_demand' */; withCatchUp: boolean; startedAt: EpochMs; finishedAt: EpochMs | null; reads: SourceRead[]; totals: CollectionCounters }`.

### 1.8 Source read — `collection_source_reads`

The per-source part of a collection journal entry: result, plain-language reason and counters (COL-48).

| Column | Type | Null | Default | Constraint or reference | Class | Spec |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | integer identity | no | — | primary key | — | COL-48 |
| `task_run_id` | integer | no | — | → core `task_runs.id` `ON DELETE CASCADE` | — | COL-48, TRV-26 |
| `press_source_id` | integer | no | — | → `press_sources.id` `ON DELETE RESTRICT` | — | COL-48 |
| `read_at` | timestamptz | no | — | instant of the source's last attempt in this run | — | COL-13, CL-COL-13 |
| `feed_url_read` | text | no | — | the stored address that was read | — | CL-COL-19 |
| `outcome` | text | no | — | `CHECK (outcome IN ('success','failure'))` (`SourceReadOutcome`) | — | COL-48 |
| `failure_reason` | text | yes | null | `CHECK (failure_reason IN ('unreachable','error_response','requires_identification','unreadable','not_a_feed'))` (`SourceReadFailureReason`); `CHECK ((outcome = 'failure') = (failure_reason IS NOT NULL))` | — | COL-41, COL-48 |
| `read_attempts` | smallint | no | — | `CHECK (read_attempts BETWEEN 1 AND 5)`; reads of this source in this run, the first included | — | COL-13, CL-COL-09 |
| `items_read` | integer | no | 0 | `CHECK (items_read >= 0)` | — | COL-48 |
| `new_articles` | integer | no | 0 | `CHECK (new_articles >= 0)` | — | COL-48 |
| `duplicates` | integer | no | 0 | `CHECK (duplicates >= 0)`; includes items matching a deduplication trace | — | COL-34, COL-48 |
| `too_old` | integer | no | 0 | `CHECK (too_old >= 0)` | — | COL-24, COL-48 |
| `incomplete` | integer | no | 0 | `CHECK (incomplete >= 0)` | — | COL-18, COL-48 |
| `unsupported_language` | integer | no | 0 | `CHECK (unsupported_language >= 0)` | — | COL-17, COL-48 |
| `date_anomalies` | integer | no | 0 | `CHECK (date_anomalies >= 0)` | — | COL-22, COL-48, CL-COL-03 |
| `catch_up_reference_at` | timestamptz | yes | null | the reference instant R from which items were admitted when COL-45 extended the admitted age; null without catch-up | — | COL-45, CL-COL-04, CL-COL-07 |
| `permanent_redirect_url` | text | yes | null | new address announced by a 301 or 308 answer and read for this run | — | CL-COL-19 |
| `uncollected_period_start_at` | timestamptz | yes | null | on the first run after a reactivation: the deactivation instant | — | COL-09, CL-COL-04 |
| `uncollected_period_end_at` | timestamptz | yes | null | the reactivation instant; `CHECK ((uncollected_period_start_at IS NULL) = (uncollected_period_end_at IS NULL))` | — | COL-09, CL-COL-04 |
| `interruption_started_at` | timestamptz | yes | null | on a read that ends a down or silent state: start of the interruption (first failed run of the streak; start of the silence count) | — | COL-43, CL-COL-06 |

- **Unique and indexes:** `collection_source_reads_uq` unique `(task_run_id, press_source_id)` — one read per source and run, and a resumed run never reads a source twice (COL-13, COL-15); `collection_source_reads_source_idx` `(press_source_id, read_at)` — the journal filtered by source and period (COL-49) and the "previous successful read" test of CL-COL-13.
- **Deletion:** by the purge after `journal.retentionDays` (COL-50), or with its task run; cascades to nothing.
- **TypeScript:** `type SourceRead = { outcome: 'success' } | { outcome: 'failure'; failureReason: SourceReadFailureReason }` merged with the counters as `CollectionCounters`.

### 1.9 Possible collection gap — `collection_gaps`

A period in which a source may have published items the app never saw; kept without limit because it shows where events may be missing (COL-46, H-01).

| Column | Type | Null | Default | Constraint or reference | Class | Spec |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | integer identity | no | — | primary key | — | COL-46 |
| `press_source_id` | integer | no | — | → `press_sources.id` `ON DELETE RESTRICT` | — | COL-46 |
| `gap_start_at` | timestamptz | no | — | the source's reference instant R (CL-COL-04) | — | COL-46, CL-COL-13 |
| `gap_end_at` | timestamptz | no | — | earliest instant of the oldest dated item offered, before the first-collection cap; `CHECK (gap_end_at > gap_start_at)` | — | COL-46, CL-COL-13 |
| `detected_at` | timestamptz | no | — | | — | COL-46 |
| `task_run_id` | integer | yes | null | → core `task_runs.id` `ON DELETE SET NULL`; the run that found it | — | COL-48 |

- **Unique and indexes:** `collection_gaps_source_idx` `(press_source_id, detected_at)` — the gaps of a source on the sources screen (IHM-36); the run's gaps use `collection_gaps_run_idx` `(task_run_id)`.
- **Deletion:** never deleted (COL-46, COL-50).
- **TypeScript:** `taskRunId: TaskRunId | null`.

### 1.10 Source incident link — `press_source_incidents`

Which source a source-level incident or warning concerns, so that it closes on that source's recovery, its message names the source and two occurrences of the same cause are recognized (COL-41 to COL-43, COL-46, CL-TEL-08).

| Column | Type | Null | Default | Constraint or reference | Class | Spec |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | integer identity | no | — | primary key | — | COL-41 |
| `incident_id` | integer | no | — | → core `incidents.id` `ON DELETE CASCADE`; unique | — | COL-41, COL-42, COL-46 |
| `press_source_id` | integer | no | — | → `press_sources.id` `ON DELETE RESTRICT` | — | COL-41, COL-42, COL-46 |

- **Unique and indexes:** `press_source_incidents_incident_uq` unique `(incident_id)`; `press_source_incidents_source_idx` `(press_source_id)` — the open incident of a source when its health changes.
- **Deletion:** cascades from the incident (the core purges closed incidents); cascades to nothing.
- **Incident kinds linked here:** `press_source_down`, `press_source_silent`, `feed_too_short`. `collection_impossible` concerns no source and has no link.

### 1.11 Withdrawal, other erasures, purge, export and backup

**Withdrawal of an event** (DSN-27, DSN-34, COL-37, `CL-COL-16`, `CL-DSN-10`, `CL-DSN-16`). Collection's eraser runs last among the Lot 2 erasers, after detection has removed the event's attachments and the facts that designate it (detection.md §1.9). In the withdrawal's transaction it then:

1. finds every article left with no role — no attachment to another event, no fact linked to a pending proposal, no pending part (CL-COL-16);
2. deletes each of them at once, with no deduplication trace and no other record: its sightings, parts, results and facts go by cascade, and the journal entries that name it (`lot2_object_kind = 'article'`) get `lot2_object_kind` and `lot2_object_id` set to null (`CL-TRV-10`).

An erased article that a feed still offers within the maximum age is collected again as new and classified again — at most about six times with the two default runs a day — and each time the withdrawal fingerprint keeps it from becoming an event (`CL-DSN-10`, `CL-COL-16`). What may remain: the source rows, the daily counts and the run counters (numbers only), the gaps, and every article that keeps another role, with its own sightings and results.

**Other erasures.**

- A fact that matches a live withdrawal fingerprint (CL-COL-16, CL-DET-21): the same two steps for its article.
- An event erased by a requalification or a split (CL-TAX-09): the same two steps.
- A merge of two detected events (DET-47): no article is erased; detection moves the absorbed event's attachments to the kept event, and `collection.eraseArticlesWithoutRole` then finds no article without a role (detection.md §1.9).
- A player-data deletion (CL-JOU-06): after detection deletes the player's parts, the same two steps for every article left with no part and no role.

**Daily purge** (task `purge`, COL-39, CL-COL-08, CL-COL-12). Each run, in order:

1. deletes the deduplication traces with `article_deleted_at + collection.dedupTraceRetentionDays <= now`;
2. deletes every article with `processing_status = 'not_relevant'` and `retention_clock_started_at + collection.notRelevantRetentionDays <= now`, and inserts one deduplication trace per deleted article (`link_sha256`, its `first_collected_at`, `article_deleted_at = now`), replacing a trace of the same link if one remains;
3. sets `excerpt` to null on every article with `processing_status = 'attached'` and `first_collected_at + collection.notRelevantRetentionDays <= now`, unless a fact of the article is linked to a pending type proposal or a part of it is pending (DSN-09, CL-COL-08);
4. deletes the source reads older than `journal.retentionDays`;
5. deletes the daily counts older than 90 days.

The run is recorded in the activity journal with three figures: articles deleted, excerpts erased, deduplication traces expired (CL-COL-12). Never purged: press sources, deactivation periods, gaps, and articles that are `to_analyze`, `awaiting_classification` or `linked_to_proposal` (COL-38) or attached (COL-37).

**Export and backup** (TRV-51, TRV-52, `CL-TRV-05`). Every table of this file is in each backup and in the full export, excerpts included while they exist. None feeds a spreadsheet export.

### 1.12 Lot 2 references to core rows

No Lot 1 operation is ever blocked by a Lot 2 row (`CL-TRV-24`). For every Lot 2 reference to a core row, the table gives the core paths that delete the target and the mechanism of `CL-TRV-24` that holds: (a) a Lot 2 step always runs before the target is deleted — for a reference to a detected or calendar-derived event, on every path that can delete it, since a deletion at import removes only historical events; (b) the reference follows the event instead of the case; (c) the reference is deleted or emptied with its target, losing nothing a requirement keeps. Core paths: E — the erasure step of an event (withdrawal, requalification or split erasure, player-data deletion), run by the event erasers, notifications, alerts, tracking, detection with collection; M — a merge of detected events (`notifications.moveEventReferences`, then `detection.correct` with `tracking.moveEventReferences` and `alerts.onAttachmentCorrected`); D — a derivation drop (`notifications.discardPendingFor`, `alerts.onCalendarEventDropped`, `tracking.eraseEventData`); R — a regrouping (`notifications.moveCaseReferences`, then `tracking.moveCaseReferences`); I — a manual deletion or a replacement at import of a historical event (IMP-29, IMP-33), which runs no Lot 2 step; P — a player-data deletion (each module's `erasePlayerData`); Pu — a core purge.

| Reference | Deleting paths and the Lot 2 step first | Mechanism |
| --- | --- | --- |
| `article_attachments.player_event_id` → `events` RESTRICT | E: detection's eraser; M: `detection.correct`; D, I: never met | (a) RESTRICT kept: attachments name detected events only (detection service) |
| `classification_facts.designated_event_id`, `matched_historical_event_id` → `events` SET NULL | E: detection's eraser deletes the facts; M: `detection.correct` repoints; I: set to null | (c) SET NULL: the fact keeps its outcome and holds no event text |
| `alert_sheet_events`, `alert_sheet_caveats`, `alert_sheet_updates`, `.player_event_id` → `events` RESTRICT | E: alerts' eraser; M: `alerts.onAttachmentCorrected`; D: `alerts.onCalendarEventDropped`; I: never met | (a) RESTRICT kept: sheets name detected and calendar events only (alert-sheets.md §3) |
| `tracked_case_decisions.player_event_id` → `events` SET NULL (was RESTRICT) | E: tracking's eraser; M: `tracking.moveEventReferences`; D: `tracking.eraseEventData`; I: set to null | (c) SET NULL: a decision about a historical event stays on its tracked case, still touched |
| `regrouping_exits.player_event_id` → `events` RESTRICT | E: tracking's eraser; M: `tracking.moveEventReferences`; D: `tracking.eraseEventData`; I: never met | (a) RESTRICT kept: an exit is tied to a detected or calendar event only |
| `notification_message_events.player_event_id` → `events` RESTRICT | E: notifications' eraser; M: `notifications.moveEventReferences`; D: `notifications.discardPendingFor`; I: never met | (a) RESTRICT kept: messages name detected and calendar events only |
| `tracked_cases.case_id` → `cases` CASCADE | R, M: `tracking.moveCaseReferences` / `moveEventReferences` record the exit and move the decisions first; E, D, I: cascade | (c) CASCADE, with the limit of `CL-SUI-16` for I |
| `alert_sheet_outcomes`, outcome entries of `alert_sheet_updates` (were `case_id` → `cases` RESTRICT) | none needed | (b) keyed by the sheet event (`alert_sheet_event_id`, `player_event_id`); the case is read live |
| `notification_message_facts.case_id` → `cases` CASCADE (was RESTRICT) | R, M: `notifications.moveCaseReferences` / `moveEventReferences` move or delete it first; E: notifications' eraser; D, I: cascade | (c) CASCADE: once the case is gone, one result per case has nothing to protect |
| `article_parts`, `alert_sheets`, `notification_messages`, `regrouping_exits`, `.player_id` → `followed_players` RESTRICT | P: detection's, alerts', notifications' and tracking's `erasePlayerData` | (a) RESTRICT kept |
| `exposure_counts.player_id` → `followed_players` CASCADE | P | (c) CASCADE: numbers only |
| `notification_message_facts.backtest_request_id` → `backtest_requests` RESTRICT | deleted only with the player — P: `notifications.erasePlayerData` | (a) RESTRICT kept |
| `collection_source_reads.task_run_id`, `detection_runs.task_run_id` → `task_runs` CASCADE; `articles.first_task_run_id`, `collection_gaps.task_run_id` SET NULL | Pu after `journal.retentionDays` | (c) |
| `press_source_incidents`, `classification_incident_details`, `notification_message_facts`, `.incident_id` → `incidents` CASCADE | Pu of closed incidents | (c) |
| references to `games`, `teams` and `event_types` (expected games, `alert_sheets.team_id_at_production`, `notification_messages.game_id`, `deadline_game_id`, every `event_type_id`) RESTRICT | none: the core never deletes these rows | no deleting path; RESTRICT kept |

## 2. Lifecycles

### 2.1 Activation status (`ActivationStatus`)

| From | To | Trigger | Guard | Side effects | Spec |
| --- | --- | --- | --- | --- | --- |
| — | `active` | owner adds the source after a trial read | feed readable without identification (COL-02); at least one item with a publication or update date (COL-04); `feed_url_key` not used by an active or deactivated source (COL-07); language `en` or `fr` (COL-05); attestation given (COL-03) | `health_status = 'never_read'`, `health_status_changed_at = now`; nothing of the trial read is stored (CL-COL-10) | COL-02 to COL-07, CL-COL-10, CL-COL-18 |
| `active` | `deactivated` | owner | — | opens a deactivation period; the source is no longer read; its articles keep their fate (CL-COL-15) | COL-09 |
| `deactivated` | `active` | owner | — | closes the period (`reactivated_at`); R becomes the reactivation instant, so the ordinary maximum age applies; the next read records the uncollected period | COL-09, CL-COL-04, CA-COL-22 |
| `active`, `deactivated` | `withdrawn` | owner | — | `withdrawn_at = now`; never read again; the address is free for a new source; an open deactivation period stays open; attached articles keep their outlet and link | COL-10, CL-COL-15, CA-COL-23 |

`withdrawn` is terminal (COL-10). An address change (COL-08) is an edit, not a transition: it needs a new trial read and clears `proposed_feed_url`.

### 2.2 Health status (`HealthStatus`)

After each source read the status is the first of these that applies (`CL-COL-06`); each change sets `health_status_changed_at`.

| From | To | Trigger | Guard | Side effects | Spec |
| --- | --- | --- | --- | --- | --- |
| any | `down` | a failed read in a counted run | `consecutive_failed_runs` reaches `collection.failedRunsBeforeDown`; a run in which every one of at least two active sources failed is not counted (CL-COL-05) | opens `press_source_down`, linked to the source | COL-41, CL-COL-05 |
| `never_read` | `working` | first successful read | rule 3 below does not apply | `first_successful_read_at = now` | CL-COL-06 |
| `down` | `working` | successful read | rule 3 does not apply | closes `press_source_down`; the read records `interruption_started_at = failure_streak_started_at`; the streak resets | COL-43, CL-COL-06 |
| `down` | `silent` | successful read | no new article within the silence period | closes `press_source_down`, opens `press_source_silent` | CL-COL-06 |
| `working` | `silent` | successful read | no new article since the latest of `last_new_article_at`, `first_successful_read_at` and the last reactivation, for the source's silence period | opens `press_source_silent` | COL-42, CL-COL-06 |
| `silent` | `working` | a read that stores a new article | — | closes `press_source_silent`; the read records the interruption start | COL-43 |

A failed read below the threshold changes no status. A run in which every active source failed (at least two) opens or keeps one `collection_impossible` incident, counts in no streak and changes no status; the first later run with one successful read closes it (CL-COL-05).

### 2.3 Article processing status

Collection creates every article with `processing_status = 'to_analyze'`. Every other transition is derived by detection from the article's parts (detection.md §2.3, CL-DET-01) and written through collection's API, which also maintains `not_relevant_reasons` and `retention_clock_started_at` in the same update.

### 2.4 Collection run

A collection run has no status of its own: the core's task-run `result` applies (`TaskRunResult`: `succeeded`, `failed`, `interrupted`, `source_late`; a run without a result is running). A run requested on demand during a pass is recorded once by the scheduler and starts when the pass ends (CL-COL-20).

## 3. Invariants

| Rule | Spec | Enforced by |
| --- | --- | --- |
| The retained publication instant never follows the first collection. | COL-22 | `CHECK` on `articles` |
| Title, outlet, link, retained instant, precision and language never change after the first collection. | COL-23 | collection service: no update path for these columns |
| One article per cleaned link. | COL-30 | unique `articles_link_uq` |
| One article per source and feed identifier. | COL-30, CL-COL-01 | unique `article_sightings_item_uq` |
| No two articles share outlet and title key with retained instants less than `collection.titleDedupWindowHours` apart. | COL-30 | collection service, in the transaction that stores the item |
| An item whose cleaned link matches a deduplication trace is not stored. | COL-34 | collection service, before any storage |
| An item without link or title, in another language, or older than the admitted age is not stored, only counted. | COL-17, COL-18, COL-24 | collection service |
| The excerpt is plain text of at most `collection.excerptMaxLength` characters. | COL-27 | collection service; `CHECK` at the bound of 1,000 |
| An article is not relevant exactly when its retention clock is set, and then has at least one reason. | COL-36, CL-DET-01 | `CHECK` on `articles` |
| An article that is to analyze, awaiting classification, linked to a proposal or attached is never deleted. | COL-37, COL-38 | purge selection; `ON DELETE RESTRICT` from `article_attachments` |
| An excerpt is not erased while a fact of the article is linked to a pending proposal or a part of it is pending. | DSN-09, CL-COL-08 | purge selection |
| No deduplication trace is left for an erased article. | DSN-34, CL-COL-16 | collection service: only the purge inserts traces |
| An address is used by at most one non-withdrawn source. | COL-07 | unique `press_sources_feed_url_key_uq` |
| A withdrawn source has its withdrawal instant and never changes status again. | COL-10 | `CHECK`; collection service |
| A source has at most one open deactivation period. | COL-09 | unique `press_source_deactivations_open_uq` |
| One read per source and run; a failure carries its reason. | COL-13, COL-15, COL-48 | unique and `CHECK` on `collection_source_reads` |
| Each health change is dated. | COL-40 | collection service sets `health_status_changed_at` in the same update |
| Gaps are never deleted. | COL-46, COL-50 | no purge step; `ON DELETE SET NULL` toward task runs |
| `first_press_source_id` is the source of the article's earliest sighting. | CL-COL-21 | collection service: article and first sighting inserted together |
| Daily counts never exceed the day's new articles. | CL-COL-21 | `CHECK` on `press_source_daily_counts` |

## 4. Stored or derived

| Item | Stored or derived | Recalculation |
| --- | --- | --- |
| Source's health, failure streak, last reads, last new article | stored | updated after each read of the source (§2.2) |
| Reference instant R of a source | derived: the later of `last_successful_read_at` and the last `reactivated_at` | — |
| Admitted age of a read | derived: run start minus R when it exceeds `collection.maxArticleAgeDays`, else `collection.maxArticleAgeDays` (CL-COL-04) | — |
| Collection run entry (origin, catch-up mark, totals, gaps, incidents) | derived from the task run, its reads, its gaps, and the incidents of kinds `press_source_down`, `press_source_silent`, `feed_too_short`, `collection_impossible` opened or closed between its start and end (runs never overlap, TRV-28) | — |
| "Add a collection time" warning | stored as a `feed_too_short` incident, opened when a gap is found and the previous successful read of the source was in the previous run, with no missed or failed run between (CL-COL-13); closed at the end of the first later successful read of that source that runs the gap test and records no gap, and opened again by a later such gap; adding a collection time does not close it (CL-COL-24) | — |
| Source indicators (COL-11) | derived: daily averages and shares from `press_source_daily_counts` over `collection.indicatorWindowDays`; attached share from `articles` first collected in the window that are now attached, divided by the window's new articles (CL-COL-21) | — |
| Article processing status, reasons, retention clock | stored cache of detection's derivation (CL-DET-01) | recomputed in the transaction of every change to the article's parts, results, attachments or proposal links |
| Scheduled deletion of a not-relevant article | derived: first purge run at or after `retention_clock_started_at + collection.notRelevantRetentionDays` | — |
| Expiry of a deduplication trace | derived: `article_deleted_at + collection.dedupTraceRetentionDays` | — |
| "Down since", "silent since" | derived: `health_status_changed_at` | — |
| Whether a run was one in which every source failed | derived from the run's reads (at least two active sources, all failed) | — |

## 5. Exchange formats

None is owned here. Feed items arrive through the `press-feeds` port, whose contract the module map defines; before storage an item is reduced to the columns of `articles` and `article_sightings` and nothing else of it is kept (COL-25, COL-26).

## 6. Rulings applied

- `CL-COL-01`: the feed's item identifier is kept per source on `article_sightings`, erased with the article, never in the deduplication trace.
- `CL-COL-02`, `CL-COL-03`: the retained instant and its precision are computed by these rules; date anomalies are counted on the read.
- `CL-COL-04`: R drives catch-up and gaps; the uncollected period is written on the first read after a reactivation.
- `CL-COL-05`: runs in which every active source failed count in no streak and open one `collection_impossible`.
- `CL-COL-06`: order of the health rules; hence `first_successful_read_at` and `failure_streak_started_at`.
- `CL-COL-07`: origin `scheduled` or `on_demand` (`CollectionRunOrigin`) plus a separate catch-up mark (`withCatchUp`, "With catch-up"), both derived from the task run and its reads.
- `CL-COL-08`: retention clocks of not-relevant articles and of attached excerpts.
- `CL-COL-09`: `read_attempts` (glossary `collection.readAttempts`) counts every read of the run, the first included.
- `CL-COL-12`: the purge is journaled in the activity journal with three figures.
- `CL-COL-13`: gap computation and the `feed_too_short` warning.
- `CL-COL-14`: the operational values kept on articles and sources.
- `CL-COL-15`: a withdrawn or deactivated source's articles keep their fate.
- `CL-COL-16`, `CL-DSN-10`: articles of a fingerprint match or a withdrawal are erased at once, with no trace and no other record; collecting and classifying them again while a feed still offers them is accepted.
- `CL-COL-17`, ADR 0019: two default collection times, thresholds counted in runs.
- `CL-COL-18`: `feed_url_key`.
- `CL-COL-19`: `proposed_feed_url` and `permanent_redirect_url`.
- `CL-COL-20`: the on-demand deferral is the scheduler's, not a collection table.
- `CL-COL-21`: daily counts per source; each article counts for its first source.
- `CL-COL-23`: the closed list of ad-tracking parameters removed from links, a constant of the shared link module, which `link` and `feed_url_key` rely on.
- `CL-COL-24`: the `feed_too_short` warning of a source closes at its first later read that records no gap.
- `CL-JOU-06`, `CL-TAX-09`: erasure scopes for player-data deletion and requalification.

Modeling choices of this file:

1. **The deduplication trace keeps a SHA-256 of the cleaned link, not the link.** It is only ever compared, never displayed; the digest serves COL-34 equally, stores less, and keeps the largest table (about 180,000 rows at 1,000 articles a day, H-TRV-04) small.
2. **No collection-run table.** The core's task run already holds start, end, trigger and result; source reads hang off it, so nothing is duplicated.
3. **Daily counts are kept 90 days**, the largest allowed indicator window (CL-TRV-16): they serve only COL-11.
4. **`proposed_feed_url` is overwritten at each run that meets a permanent redirect and cleared when the owner changes the address or when a run reads the stored address without one**, so the proposal shows only what the feed currently announces.
5. **`SourceReadFailureReason`** names the closed list of COL-41 (`unreachable`, `error_response`, `unreadable`, `not_a_feed`) plus `requires_identification`, which the `press-feeds` port reports and which never resolves on its own; these values are new to the glossary.
6. **`press_source_incidents`** keeps the source of a source incident on this side, so no core table references a Lot 2 table.
7. **`title_key` is stored** so that the COL-30 title test is one index lookup.
8. **An excerpt waits while a part of its article is pending**, since detection still needs it (DSN-09), even past its term.

## 7. Entity-relationship diagram

```mermaid
erDiagram
  press_sources ||--o{ press_source_deactivations : "deactivated during"
  press_sources ||--o{ press_source_daily_counts : "counted per day"
  press_sources ||--o{ article_sightings : "seen in"
  press_sources ||--o{ articles : "first stored by"
  articles ||--|{ article_sightings : "seen as"
  press_sources ||--o{ collection_source_reads : "read in"
  task_runs ||--o{ collection_source_reads : "run reads"
  task_runs ||--o{ articles : "stored during"
  press_sources ||--o{ collection_gaps : "may have missed"
  task_runs ||--o{ collection_gaps : "found by"
  incidents ||--o| press_source_incidents : "concerns"
  press_sources ||--o{ press_source_incidents : "has incidents"
  articles ||--o{ article_parts : "detection"
  dedup_traces {
    bytea link_sha256
  }
```

`task_runs` and `incidents` belong to the core model; `article_parts` is detection's. Deduplication traces are matched by link digest, not by key.

## 8. Requests to the core model

Requests 1, 2, 3 and 6 are met by the core model as of `da6c8fa`; they stay listed as what this file relies on.

1. **Task runs** (`task_runs`): one row per run of `news-collection`, with `id`, `task_key`, `trigger` (`scheduled`, `on_demand`; a catch-up run is `scheduled`, CL-TRV-08), `due_at`, `started_at`, `finished_at`, `result` (`TaskRunResult`: `succeeded`, `failed`, `interrupted`, `source_late`; null while running) and the uuid `pass_id`; rows kept at least `journal.retentionDays`, since `collection_source_reads` cascades from them and `articles.first_task_run_id` and `collection_gaps.task_run_id` are set to null when they go.
2. **Incidents** (`incidents`): kinds `press_source_down` and `collection_impossible` (level incident), `press_source_silent` and `feed_too_short` (level warning), with `opened_at` and `closed_at`; a source-level kind's `cause_key` is the press source's identifier, and `press_source_incidents` is the typed link this module joins on; `collection_impossible` closes at the end of the first later run in which one active source is read (CL-COL-05), `feed_too_short` at its source's first later read that records no gap (CL-COL-24).
3. **Withdrawal composition** (`CL-DSN-16`): run the Lot 2 erasers inside the withdrawal's transaction in the order notifications, alerts, tracking, detection, collection, all of them before the core erases the event's case, sources and row; each eraser deletes the outbox facts of the objects it erases (`outbox_facts.lot2_subject_id`) and sets the journal's `lot2_object_kind` and `lot2_object_id` to null where they name one; apply the same order to an erasure by requalification or split (CL-TAX-09) and to a player-data deletion (CL-JOU-06). Telegram's deletion requests run before the erasure's transaction and outside it, after a committed first step that stops sending (notifications.md §1.8).
4. **Purge task**: call this module's purge steps of §1.11 in the daily `purge` run and journal their three figures.
5. **Parameters**: none new for this file; the keys of the `collection` family (module map section 6) are used as named, with `collection.silencePeriodDays` overridable per source.
6. **On-demand collection requests** (`CL-COL-20`): the scheduler records at most one pending on-demand run of `news-collection` per pass (a requested run not started yet, `task_runs_one_requested_key`), started when the pass ends, and reports it to the screen as deferred.
7. **Journal references** (`CL-TRV-10`): `journal_entries.lot2_object_kind` value `press_source` and `article`; this file's erasers set the pair to null for every article they delete.
