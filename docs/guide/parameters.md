# Parameters

Every parameter of the application (TRV-79): what it sets, its default, its unit, the
values it accepts, the specification file and the requirement that define it, and the origin of
its default: a decision, a hypothesis of the decision journal, or a local hypothesis to be
confirmed. The owner changes them on the parameters screen; a Lot 2 parameter shows there once
Lot 2 runs.

This page is generated, so never edit it by hand: `bun run docs:parameters` writes it from the
parameter registry, and a test fails when it no longer matches.

## [01-joueurs-suivis.md](../01-joueurs-suivis.md)

### Maximum active players

How many followed players can be active at once; adding or reactivating one more is refused.

- Key: `players.maxActive`
- Default: 30 active players
- Unit: active players
- Allowed values: 1 to 100 active players, at least the indicative minimum
- Requirement: JOU-04
- Origin: Local hypothesis, to be confirmed (H-JOU-01)
- Lot: 1

### Indicative minimum of players

Below this number of active players, the to-do list suggests adding players.

- Key: `players.indicativeMin`
- Default: 20 active players
- Unit: active players
- Allowed values: 0 to 100 active players, at most the maximum; 0 means no reminder
- Requirement: JOU-04
- Origin: Local hypothesis, to be confirmed (H-JOU-01)
- Lot: 1

### Prolonged-absence threshold

After this many consecutive team games missed, a player's absence counts as prolonged.

- Key: `players.prolongedAbsenceGames`
- Default: 10 games
- Unit: consecutive team games missed
- Allowed values: 1 to 82 games
- Requirement: JOU-22
- Origin: Local hypothesis, to be confirmed (H-JOU-05)
- Lot: 1

### Exposure indicator period

The period over which a player's media exposure is counted.

- Key: `players.exposureWindowDays`
- Default: 30 days
- Unit: days
- Allowed values: 1 to 90 days
- Requirement: JOU-03
- Origin: Local hypothesis, to be confirmed (H-JOU-08)
- Lot: 2

## [02-taxonomie-des-evenements.md](../02-taxonomie-des-evenements.md)

### Criterion switched off

The doubtful-case criterion that one event type ignores; it is set on the type sheet.

- Key: `taxonomy.switchedOffCriterion`
- Default: None
- Unit: one doubtful-case criterion of a type
- Allowed values: at most one of SEN-12 to SEN-15, or SEN-06 while "Treat co-occurring cases as doubtful" is on
- Requirement: TAX-01
- Origin: Decision (ADR 0016)
- Lot: 1

## [03-collecte-des-actualites.md](../03-collecte-des-actualites.md)

### Collection times

The times of day, in your time zone, when the news is collected and read for events.

- Key: `collection.times`
- Default: 16:30 and 23:00
- Unit: local times
- Allowed values: 1 to 6 distinct times of day, at least 60 minutes apart
- Requirement: COL-12
- Origin: Decision (ADR 0019)
- Lot: 2

### Read attempts per run

How many times a run tries to read a source before that read counts as failed.

- Key: `collection.readAttempts`
- Default: 3 attempts
- Unit: attempts per run
- Allowed values: 1 to 5 attempts
- Requirement: COL-13
- Origin: Local hypothesis, to be confirmed (H-COL-04)
- Lot: 2

### Maximum article age

An article published longer ago than this is not collected.

- Key: `collection.maxArticleAgeDays`
- Default: 3 days
- Unit: days
- Allowed values: 1 to 14 days, at most the dedup trace retention
- Requirement: COL-24
- Origin: Local hypothesis, to be confirmed (H-COL-02)
- Lot: 2

### Title dedup window

Two articles with the same title within this window count as one.

- Key: `collection.titleDedupWindowHours`
- Default: 6 hours
- Unit: hours
- Allowed values: 1 to 72 hours
- Requirement: COL-30
- Origin: Local hypothesis, to be confirmed (H-COL-02)
- Lot: 2

### Excerpt length

The longest excerpt of an article that is kept.

- Key: `collection.excerptMaxLength`
- Default: 500 characters
- Unit: characters
- Allowed values: 100 to 1,000 characters
- Requirement: COL-27
- Origin: Local hypothesis, to be confirmed (H-COL-03)
- Lot: 2

### Not-relevant article retention

How long an article found not relevant is kept, and when the excerpts are erased.

- Key: `collection.notRelevantRetentionDays`
- Default: 30 days
- Unit: days (also the excerpt erasure term)
- Allowed values: 1 to 180 days
- Requirement: COL-36
- Origin: Local hypothesis, to be confirmed (H-COL-04)
- Lot: 2

### Dedup trace retention

How long the traces that recognize an article already seen are kept.

- Key: `collection.dedupTraceRetentionDays`
- Default: 180 days
- Unit: days
- Allowed values: 7 to 365 days, at least the maximum article age
- Requirement: COL-34
- Origin: Local hypothesis, to be confirmed (H-COL-04)
- Lot: 2

### Failed runs before "down"

After this many consecutive failed runs, a source shows as down.

- Key: `collection.failedRunsBeforeDown`
- Default: 2 runs
- Unit: consecutive failed runs
- Allowed values: 1 to 10 runs
- Requirement: COL-41
- Origin: Local hypothesis, to be confirmed (H-COL-04)
- Lot: 2

### Silence period (default for each source)

A source that publishes nothing for this long is reported as silent, unless it sets its own period.

- Key: `collection.silencePeriodDays`
- Default: 3 days
- Unit: days, overridable per source
- Allowed values: 1 to 30 days
- Requirement: COL-42
- Origin: Local hypothesis, to be confirmed (H-COL-04)
- Lot: 2

### Source indicator period

The rolling period over which each source's indicators are counted.

- Key: `collection.indicatorWindowDays`
- Default: 30 days
- Unit: days, rolling
- Allowed values: 1 to 90 days
- Requirement: COL-11
- Origin: Local hypothesis, to be confirmed (H-COL-04)
- Lot: 2

## [04-detection-des-evenements.md](../04-detection-des-evenements.md)

### Detection threshold

An article classified with less confidence than this creates no event; a change is not retroactive.

- Key: `detection.threshold`
- Default: 70 points
- Unit: points; never retroactive and not a calculation parameter (CL-TRV-17)
- Allowed values: 1 to 100 points
- Requirement: DET-24
- Origin: Local hypothesis, to be confirmed (H-DET-03)
- Lot: 2

