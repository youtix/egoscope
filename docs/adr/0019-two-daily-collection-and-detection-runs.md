# 0019. Two collection-and-detection runs a day

- Status: Accepted
- Date: 2026-11-11

## Context

- D-15: a daily scheduled scan. TRV-38: the daily frequency of collection and detection is fixed; only the hour is a setting.
- COL-12 ([03](../03-collecte-des-actualites.md)): collection runs every day at a configurable hour in the owner's time zone, by default 22:00 Paris time (H-COL-01); the setting accepts several hours a day, one by default. COL-16: detection follows each collection in the same run. H-COL-01 notes that afternoon games, on weekends and US holidays, can start before a 22:00 run. TRV-25 repeats the default in the task calendar.
- Q-SUI-02 ([10](../10-suivi-automatique-et-validation.md)): the hour of the scan sets the share of tracked cases recorded before tip-off (SUI-06). Should detection run before the North American evening games, maybe twice a day, subject to quotas?

## Decision

Two collection-and-detection runs a day by default, at 16:30 and 23:00 Paris time. The setting accepts several hours (COL-12) and can be changed in the settings.

## Consequences

- The defaults of COL-12, H-COL-01 and TRV-25 change. Each run is one « passage » (TRV-26), whose messages are grouped (TEL-19).
- The application's own scheduler keeps the hours ([0002](0002-free-hosting-on-vercel-and-neon-with-an-external-trigger.md)), in the owner's time zone and across clock changes (TRV-27); the announcement made when the owner changes time zone names both hours (CA-TRV-40).
- Classification volume stays about the same, since each article is classified once (DET-12), while feeds are read twice as often; the volume estimates of H-TRV-04 remain daily figures.
- The 23:00 run falls inside the default quiet hours (TEL-20, 23:00 to 08:00): its messages about games that start before 08:00 go out as urgent (TEL-21); the others wait until 08:00.

## Alternatives considered

- One run at 22:00 Paris time, the default of H-COL-01. Not retained.

## See also

- [0023](0023-statistics-source-sportsdataverse-releases.md): the daily statistics update starts at 15:00 and waits for the source until 20:00.
- [0025](0025-database-compute-budget-shapes-the-scheduler.md): the scheduler never assumes a 5-minute cadence.
