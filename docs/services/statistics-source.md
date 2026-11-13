# Service sheet: statistics source

Service sheet required by TRV-09 for the statistics source (D-27, TRV-15). Chosen on 2026-11-11; the comparison with the other candidates, the tests cited below (T1 to T22), the mapping of the source's fields to the `stats-source` port and the rules for recorded fixtures are in the [statistics source evaluation](../engineering/statistics-source-evaluation.md). The port's interface is set by the [module map](../engineering/module-map.md#stats-source-lot-1).

## Role

The source of every NBA game fact Egoscope uses (STA-01, STA-02): the schedule of past and upcoming games with tip-off instants, results, phases and playoff labels; one box score per player per game, did-not-play box scores included; player identities, current team and birthday (day and month only). Egoscope downloads public data files, keeps what it needs in its database with the date it fetched them (STA-42) and computes everything else itself (STA-43).

**Service:** the SportsDataverse open-data releases of NBA data compiled from ESPN. They are produced by the repository [`sportsdataverse/hoopR-nba-data`](https://github.com/sportsdataverse/hoopR-nba-data) and published as release assets of [`sportsdataverse/sportsdataverse-data`](https://github.com/sportsdataverse/sportsdataverse-data).

| Release tag | Content | Files per season |
| --- | --- | --- |
| `espn_nba_schedules` | One row per game: ids, tip-off instant, venue, status, score, phase, playoff and NBA Cup labels | `nba_schedule_{season}.csv`, `.parquet` |
| `espn_nba_player_boxscores` | One row per player per game | `player_box_{season}.csv`, `.parquet` |
| `espn_nba_player_core` | Player reference: ids, names, current team, date of birth | `player_core_{season}.csv`, `.parquet` |
| `nba_crosswalk` | ESPN to NBA ids for players, games and teams, used only for a replacement | `nba_player_crosswalk_{season}.csv` and similar |

Files are named by the season's ending year: `2027` is 2026-27, as the release notes state.

## Plan and cost

Free. There is no plan, no sign-up and no payment card: the files are public downloads, and each release's notes give "Direct download (no auth, no API key)" ([release notes](https://github.com/sportsdataverse/sportsdataverse-data/releases/tag/espn_nba_player_boxscores)). The data is licensed CC BY 4.0, which requires attribution (see Terms). Nothing in Egoscope depends on a paid option (TRV-01, TRV-02).

## Account needed

None. Not even a GitHub account or token: the owner's GitHub account is not involved.

## Limits

| Limit | Value | Source |
| --- | --- | --- |
| Requests per period | None published for release downloads; no rate-limit header on asset downloads | [GitHub docs, About releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases): "There is no limit on the total size of a release, nor bandwidth usage."; test T13 |
| Bandwidth | No limit published; GitHub may throttle or suspend usage it finds significantly excessive compared with other users of similar features | [GitHub Acceptable Use Policies, section 9](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies) |
| GitHub REST API (not used at run time) | 60 requests an hour per address, unauthenticated | [GitHub REST API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) |
| Update cadence | Producer workflow scheduled daily at 07:00 UTC from 18 October to 12 July | [daily_nba.yml](https://github.com/sportsdataverse/hoopR-nba-data/blob/main/.github/workflows/daily_nba.yml) |
| Observed refresh | First refresh of the day between 11:29 and 13:32 UTC on 22 of 23 days, 16:31 UTC on the other | Test T10 |
| File sizes | Per season: player box 2.2 to 17.9 MB in CSV, 0.11 to 0.73 MB in Parquet; schedule 0.77 to 9.2 MB in CSV; player file 0.03 to 0.21 MB in CSV | Test T1 |
| History | Regular season and playoffs from 1993-94 | Test T4 |
| Host limits that shape the calls | Vercel Hobby functions: 300 seconds maximum duration, 2 GB memory | [Vercel Functions limits](https://vercel.com/docs/functions/limitations) |

Egoscope's own ceilings, as quota settings (TRV-03, TRV-39), since the provider publishes none: 200 file downloads and 2 GB a day, one download at a time, warning at 80 % (TRV-05). They are courtesy limits set well above the expected use below, not provider limits.

## Our expected use and the margin

| Use | Requests | Volume | Margin |
| --- | --- | --- | --- |
| Daily update (STA-32): publication probe, then the current season's schedule, box scores and player file | 4 conditional requests, plus up to 5 hourly retries of the probe while the source is late | About 5 MB on 2026-11-11 (T2); about 27 MB at season end in CSV (the 2025-26 files: 17.7, 9.2 and 0.2 MB, T5, T16); a 304 when nothing changed (T13) | Far below the ceilings; no provider quota |
| Correction window (STA-33) | None extra: the daily re-read of the current season covers the 7 days | Included above | |
| Career backfill of the longest current career, 24 seasons from 2003-04 (T20), about 2,000 box scores (H-TRV-04) | 24 player-box files; the 24 schedule files are shared by all followed players (STA-42) | 380 MB in CSV, 15.5 MB in Parquet (T1) | One season per call in under 2.5 seconds (T12): the whole career fits in one day, in fact in minutes (TRV-15) |
| First load for 20 to 30 players | At most 34 seasons of player-box, schedule and player files | At most about 570 MB in CSV or 26 MB in Parquet, once (T1) | Spread over several invocations by the queue (STA-40, TRV-30) |

## Terms on personal use and automated access

- **Data license.** The producer licenses its data, code and documentation under CC BY 4.0: "licensed under the Creative Commons Attribution 4.0 International License (CC BY 4.0)" ([LICENSE.md](https://github.com/sportsdataverse/hoopR-nba-data/blob/main/LICENSE.md); the release repository shows the same license badge, [README](https://github.com/sportsdataverse/sportsdataverse-data)). CC BY 4.0 allows any use, commercial or not, so personal non-commercial use is covered, on condition of attribution.
- **Attribution Egoscope displays** (About screen and documentation, TRV-79): "NBA game data: SportsDataverse hoopR NBA data, compiled from ESPN, licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Egoscope computes its own indices from it."
- **Automated access.** The files are meant to be fetched by programs: the release notes document direct download without key, and the SportsDataverse packages load them the same way. GitHub's policy defines scraping as automated extraction and states that it "does not refer to the collection of information through our API" ([Acceptable Use Policies, section 7](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies)); downloading published release assets is the feature's ordinary use. The release repository's README recommends its R and Python loaders rather than the assets directly ([README, Consuming the data](https://github.com/sportsdataverse/sportsdataverse-data)); that is advice, not a restriction, and is recorded as a risk.
- **Upstream.** The publisher compiles the files from ESPN's web API, which the release notes name as the upstream source. ESPN's own terms forbid extracting its products by automated means ([Disney terms of use](https://disneytermsofuse.com/english/), linked from espn.com). Those terms bind the publisher's collection, not Egoscope's download of a licensed release; Egoscope never contacts ESPN. The owner's rule against scraped endpoints is about what the app calls; how it was applied is explained in the evaluation, section 3. The takedown risk is listed under Risks.

## Inactivity policy

No account, so there is nothing that inactivity could delete (TRV-11). The data stays available as long as the publisher keeps the releases; the publisher keeps dormant datasets "for archival access only" ([README, Dormant and archived datasets](https://github.com/sportsdataverse/sportsdataverse-data)). Egoscope keeps every file it used in its own database (STA-42), so losing the source never loses data already fetched (TRV-12). Nothing is entrusted to the service, so there is nothing to recover from it.

## Data we send

HTTP `GET` requests to `github.com` and, after the redirect, to `release-assets.githubusercontent.com`. Each carries a fixed generic `User-Agent` and, when Egoscope already holds the file, an `If-None-Match` header with its stored `ETag`. No key, no account, no user data and no player name: file addresses contain only a release tag and a season year. The hosting provider's address is visible to GitHub. This meets TRV-66.

## How it is called

- **Address:** `https://github.com/sportsdataverse/sportsdataverse-data/releases/download/{tag}/{file}`, for example `.../espn_nba_player_boxscores/player_box_2027.csv`. The server answers 302 to a signed address on `release-assets.githubusercontent.com`; the client follows it (T13). Never the REST API at run time.
- **Freshness probe:** `.../espn_nba_player_boxscores/timestamp.json` (43 bytes, for example `{"last_updated":"2026-11-11 07:33:33 EST"}`), fetched conditionally; its `Last-Modified` header gives the refresh instant in GMT (T13).
- **Changed files only:** conditional requests with the stored `ETag` answer 304 when nothing changed (T13). A consolidated season is never requested again (STA-42).
- **Parsing:** CSV with a streaming parser; one season fetches and parses in under 2.5 seconds in TypeScript (T12). Parquet player-box files, about 25 times smaller (T1), are an option once a JavaScript reader is chosen; that was not tested.
- **Rules the adapter applies:** listed in the evaluation, section 10 (season by date, the game's day in US Eastern time, exclusion of All-Star games and the NBA Cup final, case-insensitive booleans, no did-not-play reason, whole minutes, no zero-filling, ejection unknown, make-up games tied to postponed ones, team history from box scores); the field-by-field mapping to the port is in its section 12.
- **Time conversion (STA-29, TRV-15):** the schedule gives each tip-off twice, as a UTC instant (`date`, for example `2026-11-11T00:30Z`) and as Eastern time with its offset (`game_date_time`, for the same game `2026-11-10T19:30:00.000000-0500`). Egoscope stores the UTC instant, as epoch milliseconds. Verified across the March 2025 change of US time: 19:30 Eastern on 2025-03-08 is `-0500` and 00:30 UTC the next day; 19:30 Eastern on 2025-03-14 is `-0400` and 23:30 UTC (T11). When `time_valid` is false the time is "to be determined" (STA-31).
- **The game's day (CL-TRV-03):** a game's day, for every rule and every display, is the calendar date, in `America/New_York`, of the schedule's `date` field; the source's `game_date` field carries that same date in all 43,562 schedule rows checked, so no game changes day, games played abroad included (T21). No venue time zone is used.
- **Daily task timing (CL-TRV-23):** at 12:00 Paris time the previous night was never published in the 23 days measured (T10). The daily statistics update therefore starts at 15:00 in the owner's time zone; it probes `timestamp.json` conditionally every 60 minutes and fetches as soon as the source has refreshed after the last scheduled tip-off of the past competition day plus the STA-32 delay; at the 20:00 cut-off it fetches what is published and ends "source late"; after 2 consecutive late competition days the incident "Stats source unavailable" opens. The three times and the number of days are settings.
- **Environment variables:** none required, and no secret (TRV-64 does not apply). Optional `STATS_SOURCE_BASE_URL` overrides the address above for a mirror or for tests; it defaults to the address above.
- **Installation check (TRV-47):** one conditional request for the probe file; success, or the failure with its cause.

## What happens when a quota is hit

The provider publishes no quota, so a refusal can only be unexpected:

- **HTTP 429, or 403 with rate-limit headers:** Egoscope treats the limit as reached for the period, stops its requests and opens an incident asking to check the service's conditions (TRV-06); requests wait in the queue by priority and resume at the next period (STA-39, STA-40). Egoscope never works around a refusal (H-STA-15).
- **Egoscope's own ceilings reached:** same handling, with the 10 % reserve kept for priorities 1 and 2 (STA-39) and a warning at 80 % (TRV-05).
- **Network error, timeout or HTTP 5xx:** retry after 1 hour, then every 4 hours; after 12 hours of continuous failure, the incident "Stats source unavailable"; no case changes state because of the outage (STA-36, STA-37).
- **Current season file missing (HTTP 404) or columns changed:** nothing from that file is ingested, data already stored is kept, and the incident "Stats source format changed" opens; the evaluation and this sheet are re-checked (TRV-10).
- **Source late (no refresh after the last game):** the daily update waits and probes hourly until the 20:00 cut-off, then fetches what is published and ends "source late"; the incident opens after 2 consecutive late competition days (CL-TRV-23); late box scores follow STA-35.

## Replaceable by

1. **SportsDataverse releases compiled from NBA Stats** (tags `nba_stats_player_boxscores`, `nba_stats_schedules`; same channel, no account, CC BY 4.0, [release notes](https://github.com/sportsdataverse/sportsdataverse-data/releases/tag/nba_stats_player_boxscores)). From 1996-97, minutes in MM:SS (T9). Its pipeline runs from a residential connection, so it is more fragile (release notes).
2. **Kaggle "NBA Dataset: Box Scores and Stats (1947 - Today)"** (`eoinamoore/historical-nba-data-and-player-box-scores`, CC0, anonymous download, T17). From 1946-47 (T7), but decimal minutes are in the wrong unit for 92 % of 2025-26 box scores (T9), so it can replace the primary for recent seasons only once that is fixed upstream; it is also refreshed later (15:00 to 18:57 UTC, T10) and its current-version pointer lags (T17).
3. **API-Sports API-NBA** (documented API; free plan of 100 requests a day without a card, but an account, about 11 seasons and free-plan season restrictions; untested, T18).

Procedure (TRV-12, TRV-77, ruling CL-TRV-14): implement the alternative adapter behind the same port; keep every stored statistic with the identifiers of the source it came from, and never fetch a consolidated game again (STA-42); map players with the published crosswalk (`nba_crosswalk`) where it has a match, otherwise by a new confirmation (STA-03, JOU-10); match teams and games between the two sources by date, home team and away team for the seasons still open; each season comes from one source only (CL-STA-23). No case changes because of the replacement alone, and no functionality changes; only the "Rounded minutes" notice and the first season covered may differ.

## Date checked

2026-11-11, for every address, term and test above. To be checked again before each deployment and whenever an incident suggests a change (TRV-10).

## Verified by test and from documentation only

Verified by test on 2026-11-11 (evaluation, section 6): anonymous direct download and redirect; conditional requests and the probe file; current-season content and completeness through 2026-11-10; the 1993-94 first season and per-season game counts; completeness and consistency of every Game Score input in every season; agreement with an NBA.com-derived copy; the rounding of minutes; tip-off instants across a change of US time; the game's Eastern date in every schedule row, games abroad included; labels for phases, playoff rounds, play-in, NBA Cup, All-Star, postponed and make-up games; the ejection flag never set; the meaning of the team field in past-season player files; refresh times over 23 days; fetching and parsing in TypeScript.

From documentation only: the CC BY 4.0 license and the attribution duty; GitHub's statements on release bandwidth and on scraping; the REST API rate limit; the producer's workflow schedule; Vercel's function limits.

Not verified: when the next season's schedule and the playoff schedule appear in the files; behavior under sustained high request rates (not attempted, out of courtesy); Parquet parsing in TypeScript.

## Risks

1. **Provenance and takedown.** The data is compiled from ESPN's web API, whose terms forbid automated extraction. If ESPN objects or blocks the publisher, the releases may stop or disappear. Mitigation: everything fetched is stored (STA-42); replacements 1 to 3 above; a stale or missing current-season file opens an incident.
2. **Volunteer-maintained pipeline.** One open-source pipeline on scheduled workflows; its own workflow file records a past failure that published nothing while reporting success; asset naming changed this year in a sister release (season re-key on 2026-08-13, NBA Stats release notes). Mitigation: schema validation before any ingestion, contract tests on recorded fixtures (anonymized as the evaluation's section 13 requires), freshness probe with an incident when the current season stops moving during the season.
3. **Freshness.** The previous night appeared between 11:29 and 13:32 UTC on 22 of 23 days and at 16:31 UTC on the other (T10): a 12:00 Paris run is a day late. Mitigation: the 15:00 start with an hourly probe and the 20:00 cut-off of CL-TRV-23 (How it is called).
4. **Precision and gaps.** Whole minutes only (box scores carry the "Rounded minutes" notice, STA-12); ejections never reported (SEN-16 has nothing to flag); up to 12 regular-season games and 1 playoff game missing in a season from 2003-04 on, more before (evaluation, section 8), handled as unavailable box scores (STA-35).
5. **Data quirks.** Season overlap in the 1998-99 and 1999-2000 files (T14), All-Star games and NBA Cup final inside the regular season type (T5), boolean spelling varying by season (T6), make-up games with new ids (T19), current team in past-season files being a later snapshot (T16). Mitigation: the adapter rules of the evaluation, section 10, each covered by a test.
6. **Off-season.** The producer runs from 18 October to 12 July: no refresh in between, so the next season's games may appear only when it restarts. Effect: "No game scheduled", reason "Schedule not published" or "Offseason" (STA-26), until then.
7. **Shared addresses on serverless hosts.** Unauthenticated REST API limits apply per address and are shared with other tenants. Mitigation: never call the REST API at run time; asset downloads showed no rate-limit headers (T13).