### Confidence band width

The width of each band of detection confidence that the detection journal counts.

- Key: `detection.confidenceBandWidth`
- Default: 10 points
- Unit: points per band of detection confidence in the detection journal (0–9, 10–19 …)
- Allowed values: 1 to 50 points
- Requirement: DET-25
- Origin: Local hypothesis, to be confirmed (CL-DET-24)
- Lot: 2

### Classification attempts

How many times an article is sent for classification before it is set aside.

- Key: `detection.classificationAttempts`
- Default: 2 attempts
- Unit: attempts (the second one on the next provider, or the same one when it is alone)
- Allowed values: 1 to 5 attempts
- Requirement: DET-22
- Origin: Local hypothesis, to be confirmed (H-DET-03)
- Lot: 2

### Grouping window

Articles about the same event within this window before an article's retained instant are grouped.

- Key: `detection.groupingWindowHours`
- Default: 72 hours
- Unit: hours before the article's retained instant
- Allowed values: 1 to 240 hours
- Requirement: DET-29
- Origin: Local hypothesis, to be confirmed (H-DET-04)
- Lot: 2

### Queue priority horizon

Articles about a player whose game starts within this horizon are classified first.

- Key: `detection.priorityHorizonHours`
- Default: 48 hours
- Unit: hours before tip-off
- Allowed values: 1 to 240 hours
- Requirement: DET-09
- Origin: Local hypothesis, to be confirmed (H-DET-05)
- Lot: 2

### Queue resumption interval

How long the classification queue waits before it resumes, unless the quota that stopped it resets first.

- Key: `detection.queueResumeIntervalHours`
- Default: 6 hours
- Unit: hours; the queue resumes earlier when the quota that stopped the last run resets first
- Allowed values: 1 to 24 hours
- Requirement: DET-10
- Origin: Local hypothesis, to be confirmed (H-DET-05)
- Lot: 2

### Primary language model

The Workers AI model that classifies the articles.

- Key: `languageModel.primaryModel`
- Default: @cf/zai-org/glm-4.7-flash
- Unit: Workers AI model ID
- Allowed values: a model identifier, without spaces, of at most 200 characters
- Requirement: DET-08
- Origin: Local hypothesis, to be confirmed (detection-model sheet)
- Lot: 2

### Fallback language model

The Groq model that classifies when the primary one cannot, used only when a Groq key is set.

- Key: `languageModel.fallbackModel`
- Default: openai/gpt-oss-120b
- Unit: Groq model ID, used only when `GROQ_API_KEY` is set
- Allowed values: a model identifier, without spaces, of at most 200 characters
- Requirement: DET-08
- Origin: Local hypothesis, to be confirmed (detection-model sheet)
- Lot: 2

## [05-demande-de-backtest-et-prompt.md](../05-demande-de-backtest-et-prompt.md)

### Maximum sources per event

How many sources the research prompt asks for, and an import keeps, for each event.

- Key: `backtests.maxSourcesPerEvent`
- Default: 3 sources
- Unit: sources
- Allowed values: 1 to 10 sources
- Requirement: BKT-21
- Origin: Local hypothesis, to be confirmed (H-BKT-09)
- Lot: 1

## [06-import-des-resultats-de-recherche.md](../06-import-des-resultats-de-recherche.md)

### Maximum pasted size

The largest research result that can be pasted or chosen as a file.

- Key: `imports.maxPastedTextMegabytes`
- Default: 2 MB
- Unit: MB of the pasted text or the chosen file, UTF-8, 1 MB = 1,000,000 bytes (CL-IMP-27)
- Allowed values: 0.5 to 4 MB, step 0.5
- Requirement: IMP-02
- Origin: Local hypothesis, to be confirmed (H-IMP-02)
- Lot: 1

### Correspondence window

Two events of one player and one type whose public dates are this close may be the same event.

- Key: `imports.duplicateMaxDateGapDays`
- Default: 2 days
- Unit: days
- Allowed values: 0 to 7 days
- Requirement: IMP-25
- Origin: Local hypothesis, to be confirmed (H-IMP-02)
- Lot: 1

### Tolerated source lead

How many days before an event's public date one of its sources may be published.

- Key: `imports.maxSourceLeadDays`
- Default: 1 day
- Unit: days
- Allowed values: 0 to 7 days
- Requirement: IMP-14
- Origin: Local hypothesis, to be confirmed (H-IMP-02)
- Lot: 1

### Sources offered for the spot check

How many sources of an import are offered for you to open and check.

- Key: `imports.spotCheckSources`
- Default: 3 sources
- Unit: sources
- Allowed values: 1 to 20 sources
- Requirement: IMP-23
- Origin: Local hypothesis, to be confirmed (H-IMP-02)
- Lot: 1

### Link check

Whether the links of imported sources are checked for being reachable.

- Key: `imports.linkCheckEnabled`
- Default: on
- Unit: on / off
- Allowed values: on / off
- Requirement: IMP-17
- Origin: Local hypothesis, to be confirmed (H-IMP-08)
- Lot: 1

### Link-check timeout

How long the check waits for a link before it counts as unreachable.

- Key: `imports.linkCheckTimeoutSeconds`
- Default: 10 seconds
- Unit: seconds per link fetch (one request at a time, up to 5 redirects)
- Allowed values: 1 to 60 seconds
- Requirement: IMP-17
- Origin: Local hypothesis, to be confirmed (CL-IMP-25)
- Lot: 1

### Disallowed source domains

Sources on these domains are not kept: social networks, forums, collaborative encyclopedias and video platforms.

- Key: `imports.disallowedSourceDomains`
- Default: 28 domains
- Unit: domains
- Allowed values: 0 to 500 domain names, lowercase, without scheme or path
- Requirement: IMP-14
- Origin: Local hypothesis, to be confirmed (H-IMP-13)
- Lot: 1

## [07-statistiques-de-match.md](../07-statistiques-de-match.md)

### Playing-time floor

A game in which the player played fewer minutes than this is not usable.

- Key: `games.minutesFloor`
- Default: 15 minutes
- Unit: minutes
- Allowed values: 0 to 48 minutes
- Requirement: STA-14
- Origin: Local hypothesis, to be confirmed (H-STA-03)
- Lot: 1

### Share of average minutes

A game is not usable either when the player's minutes fall below this share of his season average.

