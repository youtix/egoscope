# Statistics source evaluation

Evidence for the choice of the statistics source (Q-02, Q-STA-01, TRV-15). All checks were made on 2026-11-11 against the live web, without any account, key or credential. The chosen service and how Egoscope uses it are in the [statistics source service sheet](../services/statistics-source.md).

## 1. Decision

- **Primary source: the SportsDataverse open-data releases of NBA data compiled from ESPN** (producer repository `sportsdataverse/hoopR-nba-data`, files published as GitHub release assets in `sportsdataverse/sportsdataverse-data`). Public files, no account, no key, no quota, license CC BY 4.0.
- **No second source is combined.** The primary covers the regular season and the playoffs from 1993-94 onward (test T4), while the longest career among players on a current roster starts in 2003-04 (test T20). No other candidate reaches further back for the players Egoscope can follow, and no required fact is missing that another candidate would supply.
- **Replacements, in order:** the SportsDataverse releases compiled from NBA Stats (same channel, exact minutes, from 1996-97); the NBA.com-derived Kaggle dataset (CC0, from 1946-47, but with a measured minutes defect); API-Sports API-NBA (documented API, but an account, 100 requests a day and 11 seasons). See section 4.
- **What stays uncovered:** seconds of playing time (minutes are whole, so every sheet carries "minutes arrondies", STA-12); ejections (the field exists but is never set, SEN-16 has nothing to flag); seasons before 1993-94 (no current player is affected; any case there is "saison non couverte par la source", STA-45); a few individual games in older seasons (section 8), which become "feuille indisponible" (STA-35).

Decisive evidence:

1. Every played line of every season from 1993-94 to 2026-27 has all twelve Game Score inputs and points that match the shooting (0 missing values, 0 inconsistencies, test T4, T5).
2. From 2003-04 onward the files hold at least 99.0 % of each season's regular-season games and 98.9 % of its playoff games (test T4 against the NBA.com-derived counts of test T7).
3. Box-score values agree with an independent NBA.com-derived copy on 28,394 player lines of 2025-26, with at most 6 differences per field (test T8); whole minutes are the nearest minute of the official time in 28,392 of those lines (test T9).
4. The previous night's games were complete in the files about 8.5 hours after the last tip-off (test T3), and the files were refreshed every day of the 23 days measured (test T10).
5. A full season fetches and parses in TypeScript in under 2.5 seconds (test T12), well inside the 300-second Vercel Hobby limit.

## 2. What the source must provide

The needs, checked against the specs and completed (needs found in the specs beyond the first list are marked "added").

| Need | Spec |
| --- | --- |
| Per-game player line: minutes and seconds, points, field goals made and attempted, free throws made and attempted, offensive and defensive rebounds, assists, steals, blocks, turnovers, personal fouls | STA-08, STA-11, STA-12 |
| Three-pointers made, for the consistency check (added) | STA-08, STA-09 |
| Whether the player played; no absence cause | STA-13, JOU-21, DSN-15 |
| The player's team in that game, opponent, home or away | STA-05, STA-08, JOU-13 |
| Tip-off as an absolute instant (or enough to derive it), and a "time to be determined" marker (added) | STA-05, STA-29, STA-31, TRV-15 |
| The game's day: the calendar date of its scheduled start in US Eastern time (`America/New_York`), for every rule and every display, birthday games included (ruling CL-TRV-03) | SEN-02, STA-31, STA-32, TRV-72 |
| Number of overtimes, for the minutes ceiling (added) | STA-09 |
| Season and phase: regular season, play-in, playoffs; games that never count flagged: preseason, All-Star, NBA Cup final (added) | STA-04, STA-05, STA-48 |
| Status: scheduled, in progress, final, postponed, canceled; final score (added) | STA-05 |
| Team results, to compute the opponent's win percentage at the date of the game | STA-06, SEN-15 |
| Playoff series, game number and wins before the game, or enough to tell an elimination game | STA-05, STA-07, SEN-14 |
| Upcoming schedule with tip-off times, kept current (postponements) | STA-26, STA-28, SUI-03 |
| Player search with what tells homonyms apart (name, teams, seasons) and stable identifiers | STA-02, STA-03, JOU-10 |
| Current team, including a move not yet visible in box scores (added) | STA-25 |
| Birthday (day and month only) and team history, for the two calendar-derived event types (owner decision) | Q-TAX-01 decision, JOU-11 exception |
| Ejection of the player, when the source says so (added) | SEN-16 |
| Official corrections reflected after the fact (added) | STA-02, STA-33 |
| A known or observable quota (added) | STA-02, STA-39, TRV-03 |
| Freshness: the daily statistics task runs at 12:00 Paris time | STA-32, TRV-25 |
| History depth for regular season and playoffs | H-06, STA-45, STA-47 |
| Free forever, no card, automated access permitted, usable from TypeScript on a serverless host, volumes with margin, no deletion for inactivity, replaceable, fewest accounts | TRV-01, TRV-02, TRV-11, TRV-12, H-TRV-04 |

## 3. Method

Rules applied, as set by the owner: only sources whose terms permit automated access; coverage gives way (profiles limited to the seasons covered, STA-45); never undocumented or scraped endpoints (stats.nba.com and the libraries built on it, hidden ESPN endpoints, scraping basketball-reference and similar sites); the performance indicator is not changed; everything free without a card, on a permanent free tier; fewest accounts.

**How the "no scraped endpoints" rule was read.** It governs what Egoscope itself calls. A data release is a published file with a documented download address and an explicit license; Egoscope downloading it is not scraping, and the owner listed "data releases with explicit licenses" among the candidates. Every free NBA data release found is compiled by its publisher from nba.com or ESPN (section 4), so this provenance is unavoidable for free box scores; it is recorded as the main risk of the choice (service sheet, Risks), not as a disqualifier. Egoscope never contacts nba.com, stats.nba.com or ESPN.

Tests: no account, no key; generic `User-Agent`; downloads kept outside the repository; downloaded files treated as untrusted data and read only by small scripts that print aggregates; no player name is reproduced here (players appear as counts or as "player A"). Test identifiers (T1 to T22) are defined in section 6.

## 4. Candidates and terms

Quotes are kept to the operative words; the full text is at the URL.

