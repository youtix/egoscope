# 0006. Public specs, no license, no real players

- Status: Accepted
- Date: 2026-11-11

## Context

- D-02: a personal tool, for one user, with no diffusion or commercialization planned. Document [13](../13-donnees-sensibles.md) ends with the points to review "si l'outil était un jour ouvert à d'autres personnes, publié ou commercialisé": personal-data law, profiling of real people, defamation, rights on press content, service terms, access security, notifications, betting.
- The specs already use invented players (« le joueur A »), teams (« l'équipe X ») and `.example` addresses ([05](../05-demande-de-backtest-et-prompt.md) full example, TAX-03, H-TAX-02).

## Decision

- The specs are published in the public repository; the owner's first name was removed from them before the first commit.
- No license file: all rights reserved.
- No real NBA player name ships in the repository; tests and fixtures use invented players.

## Consequences

- The tool itself stays personal and single-user (D-02, DSN-30); only its code and specs are public. The repository holds no real player name and no event data, so the review list that closes document 13 is not triggered.
- Fixtures, seeds, examples and screenshots use invented players and `.example` addresses; the rule of TAX-03 (an example names no real person) extends to all repository content. The decision binds player names; the specs' style for teams ("Team X") is the default for fixtures.
- No file names the owner or gives a personal e-mail address.
- Secrets never reach the repository (TRV-64); the deployment configuration is documented by an example file with placeholder values ([0003](0003-public-repository-and-pull-request-workflow.md)).
- TRV-75 step 2 points to the public repository.
