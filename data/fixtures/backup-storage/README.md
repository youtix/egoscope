# The recorded answers of the GitHub backup adapter

These files are answers of GitHub's REST API, as the backup storage sheet
(`docs/services/backup-storage.md`) calls it: each holds the status, the headers the adapter
reads and the JSON body, in the shape of the examples of GitHub's Releases, Release assets and
Repositories reference. Every value that names something is invented: the repository
`quiet-owner/archive-vault`, its owner, every id, node id, request id and signature. No answer
holds a token or any other credential.

The tests of the adapter (`src/lib/backup-storage/github-releases.test.ts`) serve them from a fake
HTTP layer that plays the repository, so that no test reaches GitHub. The fake writes into each
answer what the request changed: the ids, names, sizes, states and creation instants of the release
and of its assets.

- `repository.json`: the repository's own endpoint, private; the privacy check before each upload.
- `release.json`: the draft release `backups`, as its creation answers it.
- `asset.json`: an asset that an upload stored, in state `uploaded`.
- `asset-redirect.json`: the `302` to the file's signed address that a download with
  `Accept: application/octet-stream` answers.
- `errors.json`: the failures, by name: a rejected token (`401`), a token without the permission
  (`403`), an unknown resource (`404`), a taken asset name (`422`), the hourly rate limit (`403`
  with no request left), a secondary rate limit (`429`), a secondary rate limit that answers
  `403` with its message and neither `retry-after` nor an exhausted window, a `403` with
  `retry-after` and the message of a missing permission, a `403` with an HTML page, with and without
  `retry-after`, as an intermediary in front of the API answers, and a server error (`502`).

An answer is `{ "status": number, "headers": { name: value }, "body": <any JSON value> }`, the body
served as its JSON text, with no `body` for an empty answer. An answer with `"text": "<string>"`
instead is served as that string, byte for byte, with the headers it states: it records a body that
is no JSON, such as an HTML page (`content-type: text/html; charset=utf-8`).