| Candidate | Access | Free, no card, account | Terms on automated access and personal use | Box scores and depth | Verdict |
| --- | --- | --- | --- | --- | --- |
| SportsDataverse releases compiled from ESPN | Public GitHub release assets; release notes: "Direct download (no auth, no API key)" ([release](https://github.com/sportsdataverse/sportsdataverse-data/releases/tag/espn_nba_player_boxscores)) | Yes, yes, none | Data "licensed under the Creative Commons Attribution 4.0 International License (CC BY 4.0)" ([LICENSE.md](https://github.com/sportsdataverse/hoopR-nba-data/blob/main/LICENSE.md)); distribution through GitHub, whose policy says scraping "does not refer to the collection of information through our API" ([AUP section 7](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies)) | All Game Score inputs, whole minutes, 1993-94 to today (T4) | **Primary** |
| SportsDataverse releases compiled from NBA Stats | Same channel ([release](https://github.com/sportsdataverse/sportsdataverse-data/releases/tag/nba_stats_player_boxscores)) | Yes, yes, none | CC BY 4.0 ([LICENSE.md](https://github.com/sportsdataverse/hoopR-nba-stats-data/blob/main/LICENSE.md)); release notes say the pipeline runs "from a residential connection" because stats.nba.com blocks datacenter addresses | All inputs, minutes as MM:SS (T9), seasons named 1997 to 2027, that is 1996-97 to today (T1) | First replacement |
| Kaggle "NBA Dataset: Box Scores and Stats (1947 - Today)" (NBA.com-derived) | Kaggle public download; Kaggle's own client says authenticating "is only needed to access public resources requiring user consent or private resources" ([kagglehub README](https://github.com/Kaggle/kagglehub/blob/main/README.md)); anonymous download verified (T17) | Yes, yes, none | License "CC0: Public Domain" (dataset metadata, T17); Kaggle terms forbid uses that copy or store "any significant portion of the Content" ([Kaggle terms](https://www.kaggle.com/terms)), read here as Kaggle's own corpus, not a CC0 dataset | 1946-47 to today (T7); decimal minutes wrong in 92 % of 2025-26 lines (T9); one 391 MB file (T17) | Second replacement |
| API-Sports API-NBA | Documented REST API with key ([product page, archived 2026-04-15](https://web.archive.org/web/20260415160827/https://api-sports.io/sports/nba)); live pages behind bot verification on 2026-11-11 (T18) | Yes, no card for the free version ([pricing, archived 2026-03-14](https://web.archive.org/web/20260314113151/https://www.api-football.com/pricing)), account required | Data provided "for you to create different projects such as applications, websites" ([terms, archived 2026-04-15](https://web.archive.org/web/20260415170717/https://api-sports.io/terms)); free plan 100 requests a day (product page); free plans "are limited in terms of available seasons" (pricing page) without saying which | "11 Years of data" (product page); fields not verifiable today; untested (needs a key, T18) | Third replacement; not primary: account, 11 seasons, untested |
| Highlightly NBA API | REST API with key ([product page](https://highlightly.net/nba-api/)) | Free plan 100 requests a day, no card; account required | Free-plan restrictions on a separate page; the docs list odds and geo restrictions as not available on the free plan ([docs](https://highlightly.net/documentation/nba/)) | History depth and box-score fields not stated | Rejected: depth unknown, account, small quota |
| balldontlie | REST API with key ([docs](https://docs.balldontlie.io/)) | Free tier 5 requests a minute; account required | Free tier excludes game player stats and box scores (tier table in the docs) | Box scores only on the paid GOAT tier | Rejected: no box scores free |
| BigBalls Sports Data | REST API with key ([NBA API page](https://bigballsdata.com/nba-api)) | 1,000 requests a day, no card; account required | "Free covers the current season." | Offensive and defensive rebounds marked unavailable on the free plan | Rejected: one season, missing Game Score inputs |
| API Ninjas NBA | REST API with key ([page](https://api-ninjas.com/api/nba)) | Free plan; account required | "The free plan covers the current season's schedule, final scores, standings and rosters." | No box-score or game-log endpoint | Rejected |
| TheSportsDB | REST API, shared free key ([docs](https://www.thesportsdb.com/documentation)) | Free key, 30 requests a minute | Player box scores not documented | Not documented | Rejected |
| MySportsFeeds | REST API, subscription ([pricing](https://www.mysportsfeeds.com/feed-pricing/)) | Paid: personal pricing from $5 a month; free trial on request | A subscription grants "the two most recent seasons" by default | Older seasons sold one by one | Rejected: not free |
| SportsDataIO | REST API ([getting started](https://sportsdata.io/developers/getting-started)) | Free trial only | Trial data: "Player names, scores, and stats are scrambled" | Real data only on paid plans | Rejected |
| Sportradar | REST API ([account docs](https://developer.sportradar.com/getting-started/docs/your-account)) | Trial only: "Our trials last 30 days.", 1,000 requests | Production by contract | Not tested | Rejected |
| Kaggle "NBA Database" (wyattowalsh/basketball) | Kaggle download | Yes, yes, none | License CC BY-SA 4.0 (metadata) | Last updated 2026-06-29 (metadata), so nothing of 2026-27 | Rejected: not current |
| llimllib/nba_data | GitHub repository | Yes, yes, none | No license declared (repository metadata) | Not examined further | Rejected: no license |
| NBA.com and stats.nba.com | Undocumented endpoints | Free | Owner rule: out. For the record, the NBA's terms allow NBA Statistics to be used "for legitimate news reporting or private, non-commercial purposes", with attribution, and not in a service featuring a comprehensive database without consent ([NBA.com terms, section 9](https://www.nba.com/termsofuse)) | Full | Rejected by rule |
| ESPN site API | Undocumented endpoints | Free | Owner rule: out. ESPN's terms forbid extraction "using a robot, spider, script, or other automated means" ([Disney terms](https://disneytermsofuse.com/english/), linked from espn.com) | Full | Rejected by rule |
| Basketball-Reference | Web pages | Free | Owner rule: out. Its publisher says it "can not provide the data available as a download" and rate-limits bots to 20 requests a minute ([bot traffic page](https://www.sports-reference.com/bot-traffic.html)) | Full | Rejected by rule |

## 5. Scoring of the remaining candidates

| Criterion | SDV from ESPN | SDV from NBA Stats | Kaggle NBA.com-derived | API-Sports API-NBA |
| --- | --- | --- | --- | --- |
| Free forever, no card | Yes | Yes | Yes | Yes (free plan can change without notice, terms) |
| Accounts | 0 | 0 | 0 | 1 |
| Automated access permitted | Yes (license, GitHub policy) | Yes | Yes (documented anonymous download) | Yes (it is an API) |
| All Game Score inputs | Yes, every season (T4) | Yes (T9 sample) | Yes, but minutes unreliable from 2024-25 (T9) | Not verifiable on 2026-11-11 (T18) |
| Minutes precision | Whole minutes, correctly rounded (T9) | Seconds (T9) | Mixed encodings (T9) | Unknown |
| First season | 1993-94 (T4) | 1996-97 (T1) | 1946-47 (T7) | About 2015-16 ("11 Years", archived page) |
| Covers the longest current career (from 2003-04, T20) | Yes | Yes | Yes | No |
| Freshness | Previous night by 11:29 to 13:32 UTC on 22 of 23 days (T10) | Previous night by 14:53 UTC on 2026-11-11 (T10) | 15:00 to 18:57 UTC, current-version pointer lags (T10, T17) | Not verifiable on 2026-11-11 (T18) |
| Upcoming schedule with instants and TBD marker | Yes (T2, T11) | Not tested | Yes, Eastern time without offset (T17) | Not verifiable on 2026-11-11 (T18) |
| Serverless fit | Per-season player-box files of 2.2 to 17.9 MB in CSV, 0.11 to 0.73 MB in Parquet (T1, T12) | Per-season files of 0.8 to 6.2 MB CSV for the 2019-20 to 2026-27 files listed (T1) | One 391 MB file, newest first, range requests work (T17) | One call per player-season |
| Upstream robustness | GitHub-hosted runners, several refreshes a day (T10) | Residential connection (release notes) | Volunteer job with announced scheduler trouble (dataset description) | Commercial service |
| Replaceability | Crosswalk to NBA ids published (T1) | Same crosswalk | Via the crosswalk | No crosswalk: identities matched by name and team, then confirmed (STA-03) |

## 6. Live tests

All on 2026-11-11 (UTC times). Base address of the release files: `https://github.com/sportsdataverse/sportsdataverse-data/releases/download/{tag}/{file}`.

- **T1, release inventory.** Unauthenticated GitHub REST API listing of release tags and assets. `espn_nba_player_boxscores`: 106 assets, seasons named 1994 to 2027 (1993-94 to 2026-27) in CSV, Parquet and RDS, plus `timestamp.json`. Sizes over the 34 seasons: player box 2.2 to 17.9 MB per season in CSV (507 MB in all; 380 MB for the 24 seasons from 2003-04), 0.11 to 0.73 MB in Parquet (20.0 MB in all; 15.5 MB from 2003-04); schedules 0.77 to 9.2 MB in CSV (57.3 MB in all), 4.2 MB in all in Parquet; player files 0.03 to 0.21 MB in CSV (4.9 MB in all). `espn_nba_schedules`: 112 assets. `espn_nba_player_core`: 106 assets, 1994 to 2027. `nba_crosswalk`: 241 assets, player, game and team crosswalks between ESPN and NBA ids, 2002 to 2027. `nba_stats_player_boxscores`: 97 assets, 1997 to 2027. The repository holding the releases is MIT for code and shows a CC BY 4.0 badge; the two producer repositories license their data, code and documentation under CC BY 4.0.
- **T2, current-season files.** `player_box_2027.csv` (2,187,437 bytes): 57 columns, 4,299 lines, 160 games, US dates 2026-10-20 to 2026-11-10. `nba_schedule_2027.csv` (2,958,242 bytes): 1,206 games, 160 final and 1,046 scheduled up to 2027-04-11; 6 games with `time_valid` false (NBA Cup knockout placeholders whose teams are also "TBD"), whose `date` is 05:00 UTC, midnight US Eastern. `player_core_2027.csv` (161,867 bytes): 482 players, a date of birth for all 482, a current team id.
- **T3, per-day completeness.** For every US date from 2026-10-31 to 2026-11-10, every game the schedule marks final had player lines in the release refreshed at 12:33 UTC on 2026-11-11, including the 6 games of 2026-11-10 whose last tip-off was 2026-11-11 04:00 UTC.
- **T4, depth scan.** Each of the 34 player-box seasons streamed and aggregated (section 8). In every season: 0 played lines missing a Game Score input, 0 lines whose points differ from two times field goals made plus three-pointers made plus free throws made, 0 lines with made above attempted, 0 negative values, 0 fractional minutes. Lines with counting stats but no minutes: 34 (1994-95), 2 (1996-97), 137 (2020-21), 83 (2024-25), 46 (2025-26), 1 (2026-27). The 1999-2000 file also holds 450 games dated February to May 1999, all 1998-99 games.
- **T5, 2025-26 detail.** `player_box_2026.csv` (17,729,581 bytes): 34,883 lines; `season_type` 2 (regular), 3 (playoffs), 5 (play-in): 1,235, 85 and 6 games. `nba_schedule_2026.csv` (9,153,001 bytes): 1,330 rows, 1,326 final and 4 postponed. Type 2 also holds 4 All-Star games (teams outside the 30 franchises) and the NBA Cup final (the two finalists show 83 regular-season games); the schedule labels them `ALLSTAR` and `CC`. Tip-off offsets are -0500 or -0400 only.
- **T6, flags.** `ejected` is never true in 2003-04, 2015-16, 2020-21, 2023-24, 2024-25 or 2025-26 (30,606 to 35,250 lines each). Boolean spelling changes between seasons (`FALSE` in 2003-04 and 2015-16, `false` in 2020-21 and later seasons sampled). Each did-not-play line carries a `reason` text, which Egoscope must drop (JOU-21, DSN-15).
- **T7, NBA.com-derived reference counts.** Kaggle `PlayerStatistics.csv` (391,267,105 bytes) streamed without credentials: 1,677,167 lines in 27.5 s. Regular-season and playoff game counts per season, used as the reference column of section 8. No played line lacks a Game Score input in any season, even back to 1951-52.
- **T8, cross-source agreement.** 2025-26 ESPN-derived lines joined to the NBA.com-derived lines through the published `nba_crosswalk` files: 28,394 played lines over 1,311 games. Differences: defensive rebounds 6, blocks 5, turnovers 3, field goals attempted 3, points 2, field goals made 2, offensive rebounds 2; free throws, assists, steals, fouls and three-pointers 0.
- **T9, minutes.** The same 28,394 lines against the NBA Stats-derived release, which gives MM:SS: ESPN's whole minutes equal the nearest minute (30 seconds round up) in 28,392 lines. The Kaggle decimal minutes equal MM + SS/60 in 2,182 lines and MM + SS/100 in 26,134 lines, so most 2025-26 values are in the wrong unit.
- **T10, freshness.** Daily "NBA Data Updated" commits of the ESPN producer (`hoopR-nba-data`) from 2026-10-20 to 2026-11-11 (table in section 9); the asset update time on 2026-11-11 (12:33:31 UTC) matches that day's first commit (12:36:46 UTC). NBA Stats-derived current-season file: updated 14:53 UTC with the last game of 2026-11-10. Kaggle versions of 2026-11-03 to 2026-11-11 were created between 15:00 and 18:57 UTC.
- **T11, time zones.** 2024-25 schedule: games of 2025-03-08 carry -0500 (19:30 Eastern is 00:30 UTC the next day); games of 2025-03-14 carry -0400 (19:30 Eastern is 23:30 UTC). This matches the specs' March acceptance criterion (displayed at 00:30 Paris time on 2025-03-15). Overtimes: `status_period` 4, 5, 6, 7 for regulation, one, two, three overtimes (1,262, 51 and 9 games in 2025-26 at 4, 5, 6).
- **T12, TypeScript feasibility.** Bun 1.4.4, standard `fetch`, a dependency-free CSV parser: 2026-27 file 526 ms download, 73 ms parse; 2025-26 file (17.7 MB) 1,958 ms download, 407 ms parse, 619 MB resident memory with the naive whole-file parser.
- **T13, conditional requests.** The asset host returns `ETag` and `Last-Modified`; `If-None-Match` and `If-Modified-Since` answer 304. `timestamp.json` is 43 bytes, for example `{"last_updated":"2026-11-11 07:33:33 EST"}`. No rate-limit header on asset downloads.
- **T14, season overlap.** 500 game ids dated 1999-02-05 to 1999-05-05 appear in both the 1998-99 and the 1999-2000 schedule files, partly labeled with the later season.
- **T15, games without box scores.** Schedules list games whose player lines are missing, with a `player_box` flag false: 6 in 1993-94, 12 in 2005-06, 136 in the 1999-2000 file.
- **T16, past-season player files.** `current_team_id` in a past season's player file (`player_core_2026.csv`, 197,793 bytes, written 2026-09-09) is a snapshot taken when the file was written: of 113 players whose team changed after 2025-26, the 2025-26 file shows the old team for 45 and the new one for 64. Team history must come from box-score lines.
- **T17, Kaggle access.** Metadata and file listing through Kaggle's public API without credentials; downloads answer 302 to a signed storage address and honor `Range` (206). On 2026-11-11 the dataset's current version stayed at 543 (2026-11-10 16:33 UTC) while versions 544 and 545 were ready; only an explicit version request returned the 2026-11-10 games. Schedule times are Eastern without an offset.
- **T18, API-Sports.** `GET https://v2.nba.api-sports.io/seasons` without a key: HTTP 403, error "Missing application key". The product, documentation and pricing pages answered HTTP 403 with a bot-verification page, and the product page stayed on that verification in a browser too (not bypassed). Evidence above therefore comes from archived copies, and the API's fields, freshness and schedule could not be checked.
- **T19, playoff labels.** All 33 schedule files from 1993-94 to 2025-26 scanned. The round is in `type_abbreviation` (RD16 first round, QTR conference semifinals, SEMI conference finals, FINAL finals) for every playoff game from 2003-04 on, and for none before (playoff games there are labeled `STD`). A game number appears in `notes_headline` for every playoff game from 2008-09 on (except 3 of 92 rows in 2019-20), for 76 of 86 in 2007-08, and never before. Every play-in game is labeled with its type (7th vs 8th place, 9th vs 10th, 8th seed game). In 2001-02 two series ended after 3 games, which only a best-of-five allows; none did in 2002-03. Postponed games keep their id with status "Postponed"; the make-up is a new id labeled "Makeup from" the original date.
- **T20, career span.** Highest `experience_years` in the 2026-27 player file: 24 (one player), earliest draft year 2003; so the oldest career to cover starts in 2003-04.
- **T21, game day.** All 34 schedule files streamed (43,562 rows, 1993-94 to 2026-27, the 1998-99 games repeated in the 1999-2000 file included): in every row the `America/New_York` calendar date of `date` equals `game_date` and the date part of `game_date_time`, whose offsets are only -0500 and -0400. The checks of this evaluation that group games by day (T3, T11) use `game_date`, so under the Eastern rule of CL-TRV-03 no game changes day: count 0. The candidates were the 31 games whose venue city lies outside the US and Canada, all from 2012-13 on: 16 in Europe (London 8, Paris 6, Berlin 1, Manchester 1), tipping off between 15:30 and 20:00 UTC, and 15 in Mexico City, between 22:00 and 03:00 UTC; each falls on the same calendar day in US Eastern time as at the venue. Before 2004-05 many rows name no venue (703 of 1,185 in 1993-94, none missing from 2004-05 on except 13 rows), so earlier games abroad cannot be located in the files; the Eastern rule does not need them to be.
- **T22, team identity across relocations.** Schedule files of 1998-99, 2001-02, 2002-03, 2004-05, 2007-08, 2008-09, 2011-12, 2012-13, 2013-14, 2014-15 and 2026-27: the team id follows a franchise that moves or is renamed, while each file keeps the location, name and abbreviation of its season. Id 25 is Seattle (`SEA`) up to 2007-08 and Oklahoma City (`OKC`) from 2008-09; id 29 is Vancouver (`VAN`) in 1998-99 and Memphis (`MEM`) from 2001-02; id 17 is New Jersey (`NJ`) up to 2011-12 and Brooklyn (`BKN`) from 2012-13; id 3 is Charlotte (`CHA`) up to 2001-02 and New Orleans (`NO`) from 2002-03, renamed in 2013-14; id 30 is the Charlotte team that starts in 2004-05, renamed in 2014-15. The files checked hold 29 franchise ids up to 2002-03 and 30 from 2004-05.

## 7. Needs coverage of the recommended source

| Need | Status | How, and evidence |
| --- | --- | --- |
| Minutes | Provided, whole minutes | `minutes` ("26.0"); nearest minute of the official time (T9). Every sheet carries "minutes arrondies" (STA-12). |
| Points, field goals made and attempted, three-pointers made, free throws made and attempted, offensive and defensive rebounds, assists, steals, blocks, turnovers, personal fouls | Provided | One column each (`fouls` is personal fouls); complete in every season (T4). |
| Played or not | Provided | `did_not_play` plus `minutes`; the `reason` column is dropped by the adapter (T6). |
| Team in that game, opponent, home or away | Provided | `team_id`, `opponent_team_id`, `home_away`; neutral sites flagged in the schedule. |
| Tip-off instant | Provided | Schedule `date` in UTC and `game_date_time` with its offset (T11). |
| Time to be determined | Provided | `time_valid` false (T2). |
| Game day (Eastern date, CL-TRV-03) | Provided | A game's day is the calendar date, in `America/New_York`, of the schedule's `date` field (the UTC tip-off instant); the source's own `game_date` field carries that same date in all 43,562 schedule rows (T21). |
| Overtimes | Derivable | `status_period` minus 4 for a final game (T11). |
| Season | Provided, with a correction | Season named by its ending year; the adapter assigns the season from the game date and season start dates, and deduplicates by game id (T14). |
| Phase | Provided | `season_type` 2, 5, 3 (T5). |
| Games that never count | Derivable | All-Star (`ALLSTAR`, teams outside the 30 franchises) and NBA Cup final (`CC`) sit in type 2 and are excluded by label; preseason is absent from the box-score files (T4, T5). |
| Status and final score | Provided | `status_type_description` (Scheduled, Final, Postponed seen), scores. |
| Postponed game keeping its identity | Derivable | The make-up has a new id labeled "Makeup from" the original date; the adapter links them by teams and label (T19). |
| Opponent's win percentage at the date of the game | Derivable | From regular-season results in the schedule, NBA Cup final excluded (STA-06). The schedule's own record columns show the record when the file was written, so they are not used. |
| Series, game number, wins before the game | Partly provided, rest derivable | Round from `type_abbreviation` from 2003-04 on, game number from `notes_headline` from 2008-09 on (T19); before that, and for wins before the game, from the chronological results of the same pairing in the postseason. |
| Elimination game | Derivable | Wins before the game plus the series length of the round (a static table per season: the 2001-02 file shows best-of-five first-round series, T19) and the play-in labels. |
| Upcoming schedule | Provided | Full regular season published (T2); placeholders with teams "TBD" are not next games until their teams are set. Playoff schedule publication not observable on 2026-11-11. |
| Player search, stable ids | Derivable, ids provided | No search endpoint: each season's player directory (names, and each team with its first and last game day) comes from that season's box-score file, and candidate search runs on the directory Egoscope stores (section 12). Team ids are stable across relocations (T22). ESPN `athlete_id`, `team_id`, `game_id`, with a published crosswalk to NBA ids (T1). |
| Current team | Provided | `current_team_id` in the current season's player file, refreshed with the release (T2, T16). |
| Birthday (day and month) | Provided | `date_of_birth` in the player file (T2); the adapter returns only month and day. |
| Team history, first game against a former team | Derivable | `team_id` of each line over the career. |
| First NBA game | Derivable | Earliest played line (STA-47). |
| Ejection | Missing in practice | Column present, never true (T6): SEN-16 never flags an ejection. |
| Corrections | Provided implicitly | The current season's files are rebuilt at each refresh; the app compares with what it stored (STA-33). No change log. |
| Quota | None to observe | No published limit on release downloads (service sheet, Limits); the app keeps its own ceilings. |

## 8. History depth (measured)

Regular-season and playoff games with player lines in the ESPN-derived files (T4), next to the NBA.com-derived counts (T7). All-Star games and the NBA Cup final are left out. The first season covered is 1993-94 for both the regular season and the playoffs.

| Season | Regular season, ESPN-derived | Regular season, NBA.com-derived | Playoffs, ESPN-derived | Playoffs, NBA.com-derived | Play-in |
| --- | --- | --- | --- | --- | --- |
| 1993-94 | 1,102 | 1,107 | 77 | 77 | |
| 1994-95 | 1,107 | 1,107 | 72 | 73 | |
| 1995-96 | 1,184 | 1,189 | 67 | 68 | |
| 1996-97 | 1,183 | 1,189 | 67 | 72 | |
| 1997-98 | 1,185 | 1,189 | 70 | 71 | |
| 1998-99 | 725 | 725 | 66 | 66 | |
| 1999-00 | 1,162 (1) | 1,189 | 75 | 75 | |
| 2000-01 | 1,189 | 1,189 | 61 | 71 | |
| 2001-02 | 1,189 | 1,189 | 71 | 71 | |
| 2002-03 | 1,189 | 1,189 | 88 | 88 | |
| 2003-04 | 1,189 | 1,189 | 82 | 82 | |
| 2004-05 | 1,228 | 1,230 | 84 | 84 | |
| 2005-06 | 1,218 | 1,230 | 88 | 89 | |
| 2006-07 | 1,228 | 1,230 | 79 | 79 | |
| 2007-08 | 1,230 | 1,230 | 86 | 86 | |
| 2008-09 | 1,230 | 1,230 | 85 | 85 | |
| 2009-10 | 1,230 | 1,230 | 82 | 82 | |
| 2010-11 | 1,229 | 1,230 | 81 | 81 | |
| 2011-12 | 990 | 990 | 84 | 84 | |
| 2012-13 | 1,224 | 1,229 | 85 | 85 | |
| 2013-14 | 1,229 | 1,230 | 89 | 89 | |
| 2014-15 | 1,230 | 1,230 | 81 | 81 | |
| 2015-16 | 1,230 | 1,230 | 86 | 86 | |
| 2016-17 | 1,229 | 1,230 | 79 | 79 | |
| 2017-18 | 1,229 | 1,230 | 82 | 82 | |
| 2018-19 | 1,229 | 1,230 | 82 | 82 | |
| 2019-20 | 1,059 | 1,059 | 83 | 83 | 1 and 1 |
| 2020-21 | 1,080 | 1,080 | 85 | 85 | 6 and 6 |
| 2021-22 | 1,230 | 1,230 | 87 | 87 | 6 and 6 |
| 2022-23 | 1,230 | 1,230 | 84 | 84 | 6 and 6 |
| 2023-24 | 1,230 | 1,230 | 82 | 82 | 6 and 6 |
| 2024-25 | 1,230 | 1,224 | 84 | 84 | 6 and 6 |
| 2025-26 | 1,230 | 1,230 | 85 | 85 | 6 and 6 |
| 2026-27 | 160 up to 2026-11-10 | 154 up to 2026-11-09 | | | |

(1) Games dated November 1999 to April 2000. The 1999-2000 player-box file also holds 450 games dated February to May 1999 (T4), and the 1999-2000 schedule file 500 (T14); the adapter reassigns them to 1998-99 by date.

From 2003-04, the first season any current player needs (T20), the worst seasons are 2005-06 (1,218 of 1,230 regular-season games, 99.0 %; 88 of 89 playoff games, 98.9 %) and 2012-13 (1,224 of 1,229, 99.6 %). Missing games are listed by the schedule (T15), so the app knows them and marks the sheets unavailable instead of overlooking the games. At this rate no season reaches the 20 % threshold of a "partielle" reference (STA-24) from missing games alone.

## 9. Freshness (measured)

First daily refresh of the ESPN-derived files (T10), with the time of the 12:00 Paris task in UTC (Paris changed from summer to winter time on 2026-10-25).

| UTC day | First refresh (UTC) | 12:00 Paris in UTC | Before 12:00 Paris |
| --- | --- | --- | --- |
| 2026-10-20 | 11:34 | 10:00 | No |
| 2026-10-21 | 11:32 | 10:00 | No |
| 2026-10-22 | 11:34 | 10:00 | No |
| 2026-10-23 | 11:32 | 10:00 | No |
| 2026-10-24 | 11:29 | 10:00 | No |
| 2026-10-25 | 12:17 | 11:00 | No |
| 2026-10-26 | 11:38 | 11:00 | No |
| 2026-10-27 | 11:49 | 11:00 | No |
| 2026-10-28 | 11:33 | 11:00 | No |
| 2026-10-29 | 11:33 | 11:00 | No |
| 2026-10-30 | 12:06 | 11:00 | No |
| 2026-10-31 | 11:34 | 11:00 | No |
| 2026-11-01 | 12:33 | 11:00 | No |
| 2026-11-02 | 12:43 | 11:00 | No |
| 2026-11-03 | 13:32 | 11:00 | No |
| 2026-11-04 | 13:13 | 11:00 | No |
| 2026-11-05 | 12:38 | 11:00 | No |
| 2026-11-06 | 13:16 | 11:00 | No |
| 2026-11-07 | 12:32 | 11:00 | No |
| 2026-11-08 | 12:36 | 11:00 | No |
| 2026-11-09 | 16:31 | 11:00 | No |
| 2026-11-10 | 12:58 | 11:00 | No |
| 2026-11-11 | 12:36 | 11:00 | No |

- The previous night's games are complete in the first refresh (T3): about 8.5 hours after the last tip-off on 2026-11-11.
- **A task at 12:00 Paris time never saw the previous night in the 23 days measured**; it would ingest each night a day late. The producer's workflow is scheduled at 07:00 UTC ([daily_nba.yml](https://github.com/sportsdataverse/hoopR-nba-data/blob/main/.github/workflows/daily_nba.yml)); the files appeared four and a half to six and a half hours later on 22 of the 23 days, nine and a half hours later on the other.
- Adopted by ruling CL-TRV-23 on this measure: the daily statistics update starts at 15:00 in the owner's time zone (Paris by default), which was after the first refresh on 22 of the 23 days; from then it probes the source's refresh instant every 60 minutes and fetches as soon as the source has refreshed after the last scheduled tip-off of the past competition day plus the STA-32 delay; at the 20:00 cut-off it fetches what is published and ends "source late", and after 2 consecutive late competition days the "statistics source unavailable" incident opens. With the hourly probe the run would have started after the day's first refresh on all 23 days.
- The producer workflow runs from 18 October to 12 July (cron entries in the same file): in the off-season the files are not refreshed. When the next season's schedule appears in the files was not observable on 2026-11-11.

## 10. Rules the adapter must apply

1. Read files by their documented direct address; follow the redirect; never use the REST API at run time (60 requests an hour per address unauthenticated, [GitHub docs](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api), and serverless hosts share addresses).
2. Send conditional requests with the stored `ETag`; a 304 means nothing changed.
3. Assign each game's season from its date and the season start dates, not from the file; deduplicate by game id (T14). A game's day is the Eastern date of `date` (CL-TRV-03, T21); no venue time zone is used.
4. Exclude the All-Star games and the NBA Cup final by label and team ids; keep NBA Cup group and knockout games, which count (T5).
5. Treat `time_valid` false as "time to be determined" and teams "TBD" as placeholders (T2).
6. Parse booleans without regard to case (T6); drop the did-not-play `reason` (T6).
7. Mark minutes as whole minutes; never fill a missing value with zero; a line with stats and no minutes is incomplete (STA-10, T4).
8. Return `ejected` as unknown, not false, while the field is never set (T6).
9. Link a make-up game to its postponed original by teams and the "Makeup from" label (T19).
10. Take team history from box-score lines, not from past-season player files (T16); return only the month and day of a birth date, read from the date part of `date_of_birth` as written (its time is always 07:00 or 08:00 UTC, midnight on the US Pacific coast, so no zone conversion applies).
11. Validate every file against the expected columns before use; a missing or renamed column stops ingestion of that file and raises a schema incident.

## 11. What stays uncovered and what the app shows

| Gap | Effect | What the app shows |
| --- | --- | --- |
| Seconds of playing time | Index computed on whole minutes | "minutes arrondies" on every sheet (STA-12) |
| Ejections | SEN-16 never flags an ejection | Nothing is invented; the case detail can say the source does not report ejections |
| Seasons before 1993-94 | None for current players (T20) | Any case there: non mesurable, "saison non couverte par la source" (STA-45), and the profile says so |
| Missing games (section 8) | Those sheets are unavailable | "feuille indisponible" (STA-35); the reference turns "partielle" only above 20 % (STA-24) |
| Off-season refreshes | No new data from mid-July to mid-October | Next game: "aucun match prévu" with "intersaison" or "calendrier non publié" (STA-26) |

## 12. Adapter mapping to the `stats-source` port

The port's interface (operations, call context, outcome with call metadata, errors, what the fake simulates) is set by the [module map, section 5, `stats-source`](module-map.md#stats-source-lot-1). This section gives what the adapter for the chosen source must map: for each port field, the source field and the conversion. No file, column or provider name crosses the port.

Conventions:

- Instants cross the port as epoch milliseconds. The schedule's `date` values (`2026-11-11T00:30Z`) are UTC and convert directly; HTTP `Last-Modified` headers (`Wed, 11 Nov 2026 12:33:36 GMT`) are parsed as GMT.
- Calendar dates cross the port as `YYYY-MM-DD` strings; a game's day is its US Eastern date (CL-TRV-03, T21).
- File names carry the season's ending year `{Y}`: `2027` is the 2026-27 season.
- Identifiers stay strings: `game_id`, `athlete_id`, `team_id`.
- Counts such as `5` or `5.0` become integers; an empty value or `NA` becomes null, never 0 (STA-10). Booleans are read without regard to case (T6).
- Every file is checked against its expected header before any row is mapped (section 10, rule 11), and every fetch is conditional on the stored `ETag`: a 304 answers `notModified`.

### Files read by each operation

| Port operation | Files read | Requests |
| --- | --- | --- |
| `checkHealth` | `espn_nba_player_boxscores/timestamp.json` | 1 conditional |
| `getPublication` | The same `timestamp.json`, 43 bytes | 1 conditional |
| `getSeasonGames` | `nba_schedule_{Y}.csv` | 1 conditional |
| `getSeasonLines` | `player_box_{Y}.csv` | 1 conditional |
| `getSeasonPlayers` | `player_box_{Y}.csv` | The download of `getSeasonLines` when both are asked in one call context, else 1 conditional |
| `getPlayerProfiles` | `player_core_{Y}.csv` of the current season; an earlier season's file only for a requested player the current one does not list | 1, plus 1 per earlier season needed |
| `mapPlayers` | `nba_crosswalk/nba_player_crosswalk_{Y}.csv` | 1 |

### `getPublication`

| Port field | Source field | Conversion |
| --- | --- | --- |
| Last refresh instant | `Last-Modified` header of `timestamp.json` | GMT date to epoch milliseconds; the body (`{"last_updated":"2026-11-11 07:33:33 EST"}`) is a fallback read in `America/New_York` |
| Version | `ETag` of `timestamp.json` | As is; a 304 answers `notModified` |

### `getSeasonGames` (`nba_schedule_{Y}.csv`): games

| Port field | Source field | Conversion |
| --- | --- | --- |
| Game id | `game_id` (equal to `id` in every row, T21) | String |
| Season | `{Y}` of the file | Corrected from the game's day against the season start dates; repeated game ids are kept once (T14) |
| Phase | `season_type` | 2 regular season, 5 play-in, 3 playoffs |
| Exclusion | `type_abbreviation`, `home_id`, `away_id`, `home_abbreviation`, `away_abbreviation` | `ALLSTAR` or a team id outside 1 to 30: All-Star; `CC`: NBA Cup final; abbreviation `TBD`: placeholder |
| Tip-off instant | `date`, for example `2026-11-11T00:30Z` | UTC to epoch milliseconds; cross-checked with `game_date_time` (`2026-11-10T19:30:00.000000-0500`) |
| Time known | `time_valid` | Boolean; false means "time to be determined", and `date` then holds midnight US Eastern as a placeholder (T2) |
| The game's day (league date) | `game_date` | `YYYY-MM-DD` as is; it equals the `America/New_York` date of `date` in every row (T21), and a row where it does not is `schema_changed` |
| Home and away team ids | `home_id`, `away_id` | Strings; null for placeholders |
| Neutral site | `neutral_site` | Boolean |
| Status | `status_type_name` | `STATUS_SCHEDULED` scheduled, `STATUS_FINAL` final, `STATUS_POSTPONED` postponed, the only values observed (T2, T5); a canceled or in-progress game was never seen, so any other value is `schema_changed` until it is mapped |
| Score | `home_score`, `away_score` | Integers for a final game, else null |
| Overtimes | `status_period`, `format_regulation_periods` | Final period minus 4 for a final game with 4 regulation periods (CL-STA-03, T11), else null |
| Series round | `type_abbreviation`, `notes_headline` | `RD16` first round, `QTR` conference semifinals, `SEMI` conference finals, `FINAL` finals, from 2003-04; play-in type from the label; null before 2003-04 (T19) |
| Series game number | `notes_headline` | The number after "Game", from 2008-09 (and 76 of 86 playoff games of 2007-08); else null (T19) |
| Make-up link | `notes_headline` "Makeup from" a date, on the make-up row | The postponed game of the same two teams on that date (T19) |

### `getSeasonGames`: teams and coverage

| Port field | Source field | Conversion |
| --- | --- | --- |
| Team id, stable across relocations | `home_id`, `away_id` | String; franchise ids 1 to 30 only, so All-Star teams are left out. The id follows a franchise that moves or is renamed (T22) |
| Team name, abbreviation and location that season | `home_name`, `home_abbreviation`, `home_location` and the same `away_` columns | As written in that season's file, which keeps the names of the time (T22) |
| Phases held with lines | `season_type` of final, counted games whose `player_box` flag is true | The set of phases |
| Final, counted games listed without lines | `game_id` of final, counted games whose `player_box` flag is false | Game ids (T15) |

### `getSeasonLines` (`player_box_{Y}.csv`)

| Port field | Source field | Conversion |
| --- | --- | --- |
| Game, player, team, opponent | `game_id`, `athlete_id`, `team_id`, `opponent_team_id` | Strings |
| At home | `home_away` | `home` is true |
| Did not play | `did_not_play` | Boolean; the `reason` column is never read (JOU-21, DSN-15) |
| Minutes and their precision | `minutes`, for example `26.0` | Number with the precision "whole minutes"; empty or `NA` becomes null |
| The thirteen counts | `points`, `field_goals_made`, `field_goals_attempted`, `three_point_field_goals_made`, `free_throws_made`, `free_throws_attempted`, `offensive_rebounds`, `defensive_rebounds`, `assists`, `steals`, `blocks`, `turnovers`, `fouls` | Integers; empty or `NA` becomes null |
| Ejection | `ejected` | Always unknown (null): never set in the files (T6) |
| Players requested | `athlete_id` | Only the requested players' rows are returned |

### `getSeasonPlayers` (`player_box_{Y}.csv`): the season's player directory

| Port field | Source field | Conversion |
| --- | --- | --- |
| Player id | `athlete_id` | String; one entry per player with at least one line in a game between two franchises (All-Star lines skipped) |
| Names as the source gives them | `athlete_display_name`, `athlete_short_name` | As written; the full, first and last names exist only in the player file, which the directory does not read |
| Each team with its first and last game day | `team_id` and `game_date` of each of the player's lines, did-not-play lines included | Per team, the earliest and latest `game_date`; whether he played for that team is in his lines, not in the directory |

### `getPlayerProfiles` (`player_core_{Y}.csv`)

| Port field | Source field | Conversion |
| --- | --- | --- |
| Player id | `athlete_id` | String |
| Display name | `display_name` | As written |
| Current team | `current_team_id` in the current season's file | String; empty, or a player the current season's file does not list, becomes null (no team, STA-26) |
| Day and month of birth | `date_of_birth`, written `YYYY-MM-DDT07:00Z` or `YYYY-MM-DDT08:00Z` | Month and day from the date part as written (midnight on the US Pacific coast); the year is dropped |

### `mapPlayers`

| Port field | Source field | Conversion |
| --- | --- | --- |
| The player's id in the other source | `espn_athlete_id` to `nba_player_id` in `nba_player_crosswalk_{Y}.csv` | Rows whose `match_method` is not `unmatched`; files exist for the seasons ending 2002 to 2027 (T1), so seasons before 2001-02 have no mapping |

### Answers, errors and call metadata

| Source answer | Port result |
| --- | --- |
| HTTP 304 to a conditional request | Not an error: `notModified` |
| Network error, timeout, HTTP 5xx, unreadable file | `unavailable` |
| HTTP 429, or 403 with rate-limit headers | `rate_limited`, with the `Retry-After` delay when given |
| HTTP 404 for a season file | `not_published`: a past season is not covered; for the current season, the incident of CL-STA-15 |
| A requested player id absent from every file read | `not_found` |
| A header that differs from the expected columns, a status value not yet mapped, or a `game_date` that disagrees with `date` | `schema_changed` |
| The abort signal | `aborted` |

Call metadata counts each HTTP request, the redirect included, and the bytes received. One file is one page: the cursor is never needed, since a season fetches and parses in under 2.5 seconds (T12).

**Never produced by this source**, which the adapter's tests assert: the preseason exclusion (no preseason game is in the files, T4); `unauthorized` (no key); an ejection (always unknown, T6). Null for part of the history: the series round before 2003-04 and the series game number before 2008-09 (T19), which `games` derives from the results; a player mapping for seasons before 2001-02.

### Cost, checked against the module map's figures

- Reading every season's directory once, at installation, means every box-score file: 507.4 MB in CSV for the 34 seasons on 2026-11-11 (T1), which confirms the map's "about 510 MB". The current season's file grows from 2.2 MB to about 18 MB by June (the 2025-26 file is 17.7 MB, T5), so the total approaches 523 MB at the end of the season.
- The 34 schedule files are 57.3 MB (T1), as the map says, about 63.5 MB at the end of the season (the current file grows from 3.0 MB to about 9.2 MB). The player files, which only `getPlayerProfiles` reads, are 4.9 MB for all 34 seasons, and 0.16 MB for the current one (T1, T2).
- Installation therefore downloads 68 files and about 565 MB, which is 34 % of the 200 downloads and 28 % of the 2 GB of Egoscope's daily ceilings (CL-STA-15), within one day and with the 10 % reserve of STA-39 untouched. At under 2.5 seconds per file (T12), that is about three minutes of function time, spread over invocations. In Parquet the same files are 24.2 MB (T1).
- A daily update reads the current season's schedule and box-score files, conditionally: about 5 MB on 2026-11-11 (T2), about 27 MB at the end of a season with the player file (T5, T16).

## 13. Recorded fixtures

Recorded source files used as test fixtures (in `data/fixtures/stats-source/recorded/`, module map section 5) are anonymized before they are committed, because the repository is public and carries no real player name ([decision record 0006](../adr/0006-public-specs-without-license-or-real-players.md)). The rules, which the adapter task can script:

- Player names become invented names; team-staff names would too, but none of the files below carries any.
- Player identifiers are remapped consistently: one table maps each real `athlete_id` to an invented id and is applied to every file and every derived column, so joins between files still work. Other providers' ids in the crosswalk get one table per provider.
- Real team names, team ids, game ids, dates, venues and box-score numbers may stay.
- Free text that names people or gives the cause of an absence is blanked, and so are personal columns the adapter does not read.
- Columns are blanked, never removed, so headers stay identical to the source's and the schema checks still run on the fixtures.
- A last step scans every fixture for the real names collected from the original player and crosswalk files, and for headshot addresses, and fails on any match.

| File | Column | What it carries | Action |
| --- | --- | --- | --- |
| `player_box_{Y}.csv` | `athlete_id` | Player id | Remap |
| `player_box_{Y}.csv` | `athlete_display_name` | Full name | Invented full name |
| `player_box_{Y}.csv` | `athlete_short_name` | Initial and last name | Built from the invented name |
| `player_box_{Y}.csv` | `athlete_headshot_href` | Photo address ending with the player id | Blank |
| `player_box_{Y}.csv` | `reason` | Did-not-play cause, sometimes naming a person | Blank |
| `nba_schedule_{Y}.csv` | `highlights` | Video headlines and descriptions that name players (1,324 of the 1,330 rows of 2025-26 contain a player's last name) | `[]` |
| `player_core_{Y}.csv` | `athlete_id` | Player id | The same remap |
| `player_core_{Y}.csv` | `uid` | `s:40~l:46~a:` followed by the player id | Rebuilt with the invented id |
| `player_core_{Y}.csv` | `guid` | 36-character identifier of the player | New random value per invented id |
| `player_core_{Y}.csv` | `slug` | Name in kebab-case | Built from the invented name |
| `player_core_{Y}.csv` | `first_name`, `last_name`, `full_name`, `display_name`, `short_name` | Names | Invented, the same as in the player-box files |
| `player_core_{Y}.csv` | `headshot_href` | Photo address ending with the player id | Blank |
| `player_core_{Y}.csv` | `date_of_birth`, `age` | Birth date and age | Invented date in the same form (`YYYY-MM-DDT07:00Z`), chosen by the scenario; age recomputed |
| `player_core_{Y}.csv` | `birth_city`, `birth_state`, `birth_country`, `college_id`, `height`, `display_height`, `weight`, `display_weight` | Personal data the adapter does not read | Blank |
| `nba_player_crosswalk_{Y}.csv` | `espn_athlete_id` | Player id | The same remap |
| `nba_player_crosswalk_{Y}.csv` | `nba_player_id`, `fox_athlete_id`, `yahoo_player_id` | Other providers' player ids | One remap table per provider |
| `nba_player_crosswalk_{Y}.csv` | `player_name`, `espn_full_name`, `nba_player_name`, `fox_player`, `yahoo_player_name` | Names | The invented full name |
| `nba_schedule_crosswalk_{Y}.csv`, `nba_team_crosswalk_{Y}.csv`, `timestamp.json` | None | No person data | Unchanged |

All other columns of these files (team, venue and broadcaster names, ids of games and teams, dates, labels, counts, jersey numbers, positions, draft and status fields) stay as recorded.

## 14. Follow-ups for implementation

- Write the series-length table per season and the play-in elimination rules, and test them against the labeled seasons (T19).
- Script the fixture anonymization of section 13, with its final check, before the first recorded fixture is committed.
- Consider Parquet for the player-box files, about 25 times smaller than their CSV (20.0 MB against 507 MB for the 34 seasons, T1), with a pure-JavaScript reader; only CSV was tested (T12). Stream the CSV to keep memory low.
- Re-check this evaluation before each deployment and at any source incident (TRV-10).