- Key: `games.minutesAverageShare`
- Default: 50%
- Unit: % of the season's average minutes per regular-season game played
- Allowed values: 0 to 100%
- Requirement: STA-14
- Origin: Local hypothesis, to be confirmed (H-STA-03)
- Lot: 1

### Minimum baseline size

A baseline with fewer usable games than this gives no measure.

- Key: `games.minBaselineGames`
- Default: 10 games
- Unit: usable games, measured game excluded
- Allowed values: 2 to 82 games
- Requirement: STA-19
- Origin: Local hypothesis, to be confirmed (H-STA-07)
- Lot: 1

### Baseline for play-in and playoff games

Which games a play-in or playoff game is compared with.

- Key: `games.postseasonBaseline`
- Default: postseason
- Unit: choice
- Allowed values: postseason / regular season
- Requirement: STA-18
- Origin: Local hypothesis, to be confirmed (H-STA-06)
- Lot: 1

### Partial baseline threshold

A baseline is marked partial when more than this share of its played games has no index.

- Key: `games.partialBaselineShare`
- Default: 20%
- Unit: % of played games without an index
- Allowed values: 0 to 100%
- Requirement: STA-24
- Origin: Local hypothesis, to be confirmed (H-STA-10)
- Lot: 1

### Delay after the last tip-off

The daily statistics update waits this long after the day's last tip-off.

- Key: `games.dailyUpdateDelayHours`
- Default: 3 hours
- Unit: hours after the last scheduled tip-off of the past competition day
- Allowed values: 1 to 12 hours
- Requirement: STA-32
- Origin: Local hypothesis, to be confirmed (H-STA-12)
- Lot: 1

### Correction window

For this long after a game, corrections of its statistics are taken in.

- Key: `games.correctionWindowDays`
- Default: 7 days
- Unit: days after the game
- Allowed values: 1 to 30 days, at most the delay before a box score is unavailable
- Requirement: STA-33
- Origin: Local hypothesis, to be confirmed (H-STA-13)
- Lot: 1

### Delay before a box score is unavailable

A box score still missing this long after its game is marked unavailable.

- Key: `games.boxScoreUnavailableAfterDays`
- Default: 30 days
- Unit: days after the game, excluding the days when the stats source's incidents or quota were open (CL-STA-11)
- Allowed values: 1 to 365 days, at least the correction window
- Requirement: STA-35
- Origin: Local hypothesis, to be confirmed (H-STA-13)
- Lot: 1

### Retry delays — first retry

How long after a failed fetch of statistics the first retry comes.

- Key: `games.retryFirstDelayHours`
- Default: 1 hour
- Unit: hours
- Allowed values: 0.25 to 24 hours, step 0.25
- Requirement: STA-36
- Origin: Local hypothesis, to be confirmed (H-STA-14)
- Lot: 1

### Retry delays — interval

The interval between the later retries of a failed fetch of statistics.

- Key: `games.retryIntervalHours`
- Default: 4 hours
- Unit: hours
- Allowed values: 1 to 24 hours, step 0.25
- Requirement: STA-36
- Origin: Local hypothesis, to be confirmed (H-STA-14)
- Lot: 1

### Delay before an incident

After this long of continuous failure to fetch statistics, an incident opens.

- Key: `games.incidentAfterHours`
- Default: 12 hours
- Unit: hours of continuous failure
- Allowed values: 1 to 72 hours
- Requirement: STA-37
- Origin: Local hypothesis, to be confirmed (H-STA-14)
- Lot: 1

### Quota reserve

The share of each of the stats source's limits kept for the most urgent fetches.

- Key: `games.quotaReserveShare`
- Default: 10%
- Unit: % of each limit kept for STA-40 levels 1 and 2
- Allowed values: 0 to 50%
- Requirement: STA-39
- Origin: Local hypothesis, to be confirmed (H-STA-15)
- Lot: 1

## [08-sensibilite-et-verdict.md](../08-sensibilite-et-verdict.md)

### Attachment window

A game played more than this long after an event is not attached to it.

- Key: `sensitivity.maxAttachmentDays`
- Default: 10 days
- Unit: days after the reference instant
- Allowed values: 1 to 60 days
- Requirement: SEN-04
- Origin: Local hypothesis, to be confirmed (H-SEN-03)
- Lot: 1

### Treat co-occurring cases as doubtful

Whether two cases measured on the same game are both set aside as doubtful.

- Key: `sensitivity.coOccurringCasesDoubtful`
- Default: off
- Unit: on / off
- Allowed values: on / off
- Requirement: SEN-06
- Origin: Local hypothesis, to be confirmed (H-SEN-04)
- Lot: 1

### Absence length (return from injury)

After this many consecutive team games missed, the next games count as a return from injury.

- Key: `sensitivity.injuryReturnMinGamesMissed`
- Default: 4 games
- Unit: consecutive team games missed
- Allowed values: 1 to 82 games
- Requirement: SEN-13
- Origin: Local hypothesis, to be confirmed (H-SEN-05)
- Lot: 1

### Games after an absence (return from injury)

How many games after such an absence count as a return from injury.

- Key: `sensitivity.injuryReturnFirstGames`
- Default: 2 games
- Unit: games played after the absence
- Allowed values: 1 to 10 games
- Requirement: SEN-13
- Origin: Local hypothesis, to be confirmed (H-SEN-05)
- Lot: 1

### Treat every playoff game as unusual stakes

Whether every playoff game counts as a game of unusual stakes.

- Key: `sensitivity.allPlayoffGamesUnusualStakes`
- Default: off
- Unit: on / off
- Allowed values: on / off
- Requirement: SEN-14
- Origin: Local hypothesis, to be confirmed (H-SEN-06)
- Lot: 1

### Opponent strength bounds — low

An opponent that won less than this share of its games counts as weak.

- Key: `sensitivity.opponentWinShareLow`
- Default: 25%
- Unit: %, strictly below
- Allowed values: 0 to 49%
- Requirement: SEN-15
- Origin: Local hypothesis, to be confirmed (H-SEN-07)
- Lot: 1

### Opponent strength bounds — high

An opponent that won more than this share of its games counts as strong.

- Key: `sensitivity.opponentWinShareHigh`
- Default: 75%
- Unit: %, strictly above
- Allowed values: 51 to 100%
- Requirement: SEN-15
- Origin: Local hypothesis, to be confirmed (H-SEN-07)
- Lot: 1

