# 0018. Encrypted weekly backups outside the database

- Status: Accepted
- Date: 2026-11-11

## Context

[14](../14-exigences-transverses.md) sets the backup rules:

- TRV-50: a full backup every week, kept outside the database service (Q-TRV-01); the last eight are kept (configurable); each backup is logged and a failure opens an incident. A withdrawn event leaves the backups as they are replaced (DSN-28).
- TRV-51: the backup holds everything needed to rebuild the application identically, but no value of the deployment configuration and no pasted text. TRV-53: a backup or a full export can be restored into an empty database, following the documentation, without programming. TRV-55: a backup precedes every update that changes the data structure. TRV-56: backups and exports are meant for the owner alone and reachable only after login.
- H-TRV-09: Monday at 05:00 Paris time, eight kept, an export reminder after 30 days without an export (TRV-54).
- Q-TRV-01: a free, private space outside the database may not exist. Should the application then rely on manual exports with regular reminders, or accept an extra service dedicated to backups?

## Decision

Automatic weekly backups, encrypted with a key from the deployment configuration, are sent to a private space on the owner's GitHub account, or to the host's free file storage if that checks out better. The owner creates one access token at the end and keeps the key: no key, no restore.

## Consequences

- TRV-50 to TRV-55 and H-TRV-09 apply as written, with encryption added. The storage chosen is documented in a service sheet ([0011](0011-choosing-the-remaining-services.md)).
- Backups use authenticated encryption with the key from the deployment configuration. Neither the key nor the access token ever goes into a backup, a screen, the log or an export (TRV-51, TRV-64).
- Rotation must really delete the oldest backup. Storing backups as commits in a git history would keep them for good and break TRV-50 and DSN-28; the chosen space must allow true deletion.
- A restore (TRV-53, TRV-77) asks for the key. The guide warns that a lost key makes every backup unreadable; manual exports (TRV-52) are unaffected and stay readable without the application.
- TRV-56 is read as "never public": off-site backups sit in the owner's private storage and can only be read with both that account and the key.
- The deployment configuration gains the key and the token (TRV-37; TRV-75 steps 3, 5 and 13); the installation check covers the backup storage like any service (TRV-47).

## Alternatives considered

From Q-TRV-01:

- Manual exports only, with the reminders of TRV-54. Not retained.
- The host's free file storage. Kept as the alternative the decision names, if it checks out better.
