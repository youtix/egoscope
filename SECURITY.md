# Security policy

Egoscope is a personal, single-user application. Its source code is public; its data lives only in
one private deployment, never in this repository.

## Reporting a vulnerability

Report vulnerabilities privately, through GitHub's private vulnerability reporting: open the
**Security** tab of this repository and choose **Report a vulnerability**. Please do not open a
public issue, pull request or discussion about a security problem.

Describe what you found, how to reproduce it and what an attacker could do with it. Reports are
answered as soon as possible. There is no bug bounty.

## Scope

- The application code on `main`, its build and its GitHub Actions workflows.
- Any secret committed to the repository by mistake: report it, and it will be revoked and
  replaced.

The third-party services the application relies on (hosting, database, Telegram, data sources)
have their own security policies.

## Supported versions

Only the latest commit on `main` is supported.