### Opponent minimum games

An opponent's strength is judged only once it has played this many games.

- Key: `sensitivity.opponentMinGames`
- Default: 10 games
- Unit: games, measured game excluded
- Allowed values: 1 to 82 games
- Requirement: SEN-15
- Origin: Local hypothesis, to be confirmed (H-SEN-07)
- Lot: 1

### Valid cases for a player verdict

A player gets a verdict for a type only from this many valid cases.

- Key: `sensitivity.minValidCases`
- Default: 5 valid cases
- Unit: valid cases
- Allowed values: 2 to 100 valid cases
- Requirement: SEN-23
- Origin: Decision (ADR 0021)
- Lot: 1

### Verdict thresholds — signal-to-noise for "possible"

The signal-to-noise ratio from which a verdict can be "possible".

- Key: `sensitivity.possibleSignalToNoise`
- Default: 2 times the expected noise
- Unit: multiples of the expected noise
- Allowed values: 0.5 to 10 times the expected noise, step 0.1; at most the "probable" value
- Requirement: SEN-23
- Origin: Decision (ADR 0021)
- Lot: 1

### Verdict thresholds — mean gap for "possible"

The mean normalized gap from which a verdict can be "possible".

- Key: `sensitivity.possibleMeanGap`
- Default: 0.25
- Unit: normalized gap
- Allowed values: 0 to 5, step 0.01; at most the "probable" value
- Requirement: SEN-23
- Origin: Decision (ADR 0021)
- Lot: 1

### Verdict thresholds — signal-to-noise for "probable"

The signal-to-noise ratio from which a verdict can be "probable".

- Key: `sensitivity.probableSignalToNoise`
- Default: 3 times the expected noise
- Unit: multiples of the expected noise
- Allowed values: 0.5 to 10 times the expected noise, step 0.1; at least the "possible" value
- Requirement: SEN-23
- Origin: Decision (ADR 0021)
- Lot: 1

### Verdict thresholds — mean gap for "probable"

The mean normalized gap from which a verdict can be "probable".

- Key: `sensitivity.probableMeanGap`
- Default: 0.4
- Unit: normalized gap
- Allowed values: 0 to 5, step 0.01; at least the "possible" value
- Requirement: SEN-23
- Origin: Decision (ADR 0021)
- Lot: 1

### Profile confidence thresholds — medium from

From this many valid cases, a profile confidence can be medium.

- Key: `sensitivity.confidenceMediumFromCases`
- Default: 8 valid cases
- Unit: valid cases
- Allowed values: 1 to 200 valid cases, below high
- Requirement: SEN-25
- Origin: Local hypothesis, to be confirmed (H-SEN-11)
- Lot: 1

### Profile confidence thresholds — high from

From this many valid cases, a profile confidence can be high.

- Key: `sensitivity.confidenceHighFromCases`
- Default: 15 valid cases
- Unit: valid cases
- Allowed values: 2 to 500 valid cases, above medium
- Requirement: SEN-25
- Origin: Local hypothesis, to be confirmed (H-SEN-11)
- Lot: 1

### Profile confidence thresholds — dispersion drop

Above this observed dispersion, the profile confidence drops one level.

- Key: `sensitivity.confidenceDispersionDrop`
- Default: 1.5
- Unit: observed dispersion
- Allowed values: 0.1 to 10, step 0.1
- Requirement: SEN-25
- Origin: Local hypothesis, to be confirmed (H-SEN-11)
- Lot: 1

### Profile confidence thresholds — doubtful-share drop

Above this share of doubtful cases, the profile confidence drops one level.

- Key: `sensitivity.confidenceDoubtfulShareDrop`
- Default: 30%
- Unit: % excluded ÷ (valid + excluded)
- Allowed values: 0 to 100%
- Requirement: SEN-25
- Origin: Local hypothesis, to be confirmed (H-SEN-11)
- Lot: 1

### Minimum players for a trend

A general trend needs valid cases from at least this many players.

- Key: `sensitivity.trendMinPlayers`
- Default: 3 players
- Unit: distinct players
- Allowed values: 1 to 30 players
- Requirement: SEN-29
- Origin: Local hypothesis, to be confirmed (H-SEN-13)
- Lot: 1

### Maximum share of one player in a trend

A general trend whose valid cases come above this share from one player is not shown as one.

- Key: `sensitivity.trendMaxTopShare`
- Default: 50%
- Unit: % of the valid cases from one player
- Allowed values: 1 to 100%
- Requirement: SEN-29
- Origin: Local hypothesis, to be confirmed (H-SEN-13)
- Lot: 1

### Counts instead of percentages below

Below this many cases, shares are shown as counts rather than percentages.

- Key: `sensitivity.countsBelowCases`
- Default: 20 cases
- Unit: cases
- Allowed values: 1 to 200 cases
- Requirement: SEN-39
- Origin: Local hypothesis, to be confirmed (H-SEN-14)
- Lot: 1

## [09-fiche-d-alerte.md](../09-fiche-d-alerte.md)

### Vigilance margin

An alert whose detection confidence is less than this above the threshold is marked for vigilance.

- Key: `alerts.confidenceVigilanceMargin`
- Default: 10 points
- Unit: points above the detection threshold
- Allowed values: 0 to 100 points
- Requirement: ALE-16
- Origin: Local hypothesis, to be confirmed (H-ALE-06)
- Lot: 2

## [10-suivi-automatique-et-validation.md](../10-suivi-automatique-et-validation.md)

### Category threshold

A tracked case is confirmed when its gap in forecast direction reaches this, belied when it reaches the opposite.

- Key: `tracking.categoryThreshold`
- Default: 0.25
- Unit: normalized gap in forecast direction
- Allowed values: 0 to 5, step 0.01
- Requirement: SUI-22
- Origin: Local hypothesis, to be confirmed (H-SUI-05)
- Lot: 2

### Minimum tracked cases for an assessment

The validation table gives an assessment only from this many tracked cases with a frozen forecast.

- Key: `tracking.minTrackedCasesForAssessment`
- Default: 10 tracked cases
- Unit: tracked cases with a frozen forecast
- Allowed values: 1 to 200 tracked cases
- Requirement: SUI-26
- Origin: Local hypothesis, to be confirmed (H-SUI-06)
- Lot: 2

## [11-notifications-telegram.md](../11-notifications-telegram.md)

### Send notifications (master switch)

