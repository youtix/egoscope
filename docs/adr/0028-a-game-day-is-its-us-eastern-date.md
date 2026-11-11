# 0028. A game's day is its US Eastern date

- Status: Accepted
- Date: 2026-11-11
- Decided by: the orchestrator (planning ruling), recorded in CL-TRV-03, CL-STA-14 and CL-TRV-02

## Context

- TRV-72 and H-TRV-11: the day of a game is its US date, without saying which US time zone. SEN-02 and H-SEN-02 measure an event known in advance on the first game whose local date at the venue is the event's date or later; record 0015 matches birthdays the same way. STA-31 deems a game whose time is not yet set to start at the beginning of its day, local time at the venue. TRV-71 shows a game's US date and its local time.
- The statistics source ([0023](0023-statistics-source-sportsdataverse-releases.md)) gives each game's tip-off instant and the league's date, but no venue time zone. Its game date equals the US Eastern date of the tip-off instant in every one of the 43,562 schedule rows checked, the 31 games played in Europe and Mexico City included (evaluation, test T21).

## Decision

- A game's day, for every rule and every display, is the calendar date of its scheduled start in US Eastern time (`America/New_York`), the date the league's schedule uses, games played abroad included.
- Rules that speak of the local date at the venue — SEN-02, STA-31, the birthday games of [0015](0015-calendar-derived-event-types.md) — use that date. No venue time zone is stored, looked up or tabulated.
- A game whose time is to be determined keeps its date and the mark "time TBD", and is deemed to start at 00:00 US Eastern time on that date for every comparison; screens show the date with "time TBD", never 00:00.

## Consequences

- One date, computable from the tip-off instant. It is the competition day of STA-32, the US date recalled on screens and in messages ([0010](0010-english-product.md), amendment), and the day birthday games are matched on.
- The venue's local time is never shown (CL-TRV-02).
- For a type known in advance that is not calendar-derived, SEN-02 counts from the event's date to the first game the player played on that day or later, within the SEN-04 window (CL-SEN-04).
- H-STA-11 and H-SEN-02 are read through this record.

## What would change it

- Official games scheduled where the venue's local date differs from the Eastern date of the tip-off — a morning game in East Asia, for example, which is the previous evening in New York: a venue time-zone table would then be needed for the rules that speak of the local date.
