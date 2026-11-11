# Backup storage: release assets in a private GitHub repository

| Item         | Value                                                                            |
| ------------ | -------------------------------------------------------------------------------- |
| Role         | Keeps the encrypted backups outside the database service (TRV-50, Q-TRV-01)      |
| Decision     | One draft release in a separate private repository of the owner's GitHub account |
| Runner-up    | A private Vercel Blob store on Hobby                                             |
| Date checked | 2026-11-11                                                                       |

## Role

At the configured day and time (Monday at 05:00, Paris time, by default; the parameter also allows
every day), the application exports its whole database (TRV-51), compresses and encrypts the archive
with a key from the deployment configuration, uploads it, then deletes every backup beyond the
configured number to keep, 8 by default (TRV-50, H-TRV-09). Manual backups and the backup taken
before a schema change count in the same number (ruling CL-TRV-04). A withdrawn fact leaves the
backups when the last backup that held it rotates out; the horizon is the number of backups kept
times the backup interval, eight weeks with the defaults (ruling CL-DSN-07, DSN-28). Deletion must
therefore really remove the file. The owner chose a private space on their GitHub account, or the
host's free file storage if that checked out better; GitHub checks out better (see "Replaceable
by").

## Plan and cost

GitHub Free, which the owner already has: it includes unlimited private repositories
([GitHub's plans](https://docs.github.com/en/get-started/learning-about-github/githubs-plans)), and
releases cost nothing on it. No card, no trial.

## Account needed

None new: the owner's existing GitHub account. The owner creates:

1. A new **private** repository for backups only, for example `egoscope-backups`, initialized with a
   README so that it has a first commit. Never use the public code repository.
2. A **fine-grained personal access token** limited to that one repository (details below).

## Limits

| Limit                    | Value                                                                 | Source                                                                                                                                                                                                                                                                     |
| ------------------------ | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File size                | Each release file under 2 GiB                                         | [About releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)                                                                                                                                                                      |
| Files per release        | Up to 1,000 assets                                                    | [About releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)                                                                                                                                                                      |
| Total size and bandwidth | No limit                                                              | [About releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)                                                                                                                                                                      |
| REST API                 | 5,000 requests an hour for an authenticated user                      | [REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)                                                                                                                                                                        |
| Fine-grained tokens      | Expiration from 1 to 366 days, or none; revoked after one year unused | [Managing tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens), [Token expiration](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/token-expiration-and-revocation) |

## Our expected use and the margin

| Resource     | Expected use                                                                                                 | Limit                | Margin              |
| ------------ | ------------------------------------------------------------------------------------------------------------ | -------------------- | ------------------- |
| Backup file  | Compressed and encrypted export of a database of at most 100 MB: well under 100 MB, realistically 5 to 50 MB | Under 2 GiB per file | >95%                |
| Backups kept | The configured number N (`backups.kept`, 8 by default), all kinds counted together, in one draft release     | 1,000 per release    | >99% at the default |
| Storage      | N times the backup size: 400 MB with the defaults (8 × 50 MB); it grows in proportion if N is raised         | No limit             | n/a                 |
| API calls    | About 5 per backup (privacy check, upload, list, delete, list again)                                         | 5,000 an hour        | >99%                |

The 2 GiB limit applies to each file and does not depend on how many backups are kept. The upload is
one outbound request from a Vercel Function: it is not bound by the 4.5 MB limit on requests the
function receives ([Functions limitations](https://vercel.com/docs/functions/limitations)), and
50 MB fits easily in the 2 GB of memory and the 300 seconds of a Hobby function.

## Terms on personal use and automated access

- **Size and bandwidth**: "There is no limit on the total size of a release, nor bandwidth usage."
  ([About releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases),
  "Storage and bandwidth quotas").
- **Purpose**: GitHub presents releases as a way to package software for others to download; no
  clause of the Terms of Service, the Acceptable Use Policies or the additional product terms forbids
  keeping an application's own backup files as release assets in a private repository. The
  Acceptable Use Policies only target bandwidth far above that of similar users
  ([Acceptable Use Policies](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies),
  section 9), which a weekly 50 MB upload is not. This is a reasonable use, not an explicitly blessed
  one: recorded as a risk.
- **Automated access**: the REST API is meant for programs; abusive or excessive use can lead to
  suspension of API access ([Terms of Service](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service)).
- **Confidentiality**: GitHub treats the content of private repositories as confidential and
  accesses it only for security, support, integrity, legal reasons or with consent
  ([Terms of Service](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service),
  section E). The files are encrypted before upload anyway.

## Inactivity policy

- **Account**: no clause deletes an inactive GitHub account; GitHub does not release usernames just
  because they look inactive ([Username policy](https://docs.github.com/en/site-policy/other-site-policies/github-username-policy)).
- **Token**: GitHub automatically revokes a personal access token that has not been used for one
  year ([Token expiration and revocation](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/token-expiration-and-revocation));
  every backup uses it, at least once a week with the defaults.

## Data we send

Only ciphertext: the full export (TRV-51), compressed then encrypted with AES-256-GCM under
`BACKUP_ENCRYPTION_KEY`. GitHub sees the file names (the UTC creation instant and the backup's
kind), their sizes and their upload dates, nothing else. The backup holds no deployment secret and
never the text pasted at import (TRV-51, DSN-32).

## Availability in France

Available; GitHub has no country restriction relevant here. The storage location of release files is
not published.

## How it is called

Plain HTTPS with `fetch`. Every call sends `Authorization: Bearer <BACKUP_GITHUB_TOKEN>`,
`Accept: application/vnd.github+json` and `X-GitHub-Api-Version: 2026-03-10`
([API versions](https://docs.github.com/en/rest/about-the-rest-api/api-versions)).

1. **Once**: create a draft release, `POST https://api.github.com/repos/{owner}/{repo}/releases` with
   `{"tag_name": "backups", "name": "backups", "draft": true}`, and keep its `id`. Draft releases are
   listed only to users with push access ([Releases API](https://docs.github.com/en/rest/releases/releases)).
   A draft is used because, if immutable releases are ever switched on, the assets of a published
   release can no longer be deleted ([Immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases));
   leave that setting off in the backup repository.
2. **Each backup**: first check that the repository is still private: the repository's own
   endpoint, `GET https://api.github.com/repos/{owner}/{repo}`, must answer `"private": true`;
   otherwise upload nothing and open "backup failed" (CL-TRV-04). Then
   `POST https://uploads.github.com/repos/{owner}/{repo}/releases/{release_id}/assets?name=backup-<UTC instant>-<kind>.enc`,
   for example `backup-2026-11-16T0400Z-weekly.enc`, with `Content-Type: application/octet-stream`
   and the encrypted bytes as the body; expect `201` with `state: "uploaded"` and the right `size`. A
   `422` means the name exists; a `502` can leave an empty asset in state `starter`, which is deleted
   before retrying ([Release assets API](https://docs.github.com/en/rest/releases/assets)). Names use
   only letters, digits, `.`, `_` and `-`, and hold only the creation instant and the kind (weekly,
   manual, before an update).
3. **Rotate**: list the assets (`GET .../releases/{release_id}/assets?per_page=100`, paging when
   more than 100 are kept), sort them by `created_at`, keep the newest N (`backups.kept`), all kinds
   counted together, and delete an asset only when it is beyond that count:
   `DELETE https://api.github.com/repos/{owner}/{repo}/releases/assets/{asset_id}` (expect `204`).
   Then confirm that the asset no longer appears in a new listing and that reading it by id answers
   `404` (CL-TRV-04). A failed or unverified deletion opens "backup failed" and the asset stays in the
   application's backup register as still stored; the next rotation, or the daily purge, tries again.
   There is **no fixed age limit**: one would silently cut a retention the owner has raised. When
   backups fail for some weeks, the older ones stay until rotation resumes, and the fingerprints of
   withdrawn events live as long as a backup made before them is still listed (CL-DSN-07).
4. **Restore**: `GET https://api.github.com/repos/{owner}/{repo}/releases/assets/{asset_id}` with
   `Accept: application/octet-stream`, following a `302` redirect; decrypt with the key and restore
   into an empty database (TRV-53).

Each step is logged; a failure opens an incident (TRV-50). The installation check writes a test
object, reads it back, decrypts it, deletes it, verifies that it is gone and checks that the
repository is private (TRV-47, CL-TRV-04).

### Token and permission

A fine-grained personal access token (generally available since 2025-03-18,
[changelog](https://github.blog/changelog/2025-03-18-fine-grained-pats-are-now-generally-available/)):

- **Resource owner**: the owner's account. **Repository access**: Only select repositories, then the
  backup repository alone.
- **Repository permissions**: Contents, Read and write. Creating or deleting a release and deleting
  an asset need Contents write; listing needs Contents read
  ([Permissions for fine-grained tokens](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens),
  "Contents"). Metadata, read-only, is always included.
- **Expiration**: no expiration is allowed for a personal account
  ([Managing tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)).
  Choose it, or one year with a reminder: an expired token makes the next backup fail with `401`,
  which opens the backup incident.
- A token pushed to a public repository is revoked automatically, so it lives only in the Vercel
  environment.

### Environment variables

| Variable                   | Value                                                                                                       | Secret |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- | ------ |
| `BACKUP_GITHUB_REPOSITORY` | `owner/repository` of the private backup repository                                                         | No     |
| `BACKUP_GITHUB_TOKEN`      | The fine-grained token above                                                                                | Yes    |
| `BACKUP_ENCRYPTION_KEY`    | 32 random bytes, base64; the owner keeps a copy in a password manager: without it no backup can be restored | Yes    |

## When a quota is hit

The only limits within reach are API rate limits: a `403` or `429` on rate limiting means the step is
retried at the next tick. Creating content too quickly can trigger GitHub's secondary rate limits
([Releases API](https://docs.github.com/en/rest/releases/releases)); a few calls per backup cannot. A
failed backup opens an incident and the previous backups stay in place (TRV-50).

## Quota parameters to enter (TRV-03)

| Parameter         | Value to enter                                                                |
| ----------------- | ----------------------------------------------------------------------------- |
| Backups kept      | 8 by default (`backups.kept`, H-TRV-09), all kinds together, fewer than 1,000 |
| Maximum file size | 2 GiB                                                                         |
| REST requests     | 5,000 an hour                                                                 |

## Replaceable by

- **A private Vercel Blob store** (runner-up, no new account): Hobby includes 1 GB of storage, 10,000
  simple and 2,000 advanced operations and 10 GB of transfer a month, and going over any Blob limit
  makes Blob unusable until 30 days have passed ([Blob usage and pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing),
  updated 2026-09-23). Private stores require authentication for every read and write
  ([Private storage](https://vercel.com/docs/vercel-blob/private-storage)), and a deleted blob can
  take up to 60 seconds to leave the cache ([Vercel Blob](https://vercel.com/docs/vercel-blob)). It
  lost because the 1 GB cap is shared with the project, a lockout would stop backups for a month, the
  backups would sit with the same provider as the application, and Hobby content may be used for
  model training unless the owner opts out ([hosting.md](hosting.md)).
- **Backblaze B2**: 10 GB free and no card at sign-up ([B2 pricing](https://www.backblaze.com/cloud-storage/pricing),
  [sign-up](https://www.backblaze.com/sign-up/cloud-storage)), but a new account, and new buckets
  keep every file version until lifecycle rules remove them ([Lifecycle rules](https://www.backblaze.com/docs/cloud-storage-lifecycle-rules)).

Replacement procedure: create the new store, point the application's backup adapter at it, run a
backup by hand and check it (TRV-75 step 13); delete the old backups from GitHub once the new store
holds as many backups as are kept, or at once if the account is abandoned.

## Date checked

2026-11-11.

## What was verified and how

Read on 2026-11-11, without logging in: GitHub's releases, release assets, permissions, token
management, token revocation, API versions, rate limits, immutable releases, plans, Terms of Service,
Acceptable Use Policies and username policy; Vercel Blob pricing, private storage and caching pages;
the pricing and documentation pages of the other options. No repository or token was created. Not
verified: how long GitHub's internal backups keep a deleted release asset (not published), which
permission the upload endpoint itself checks (it is missing from the permissions table; test it once
with Contents read and write), and whether a draft release creates a tag.

## Risks

- **Retention after deletion is undocumented**: GitHub's internal backups may keep a deleted asset
  for a while. Only ciphertext is exposed, unreadable without the key, which lives in Vercel and the
  owner's password manager.
- **Releases are meant for software**: a policy change could forbid this use; the Vercel Blob
  replacement needs no new account.
- **Lost key, lost backups**: the owner must keep the key outside Vercel.
- **A raised retention lengthens the horizon**: with more backups kept, a withdrawn fact stays longer
  in the stored backups, and its fingerprint with it (CL-DSN-07).
- **Never purge by deleting the repository**: a deleted repository can be restored for 90 days
  ([Restoring a deleted repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/restoring-a-deleted-repository)).
- **Never commit backups to Git**: history keeps every version.