Whether any Telegram message is sent at all.

- Key: `notifications.enabled`
- Default: on
- Unit: on / off
- Allowed values: on / off
- Requirement: TEL-25
- Origin: Local hypothesis, to be confirmed (TEL-25)
- Lot: 2

### Quiet hours

Messages that are not urgent wait until the end of this range of the day.

- Key: `notifications.quietHours`
- Default: 23:00 to 08:00
- Unit: local time range
- Allowed values: any start and end; equal means none; may span midnight
- Requirement: TEL-20
- Origin: Local hypothesis, to be confirmed (H-TEL-03)
- Lot: 2

### Urgent exception

Whether urgent messages are sent during the quiet hours.

- Key: `notifications.urgentException`
- Default: on
- Unit: on / off
- Allowed values: on / off
- Requirement: TEL-21
- Origin: Local hypothesis, to be confirmed (H-TEL-03)
- Lot: 2

### Notification categories — Backtest requests

Whether you are notified of backtest requests.

- Key: `notifications.category.backtestRequests`
- Default: on
- Unit: on / off
- Allowed values: on / off
- Requirement: TEL-24
- Origin: Local hypothesis, to be confirmed (H-TEL-03)
- Lot: 2

### Notification categories — Alerts

Whether you are notified of alerts.

- Key: `notifications.category.alerts`
- Default: on
- Unit: on / off
- Allowed values: on / off
- Requirement: TEL-24
- Origin: Local hypothesis, to be confirmed (H-TEL-03)
- Lot: 2

### Notification categories — Tracked results

Whether you are notified of tracked results.

- Key: `notifications.category.trackedResults`
- Default: on
- Unit: on / off
- Allowed values: on / off
- Requirement: TEL-24
- Origin: Local hypothesis, to be confirmed (H-TEL-03)
- Lot: 2

### Notification categories — Type proposals

Whether you are notified of type proposals.

- Key: `notifications.category.typeProposals`
- Default: on
- Unit: on / off
- Allowed values: on / off
- Requirement: TEL-24
- Origin: Local hypothesis, to be confirmed (H-TEL-03)
- Lot: 2

### Notification categories — Incidents

Whether you are notified of incidents.

- Key: `notifications.category.incidents`
- Default: on
- Unit: on / off
- Allowed values: on / off
- Requirement: TEL-24
- Origin: Local hypothesis, to be confirmed (H-TEL-03)
- Lot: 2

### Sub-options — inconclusive alerts

Whether alerts whose profile is inconclusive are notified too.

- Key: `notifications.inconclusiveAlerts`
- Default: on
- Unit: on / off
- Allowed values: on / off
- Requirement: TEL-24
- Origin: Local hypothesis, to be confirmed (TEL-24)
- Lot: 2

### Sub-options — end of an incident

Whether the end of an incident is notified.

- Key: `notifications.incidentEnd`
- Default: on
- Unit: on / off
- Allowed values: on / off
- Requirement: TEL-24
- Origin: Local hypothesis, to be confirmed (TEL-24)
- Lot: 2

### Sub-options — reminder before the deadline

Whether a reminder is sent before the deadline of an alert.

- Key: `notifications.reminderEnabled`
- Default: on
- Unit: on / off
- Allowed values: on / off
- Requirement: TEL-24
- Origin: Local hypothesis, to be confirmed (TEL-24)
- Lot: 2

### Reminder before the deadline

How long before tip-off the deadline reminder is sent.

- Key: `notifications.reminderLeadHours`
- Default: 6 hours
- Unit: hours before tip-off
- Allowed values: 1 to 48 hours
- Requirement: TEL-10
- Origin: Local hypothesis, to be confirmed (H-TEL-03)
- Lot: 2

### Alert grouping threshold

From this many alerts in one pass, they are sent as one grouped message.

- Key: `notifications.alertGroupingThreshold`
- Default: 3 alerts
- Unit: alerts per pass
- Allowed values: 1 to 20 alerts
- Requirement: TEL-19
- Origin: Local hypothesis, to be confirmed (H-TEL-03)
- Lot: 2

### Facts detailed per digest

How many facts a grouped message details before it counts the rest.

- Key: `notifications.maxDetailedFacts`
- Default: 10 facts
- Unit: facts per digest
- Allowed values: 1 to 50 facts
- Requirement: TEL-19
- Origin: Local hypothesis, to be confirmed (H-TEL-03)
- Lot: 2

### Daily cap

The most messages sent in one day of your time zone.

- Key: `notifications.dailyCap`
- Default: 20 messages
- Unit: messages per day of the owner's zone
- Allowed values: 1 to 200 messages
- Requirement: TEL-22
- Origin: Local hypothesis, to be confirmed (H-TEL-03)
- Lot: 2

### Retry intervals

The waits before each new attempt to send a message that failed.

- Key: `notifications.retryIntervalsMinutes`
- Default: 1, 5, 15, 30 and 60 minutes
- Unit: minutes, minimums (the first tick after each is when it happens)
- Allowed values: 1 to 10 values, strictly increasing, each 1 to 1,440 minutes
- Requirement: TEL-35
- Origin: Local hypothesis, to be confirmed (H-TEL-03)
- Lot: 2

### Catch-up interval

The wait between two attempts to send the messages held while Telegram was unreachable.

- Key: `notifications.catchUpIntervalMinutes`
- Default: 60 minutes
- Unit: minutes between two catch-up attempts while messages wait (TEL-36)
- Allowed values: 15 to 1,440 minutes
- Requirement: TEL-36
- Origin: Local hypothesis, to be confirmed (CL-TEL-12)
- Lot: 2

### Incident reminder frequency

How often an incident still open is recalled.

- Key: `notifications.incidentReminderDays`
- Default: 3 days
- Unit: days
- Allowed values: 1 to 30 days
- Requirement: TEL-15
- Origin: Local hypothesis, to be confirmed (H-TEL-03)
- Lot: 2

### Incident recurrence window

An incident that comes back within this window after its end is not notified again.

- Key: `notifications.incidentRecurrenceGraceHours`
- Default: 6 hours
- Unit: hours
- Allowed values: 0 to 48 hours
- Requirement: TEL-15
- Origin: Local hypothesis, to be confirmed (H-TEL-03)
- Lot: 2

### Link code validity

How long a code to link the Telegram conversation stays valid.

