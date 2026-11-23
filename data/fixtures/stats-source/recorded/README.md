# The recorded release of the SportsDataverse adapter

These files are rows of the SportsDataverse hoopR NBA release (compiled from ESPN, licensed CC BY
4.0), downloaded from the addresses that `docs/services/statistics-source.md` documents and
anonymized by the rules of the statistics-source evaluation, section 13. Every player id and name
is invented. The tests of the adapter (`src/lib/stats-source/sportsdataverse*.test.ts`) serve them
from a local replay of the release (`sportsdataverse-replay.ts`), so that no test reaches the
network. Each file keeps its release name, in kebab case, and every column of the original.

What they hold:

- 1993-94, the first covered season: the games and box scores of 7 November 1993.
- 2001-02: the playoffs, with their two three-game series.
- 2024-25: the box scores of 17 December 2024, 16 February 2025 and 8 March 2025; the schedule of
  those days and of 14 March 2025 (the change to daylight time lies between), the NBA Cup final,
  the All-Star games, the play-in and the playoffs, the postponed games and their make-ups, and the
  games at neutral sites.
- 2026-27, the season in progress: the box scores of 21 November 2026 and every game of its first
  traded player; the schedule of 21 and 22 November 2026, its placeholders, its times to be
  determined and its games at neutral sites.
- The player files of 2024-25, 2025-26 and 2026-27, and the 2024-25 player crosswalk, for the
  players of the kept box scores; `timestamp.json`, the release's refresh time.

To refresh them, download the original files into a new, empty folder outside the repository
(they hold real names), then run
`bun scripts/anonymize-stats-source-fixtures.ts <that folder>`. The script rewrites the files of this
folder, and its last step scans what it wrote for real names and headshot addresses: on any match, it
removes every file it wrote and fails. Then run `bun run test src/lib/stats-source`, whose tests
pin what the recording holds, and delete the originals.
