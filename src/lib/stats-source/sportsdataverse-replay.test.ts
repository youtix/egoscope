import { describe, expect, it, onTestFinished } from 'vitest';

import { startReplay } from './sportsdataverse-replay';

import type { Replay } from './sportsdataverse-replay';

const FILE = 'tag/file.csv';

/** A replay of one invented file, closed when the test ends. */
async function replayOf(): Promise<Replay> {
  const replay = await startReplay(new Map([[FILE, Buffer.from('a,b\n1,2\n')]]));
  onTestFinished(async () => replay.close());
  return replay;
}

describe('the local replay of the SportsDataverse release', () => {
  it('[TRV-15] redirects a published file to the asset host, and answers 404 for any other', async () => {
    const replay = await replayOf();
    const redirect = await fetch(`${replay.baseUrl}/${FILE}`, { redirect: 'manual' });
    const missing = await fetch(replay.baseUrl.replace('/download', '/asset/tag/other.csv'));
    expect([redirect.status, redirect.headers.get('location'), missing.status]).toStrictEqual([
      302,
      `/asset/${FILE}`,
      404,
    ]);
  });

  it('[TRV-15] serves a generated body as it comes, which no changed layout rewrites', async () => {
    const replay = await replayOf();
    replay.publish(FILE, function* generated() {
      yield Buffer.from('a,b\n');
    });
    replay.inject(FILE, { kind: 'schema_changed' });
    const answer = await fetch(`${replay.baseUrl}/${FILE}`);
    const body = await answer.text();
    expect([answer.status, answer.headers.get('etag'), body, replay.text(FILE)]).toStrictEqual([
      200,
      '"generated"',
      'a,b\n',
      '',
    ]);
  });
});