- Key: `notifications.linkCodeValidityMinutes`
- Default: 15 minutes
- Unit: minutes
- Allowed values: 5 to 60 minutes
- Requirement: TEL-29
- Origin: Local hypothesis, to be confirmed (H-TEL-03)
- Lot: 2

## [12-interface-et-acces.md](../12-interface-et-acces.md)

### Time zone

The zone in which instants are shown and the scheduled tasks run.

- Key: `display.timeZone`
- Default: Paris time
- Unit: IANA time zone
- Allowed values: any zone of the IANA time-zone database
- Requirement: IHM-14
- Origin: Decision (ADR 0010)
- Lot: 1

### List page size

How many items a long list shows at a time.

- Key: `display.listPageSize`
- Default: 50 items
- Unit: items
- Allowed values: 10 to 200 items
- Requirement: IHM-18
- Origin: Local hypothesis, to be confirmed (H-IHM-03)
- Lot: 1

### "Deadline soon" delay

An item of the to-do list due within this delay is marked "deadline soon".

- Key: `display.deadlineSoonHours`
- Default: 24 hours
- Unit: hours
- Allowed values: 1 to 168 hours
- Requirement: IHM-20
- Origin: Local hypothesis, to be confirmed (H-IHM-03)
- Lot: 1

### Draft retention

A draft left unchanged for this long is erased.

- Key: `display.draftRetentionDays`
- Default: 7 days
- Unit: days after the draft's last change (CL-IHM-11)
- Allowed values: 1 to 30 days
- Requirement: IHM-42
- Origin: Local hypothesis, to be confirmed (H-IHM-03)
- Lot: 1

### Research tool address

The address of the research tool that the backtest screens open, if you set one.

- Key: `display.researchToolUrl`
- Default: none
- Unit: address, optional
- Allowed values: empty, or an https address of at most 2,000 characters
- Requirement: IHM-44
- Origin: Local hypothesis, to be confirmed (H-IHM-04)
- Lot: 1

## [13-donnees-sensibles.md](../13-donnees-sensibles.md)

### Maximum description length

The longest description of an event, which also caps the app's other free texts.

- Key: `events.maxDescriptionLength`
- Default: 200 characters
- Unit: characters, counted in code points after trimming; also caps the other free texts (CL-IMP-26, CL-DET-18, CL-TAX-11)
- Allowed values: 80 to 500 characters
- Requirement: DSN-20
- Origin: Local hypothesis, to be confirmed (H-DSN-01)
- Lot: 1

## [14-exigences-transverses.md](../14-exigences-transverses.md)

### Quota limits per service — the stats source, requests a day

The requests a day that the stats source allows; the app keeps its use within it.

- Key: `quotas.statsSource.requestsPerDay`
- Default: not set
- Unit: file requests answered 200 or 304, the redirect not counted, per UTC day, reset at 00:00 UTC
- Allowed values: empty until entered, then an integer of at least 1; an unset limit fails the installation check
- Requirement: TRV-03
- Origin: Local hypothesis, to be confirmed (statistics-source sheet)
- Lot: 1

### Quota limits per service — the stats source, megabytes a day

The megabytes a day that the stats source allows; the app keeps its use within it.

- Key: `quotas.statsSource.megabytesPerDay`
- Default: not set
- Unit: MB downloaded, per UTC day, reset at 00:00 UTC
- Allowed values: empty until entered, then an integer of at least 1; an unset limit fails the installation check
- Requirement: TRV-03
- Origin: Local hypothesis, to be confirmed (statistics-source sheet)
- Lot: 1

### Quota limits per service — Workers AI, neurons a day

The neurons a day that Workers AI allows; the app keeps its use within it.

- Key: `quotas.workersAi.neuronsPerDay`
- Default: not set
- Unit: neurons, reset at 00:00 UTC
- Allowed values: empty until entered, then an integer of at least 1; an unset limit fails the installation check
- Requirement: TRV-03
- Origin: Local hypothesis, to be confirmed (detection-model sheet)
- Lot: 2

### Quota limits per service — Workers AI, requests a minute

The requests a minute that Workers AI allows; the app keeps its use within it.

- Key: `quotas.workersAi.requestsPerMinute`
- Default: not set
- Unit: requests, per minute (a rate)
- Allowed values: empty until entered, then an integer of at least 1; an unset limit fails the installation check
- Requirement: TRV-03
- Origin: Local hypothesis, to be confirmed (detection-model sheet)
- Lot: 2

### Quota limits per service — Groq, requests a minute

The requests a minute that Groq allows; the app keeps its use within it.

- Key: `quotas.groq.requestsPerMinute`
- Default: not set
- Unit: requests, over a rolling minute
- Allowed values: empty until entered, then an integer of at least 1; an unset limit fails the installation check
- Requirement: TRV-03
- Origin: Local hypothesis, to be confirmed (detection-model sheet)
- Lot: 2

### Quota limits per service — Groq, requests a day

The requests a day that Groq allows; the app keeps its use within it.

- Key: `quotas.groq.requestsPerDay`
- Default: not set
- Unit: requests a day, reset at the instant Groq's x-ratelimit-reset-requests header reports
- Allowed values: empty until entered, then an integer of at least 1; an unset limit fails the installation check
- Requirement: TRV-03
- Origin: Local hypothesis, to be confirmed (detection-model sheet)
- Lot: 2

### Quota limits per service — Groq, tokens a minute

The tokens a minute that Groq allows; the app keeps its use within it.

- Key: `quotas.groq.tokensPerMinute`
- Default: not set
- Unit: tokens (cached tokens not counted), reset at the instant Groq's x-ratelimit-reset-tokens header reports
- Allowed values: empty until entered, then an integer of at least 1; an unset limit fails the installation check
- Requirement: TRV-03
- Origin: Local hypothesis, to be confirmed (detection-model sheet)
- Lot: 2

### Quota limits per service — Groq, tokens a day

The tokens a day that Groq allows; the app keeps its use within it.

- Key: `quotas.groq.tokensPerDay`
- Default: not set
- Unit: tokens (cached tokens not counted), over a rolling 24 hours
- Allowed values: empty until entered, then an integer of at least 1; an unset limit fails the installation check
- Requirement: TRV-03
- Origin: Local hypothesis, to be confirmed (detection-model sheet)
- Lot: 2

### Quota limits per service — the database, capacity in megabytes

The capacity in megabytes that the database allows; the app keeps its use within it.

