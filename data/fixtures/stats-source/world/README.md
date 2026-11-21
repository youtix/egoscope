# The invented league of the statistics-source fake

`scenario.json` is written by hand: it describes a small invented league, and the fake of the
statistics source (`src/lib/stats-source/fake.ts`) generates every game, box score, player
directory and player file from it when it starts (`fake-scenario.ts`, `fake-schedule.ts` and
`fake-world.ts`). Every team and player is invented.

What it holds:

- Six teams; team `6` moves from Seaport to Ridgeview in 2025-26 and keeps its id.
- Four seasons. 2023-24 has a schedule and no box score: a season the source does not cover,
  before the first covered one, 2024-25. 2024-25 gives whole minutes, the others minutes and
  seconds. 2024-25 and 2025-26 end with a play-in game and three series; 2026-27 is in progress,
  played before 8 November 2026.
- Each regular season is a double round robin, a round every three days, tip-off at 19:30 US
  Eastern. The `games` entries name the games that differ: overtimes, a game abroad at 14:00 US
  Eastern, a final game without box scores, a time to be determined, a postponed game and its
  make-up, a row whose status value is not recognized (held back).
- Ten players: two namesakes (`p02` and `p03`), a trade within 2025-26 (`p02`, which brings a
  game against his former team), a player who retired after 2024-25 (`p06`), a rookie of 2026-27
  without a birthday (`p07`), a release in 2026-27 (`p08`, with two did-not-play games), and a
  birthday (`p01`, 26 October) on a game day of his team.
- The box scores take the five `lines` in turn, and the final scores the six `scores`.

An entry that names a game uses the fake's game ids: `<season>:r<round>:h<home team>` for the
regular season, `<season>:pi` for the play-in, `<season>:s<series>g<game>` for the series.
Change the scenario, then run `bun run test src/lib/stats-source`: the fake's tests pin what the
league holds.
