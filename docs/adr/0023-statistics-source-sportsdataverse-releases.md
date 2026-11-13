# 0023. Statistics source: the SportsDataverse open-data releases

- Status: Accepted
- Date: 2026-11-11
- Decided by: the coordinator, under records [0011](0011-choosing-the-remaining-services.md) and [0012](0012-statistics-coverage-gives-way.md); the provenance point below is open to the owner's review

## Context

- Record 0012: coverage gives way. Only sources that permit automated access are used, two may be combined if that reaches further back, and seasons the source does not cover give « non mesurable » cases (STA-45). No undocumented endpoints, no change to the Game Score indicator, no pause. Record 0011: free without a payment card, replaceable, fewest accounts first, with a service sheet whose terms are checked on the day.
- The specs need, without human action (STA-02, TRV-15): every official game with its tip-off instant, status, score and series; one box-score line per player and game with the twelve Game Score items and the minutes; stable identifiers; corrections reflected; an observable quota; history deep enough for the tracked careers. Record 0015 adds the day and month of birth and the team history.
- Candidates were compared on 2026-11-11 against the live web, without any account or key: `docs/engineering/statistics-source-evaluation.md` holds the evidence and the tests T1 to T21, `docs/services/statistics-source.md` the service sheet.

## Decision

- **Source**: the SportsDataverse open-data releases of NBA data compiled from ESPN, produced by `sportsdataverse/hoopR-nba-data` and published as public release assets of `sportsdataverse/sportsdataverse-data`, licensed CC BY 4.0. No account, no key, no published quota: the application downloads the files by their documented address, conditionally, and keeps what it fetched (STA-42).
- **Used alone, one source per season**: the files cover the regular season and the playoffs from 1993-94, and the longest career on a current roster starts in 2003-04, so no second source is combined. Each player has one established mapping (STA-03), and every season comes from this source only (CL-STA-23).
- **Whole minutes only**: the source gives playing time rounded to the minute, so every line carries « minutes arrondies » and the index divides by those whole minutes (STA-12, CL-STA-06).
- **Ejections never known**: the field exists but is never set, so the adapter returns "unknown" and the ejection flag of SEN-16 never appears (CL-SEN-11).
- **What the application derives itself**: the number of overtimes; the games that never count (All-Star games, the NBA Cup final); the link between a postponed game and its make-up; team records and the opponent's win percentage at the game's date; series positions and elimination games where the files lack them; player search over names, seasons and teams; team history and former teams; the first NBA game (STA-47, CL-STA-12); the season of each game, from its date.
- **Daily refresh and task hours**: the publisher refreshes once a day; over 23 days measured, the previous night landed between 11:29 and 13:32 UTC on 22 days and at 16:31 UTC on the other, so a noon run in Paris would always be a day late. The daily statistics update therefore starts at 15:00 in the owner's time zone, probes the source's refresh every 60 minutes, fetches as soon as the source has refreshed after the past competition day's last tip-off plus the STA-32 delay, stops waiting at 20:00 with the result "source late", and opens "Stats source unavailable" after 2 consecutive late competition days (see Amendments). These replace the 12:00 of H-TRV-07; the start, the cut-off, the probe interval and the number of late days are settings (CL-TRV-23, CL-STA-10).
- **Replacements, in order**: (1) the SportsDataverse releases compiled from NBA Stats — same channel, no account, exact minutes, from 1996-97; (2) the NBA.com-derived Kaggle dataset — CC0, from 1946-47, usable for recent seasons only once its minutes defect is fixed upstream; (3) API-Sports API-NBA — a documented API, but an account, 100 requests a day and about 11 seasons. Replacing the source keeps every stored statistic with the identifiers of its source and fetches the season in progress again whole from the new one, consolidated games included (CL-TRV-14, CL-STA-23; amendment of record 0012).

## Owner review: provenance

The publisher compiles the files from ESPN's web API, whose terms forbid extraction by automated means. The application itself calls no undocumented endpoint: it downloads a published, licensed file and never contacts ESPN, nba.com or stats.nba.com. The evaluation reads the owner's rule "no undocumented endpoints" (record 0012) as governing what the application calls; every free NBA box-score release found is compiled the same way. If the owner reads the rule as excluding data collected upstream that way, no free source qualifies, and the documented API of replacement 3 — with an account and fewer seasons — becomes the only candidate.

## Consequences

- The About screen and the documentation show the attribution that CC BY 4.0 requires, worded in the service sheet.
- No secret and no environment variable are needed; an optional base-address override serves a mirror or the tests. The installation check fetches the refresh probe.
- The adapter applies the rules of section 10 of the evaluation: the season assigned from the game's date; the game's day in US Eastern time ([0028](0028-a-game-day-is-its-us-eastern-date.md)); All-Star games and the NBA Cup final excluded; booleans read without regard to case; no did-not-play reason kept; whole minutes, never a value filled with zero; ejection unknown; make-up games linked to their postponed originals; team history from box-score lines, not from past-season player files; every file validated against its expected columns, a changed file stopping its ingestion with the "Stats source format changed" incident (CL-STA-15).
- Since the provider publishes no quota, the application's own courtesy ceilings are entered as the quota settings (TRV-03), with the 80 % warning of TRV-05.
- No refresh happens from mid-July to mid-October: until the publisher restarts, the next game shows « aucun match prévu » with « intersaison » or « calendrier non publié » (STA-26).
- A few games of older seasons are missing — up to 12 regular-season games and 1 playoff game in a season from 2003-04 on, more before — and become « feuille indisponible » (STA-35).
- The risks the service sheet lists stay visible: provenance and takedown, a volunteer-maintained pipeline, late refreshes, precision gaps, data quirks.

## Alternatives considered

From section 4 of the evaluation:

- The three replacements above, each ranked below the primary for its later first season, its minutes defect, or its account and smaller reach.
- Rejected: Highlightly (depth unknown, account, small quota); balldontlie (no free box scores); BigBalls Sports Data (current season only, rebounds missing on the free plan); API Ninjas (no box scores); TheSportsDB (box scores not documented); MySportsFeeds (paid); SportsDataIO (trial with scrambled data); Sportradar (trial only); the other Kaggle NBA database (not current); `llimllib/nba_data` (no license).
- Rejected by the owner's rule: the undocumented nba.com and stats.nba.com endpoints, the ESPN site API, scraping Basketball-Reference.

## What would change it

- The releases stop, disappear, change their columns or their license: the first replacement that passes the checks of the day (TRV-10), by the procedure of CL-TRV-14.
- The owner rules the provenance unacceptable: replacement 3, with profiles limited to its seasons (record 0012).
- A tracked player whose career starts before 1993-94: a second source for the earlier seasons, one source per season (CL-STA-23).
- A release with exact minutes and the same reach: switching to it, with the season in progress fetched again whole.

## Amendments

### 2026-11-11 — One run per competition day (CL-TRV-23, CL-STA-10)

- The daily statistics update is one run per competition day. From 15:00 it probes the source's refresh about every 60 minutes, and a probe opens no database connection ([0025](0025-database-compute-budget-shapes-the-scheduler.md)), so a probe that finds nothing records nothing of its own. The run ends "succeeded" when a probe sees the refresh and the data is ingested, or, at the 20:00 cut-off, fetches what is published and ends "source late"; after a competition day without games it does not wait.
- Besides the outages of STA-37, the "Stats source unavailable" incident opens after 2 consecutive competition days whose runs ended "source late", and closes when a refresh lands. A late source is never "task not run".