- Key: `quotas.database.capacityMegabytes`
- Default: not set
- Unit: MB (a capacity, no period)
- Allowed values: empty until entered, then an integer of at least 1; an unset limit fails the installation check
- Requirement: TRV-03
- Origin: Local hypothesis, to be confirmed (database sheet)
- Lot: 1

### Quota limits per service — the database, compute-hours a month

The compute-hours a month that the database allows; the app keeps its use within it.

- Key: `quotas.database.computeHoursPerMonth`
- Default: not set
- Unit: compute-hours (the app's estimate at 0.25 CU; Neon's console is the authority), per calendar month from 00:00 UTC on the 1st
- Allowed values: empty until entered, then an integer of at least 1; an unset limit fails the installation check
- Requirement: TRV-03
- Origin: Local hypothesis, to be confirmed (database sheet)
- Lot: 1

### Quota limits per service — the database, transfer megabytes a month

The transfer megabytes a month that the database allows; the status screen shows it as a reference, which the app does not enforce.

- Key: `quotas.database.transferMegabytesPerMonth`
- Default: not set
- Unit: MB of egress (reference: not measured), per calendar month from 00:00 UTC on the 1st
- Allowed values: empty until entered, then an integer of at least 1; an unset limit fails the installation check
- Requirement: TRV-03
- Origin: Local hypothesis, to be confirmed (database sheet)
- Lot: 1

### Quota limits per service — the host, invocations a month

The invocations a month that the host allows; the status screen shows it as a reference, which the app does not enforce.

- Key: `quotas.hosting.invocationsPerMonth`
- Default: not set
- Unit: invocations (reference, metered by the host), per calendar month from 00:00 UTC on the 1st
- Allowed values: empty until entered, then an integer of at least 1; an unset limit fails the installation check
- Requirement: TRV-03
- Origin: Local hypothesis, to be confirmed (hosting sheet)
- Lot: 1

### Quota limits per service — the host, active CPU hours a month

The active CPU hours a month that the host allows; the status screen shows it as a reference, which the app does not enforce.

- Key: `quotas.hosting.activeCpuHoursPerMonth`
- Default: not set
- Unit: active CPU hours (reference, metered by the host), per calendar month from 00:00 UTC on the 1st
- Allowed values: empty until entered, then an integer of at least 1; an unset limit fails the installation check
- Requirement: TRV-03
- Origin: Local hypothesis, to be confirmed (hosting sheet)
- Lot: 1

### Quota limits per service — the host, memory GB-hours a month

The memory GB-hours a month that the host allows; the status screen shows it as a reference, which the app does not enforce.

- Key: `quotas.hosting.memoryGbHoursPerMonth`
- Default: not set
- Unit: GB-hours of memory (reference, metered by the host), per calendar month from 00:00 UTC on the 1st
- Allowed values: empty until entered, then an integer of at least 1; an unset limit fails the installation check
- Requirement: TRV-03
- Origin: Local hypothesis, to be confirmed (hosting sheet)
- Lot: 1

### Quota limits per service — the host, runtime cache reads a month

The runtime cache reads a month that the host allows; the status screen shows it as a reference, which the app does not enforce.

- Key: `quotas.hosting.runtimeCacheReadsPerMonth`
- Default: not set
- Unit: runtime cache reads (reference, metered by the host), per calendar month from 00:00 UTC on the 1st
- Allowed values: empty until entered, then an integer of at least 1; an unset limit fails the installation check
- Requirement: TRV-03
- Origin: Local hypothesis, to be confirmed (hosting sheet)
- Lot: 1

### Quota limits per service — the host, runtime cache writes a month

The runtime cache writes a month that the host allows; the status screen shows it as a reference, which the app does not enforce.

- Key: `quotas.hosting.runtimeCacheWritesPerMonth`
- Default: not set
- Unit: runtime cache writes (reference, metered by the host), per calendar month from 00:00 UTC on the 1st
- Allowed values: empty until entered, then an integer of at least 1; an unset limit fails the installation check
- Requirement: TRV-03
- Origin: Local hypothesis, to be confirmed (hosting sheet)
- Lot: 1

### Quota limits per service — the host, scheduled runs a month

The scheduled runs a month that the host allows; the status screen shows it as a reference, which the app does not enforce.

- Key: `quotas.hosting.schedulesRunsPerMonth`
- Default: not set
- Unit: scheduled runs (reference, metered by the host), per calendar month from 00:00 UTC on the 1st
- Allowed values: empty until entered, then an integer of at least 1; an unset limit fails the installation check
- Requirement: TRV-03
- Origin: Local hypothesis, to be confirmed (scheduler sheet)
- Lot: 1

### Quota limits per service — Telegram, messages a second

The messages a second that Telegram allows; the app keeps its use within it.

- Key: `quotas.telegram.messagesPerSecond`
- Default: not set
- Unit: messages in one chat, per second (a rate, no reset)
- Allowed values: empty until entered, then an integer of at least 1; an unset limit fails the installation check
- Requirement: TRV-03
- Origin: Local hypothesis, to be confirmed (telegram sheet)
- Lot: 2

### Quota limits per service — the backup storage, megabytes a file

The megabytes a file that the backup storage allows; the app keeps its use within it.

- Key: `quotas.backupStorage.maxFileMegabytes`
- Default: not set
- Unit: MB per asset (a size, no period)
- Allowed values: empty until entered, then an integer of at least 1; an unset limit fails the installation check
- Requirement: TRV-03
- Origin: Local hypothesis, to be confirmed (backup storage sheet)
- Lot: 1

### Quota limits per service — the backup storage, requests an hour

The requests an hour that the backup storage allows; the status screen shows it as a reference, which the app does not enforce.

- Key: `quotas.backupStorage.requestsPerHour`
- Default: not set
- Unit: requests (reference), per hourly window reset at the instant GitHub's x-ratelimit-reset header reports
- Allowed values: empty until entered, then an integer of at least 1; an unset limit fails the installation check
- Requirement: TRV-03
- Origin: Local hypothesis, to be confirmed (backup storage sheet)
- Lot: 1

### Quota warning share

A warning is given when the use of a quota reaches this share of its limit.

- Key: `quotas.warningShare`
- Default: 80%
- Unit: % of a limit
- Allowed values: 1 to 99%
- Requirement: TRV-05
- Origin: Local hypothesis, to be confirmed (H-TRV-02)
- Lot: 1

### Database volume warning share

A warning is given when the database's volume reaches this share of its capacity.

- Key: `quotas.databaseWarningShare`
- Default: 80%
- Unit: % of the capacity
- Allowed values: 1 to 99%
- Requirement: TRV-07
- Origin: Local hypothesis, to be confirmed (H-TRV-03)
- Lot: 1

### Statistics update start

The time of day, in your time zone, when the daily statistics update starts.

- Key: `scheduler.statsUpdateTime`
- Default: 15:00
- Unit: local time
- Allowed values: any time of day, at least one hour before the cut-off
- Requirement: TRV-25
- Origin: Local hypothesis, to be confirmed (CL-TRV-23)
- Lot: 1

### Statistics update cut-off

When the source has not refreshed by this time of day, the update fetches what is published.

- Key: `scheduler.statsUpdateCutoff`
- Default: 20:00
- Unit: local time
- Allowed values: any time of day, at least one hour after the start
- Requirement: TRV-25
- Origin: Local hypothesis, to be confirmed (CL-TRV-23)
- Lot: 1

### Probe interval while waiting for the source

How often the waiting update checks whether the source's daily refresh has landed.

- Key: `scheduler.statsProbeIntervalMinutes`
- Default: 60 minutes
- Unit: minutes
- Allowed values: 15 to 120 minutes
- Requirement: TRV-25
- Origin: Local hypothesis, to be confirmed (CL-TRV-23)
- Lot: 1

### Late days before the incident

After this many consecutive competition days with a late source, an incident opens.

- Key: `scheduler.statsLateDaysBeforeIncident`
- Default: 2 late days
- Unit: consecutive late competition days
- Allowed values: 1 to 7 late days
- Requirement: TRV-45
- Origin: Local hypothesis, to be confirmed (CL-TRV-23)
- Lot: 1

### Purge time

The time of day, in your time zone, when data past its retention is deleted.

- Key: `scheduler.purgeTime`
- Default: 04:00
- Unit: local time
- Allowed values: any time of day
- Requirement: TRV-25
- Origin: Local hypothesis, to be confirmed (H-TRV-07)
- Lot: 1

### Margin before "task not run"

A task that has not run this long after its due time opens the incident "Task not run".

- Key: `scheduler.missedRunMarginHours`
- Default: 2 hours
- Unit: hours
- Allowed values: 0.25 to 24 hours, step 0.25
- Requirement: TRV-31
- Origin: Local hypothesis, to be confirmed (H-TRV-07)
- Lot: 1

### Expected trigger interval

The trigger service shows as degraded when no tick came for twice this interval.

- Key: `scheduler.expectedTickIntervalMinutes`
- Default: 5 minutes
- Unit: minutes, the primary trigger service's interval (monitoring only; no rule counts ticks)
- Allowed values: 1 to 60 minutes
- Requirement: TRV-03
- Origin: Local hypothesis, to be confirmed (scheduler sheet)
- Lot: 1

### Journal retention

How long the entries of the activity journal are kept.

- Key: `journal.retentionDays`
- Default: 90 days
- Unit: days
- Allowed values: 7 to 365 days
- Requirement: TRV-48
- Origin: Local hypothesis, to be confirmed (H-TRV-08)
- Lot: 1

### Backup day and time — day

The day of the automatic backup: one day a week, or every day.

- Key: `backups.weekday`
- Default: Monday
- Unit: a weekday, or every day (the backup interval is then 1 day)
- Allowed values: Monday / Tuesday / Wednesday / Thursday / Friday / Saturday / Sunday / every day
- Requirement: TRV-50
- Origin: Local hypothesis, to be confirmed (H-TRV-09)
- Lot: 1

### Backup day and time — time

The time of day, in your time zone, of the automatic backup.

- Key: `backups.time`
- Default: 05:00
- Unit: local time
- Allowed values: a time of day
- Requirement: TRV-50
- Origin: Local hypothesis, to be confirmed (H-TRV-09)
- Lot: 1

### Backups kept

How many backups are kept, all kinds together; with the backup interval, it sets how long withdrawal fingerprints last.

- Key: `backups.kept`
- Default: 8 backups
- Unit: backups, all kinds counted together; times the backup interval it gives the fingerprint horizon (CL-DSN-07)
- Allowed values: 1 to 52 backups
- Requirement: TRV-50
- Origin: Local hypothesis, to be confirmed (H-TRV-09)
- Lot: 1

### Export reminder delay

After this long without a full export downloaded, the to-do list reminds you to make one.

- Key: `backups.exportReminderDays`
- Default: 30 days
- Unit: days since the last full export downloaded or, when none was, since the first start (CL-TRV-22)
- Allowed values: 1 to 365 days
- Requirement: TRV-54
- Origin: Local hypothesis, to be confirmed (H-TRV-09)
- Lot: 1

### Minimum password length

The shortest password the account accepts.

- Key: `auth.passwordMinLength`
- Default: 12 characters
- Unit: characters
- Allowed values: 12 to 128 characters
- Requirement: TRV-60
- Origin: Local hypothesis, to be confirmed (H-TRV-10)
- Lot: 1

### Login failures

After this many failed logins within the observation period, logging in is locked.

- Key: `auth.loginFailureThreshold`
- Default: 5 failures
- Unit: failures
- Allowed values: 3 to 20 failures
- Requirement: TRV-61
- Origin: Local hypothesis, to be confirmed (H-TRV-10)
- Lot: 1

### Observation period

The period over which failed logins are counted.

- Key: `auth.loginFailureWindowMinutes`
- Default: 15 minutes
- Unit: minutes
- Allowed values: 1 to 1,440 minutes
- Requirement: TRV-61
- Origin: Local hypothesis, to be confirmed (H-TRV-10)
- Lot: 1

### Lockout duration

How long logging in stays locked after too many failures.

- Key: `auth.lockoutMinutes`
- Default: 15 minutes
- Unit: minutes
- Allowed values: 1 to 1,440 minutes
- Requirement: TRV-61
- Origin: Local hypothesis, to be confirmed (H-TRV-10)
- Lot: 1

### Idle session duration

A session unused for this long ends.

- Key: `auth.sessionIdleDays`
- Default: 30 days
- Unit: days without use
- Allowed values: 1 to 365 days
- Requirement: TRV-62
- Origin: Local hypothesis, to be confirmed (H-TRV-10)
- Lot: 1
