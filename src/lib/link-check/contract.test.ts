import { createServer } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LINK_CHECK_CONTRACT, observeProbe } from './contract';
import { createFakeLinkCheck } from './fake';
import { createHttpLinkCheck } from './http';

import type { LinkAnswer, LinkCheckHarness } from './contract';
import type { FakeLinkCheck } from './fake';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { LookupFunction } from 'node:net';

const UNRESOLVED_HOST = 'nowhere.test';
const FOUND = 302;
// The parts of a path of the local server: the empty one before its first slash, then three.
const PATH_PARTS = 4;

/** The address of the fake that answers as `answer` says, scripted on the way. */
function scripted(fake: FakeLinkCheck, answer: LinkAnswer): string {
  switch (answer.kind) {
    case 'status': {
      fake.answer('https://news.test/article', { status: answer.status });
      return 'https://news.test/article';
    }
    case 'redirects': {
      for (let hop = 0; hop < answer.redirects; hop += 1) {
        fake.answer(`https://news.test/hop/${String(hop)}`, {
          redirectTo: `/hop/${String(hop + 1)}`,
        });
      }
      fake.answer(`https://news.test/hop/${String(answer.redirects)}`, { status: answer.status });
      return 'https://news.test/hop/0';
    }
    case 'unresolved': {
      fake.answer(`https://${UNRESOLVED_HOST}/article`, 'unresolved');
      return `https://${UNRESOLVED_HOST}/article`;
    }
    case 'slow': {
      fake.answer('https://slow.test/article', 'timeout');
      return 'https://slow.test/article';
    }
  }
}

function fakeHarness(): LinkCheckHarness {
  const fake = createFakeLinkCheck();
  return { linkCheck: fake, addressOf: (answer) => scripted(fake, answer) };
}

// The local server of the HTTP adapter: /status/<code>, /redirect/<left>/<code>, /slow.
function route(request: IncomingMessage, response: ServerResponse): void {
  const [, kind = '', first = '', second = ''] = (request.url ?? '').split('/', PATH_PARTS);
  if (kind === 'redirect' && Number(first) > 0) {
    response
      .writeHead(FOUND, { location: `/redirect/${String(Number(first) - 1)}/${second}` })
      .end();
  } else if (kind !== 'slow') {
    response.writeHead(Number(kind === 'redirect' ? second : first)).end();
  }
}

// Fails every lookup as a name that does not exist would; the server's own address needs none.
const unresolvable: LookupFunction = (hostname, _options, callback) => {
  callback(
    Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' }),
    '',
  );
};

/** The address on the local server at `base` that answers as `answer` says. */
function addressOnServer(base: string, answer: LinkAnswer): string {
  switch (answer.kind) {
    case 'status': {
      return `${base}/status/${String(answer.status)}`;
    }
    case 'redirects': {
      return `${base}/redirect/${String(answer.redirects)}/${String(answer.status)}`;
    }
    case 'unresolved': {
      return `http://${UNRESOLVED_HOST}/article`;
    }
    case 'slow': {
      return `${base}/slow`;
    }
  }
}

describe('[IMP-17] [CL-IMP-25] the fake against the link-check contract', () => {
  it.each(LINK_CHECK_CONTRACT)('$title', async (contractCase) => {
    await expect(observeProbe(fakeHarness(), contractCase)).resolves.toStrictEqual(
      contractCase.expected,
    );
  });
});

describe('[IMP-17] [CL-IMP-25] the HTTP adapter against the link-check contract, on a local server', () => {
  const server: Server = createServer(route);
  let base: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    base = `http://127.0.0.1:${String(typeof address === 'object' && address !== null ? address.port : 0)}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it.each(LINK_CHECK_CONTRACT)('$title', async (contractCase) => {
    const harness = {
      linkCheck: createHttpLinkCheck({ lookup: unresolvable, allowedAddresses: ['127.0.0.1'] }),
      addressOf: (answer: LinkAnswer) => addressOnServer(base, answer),
    };

    await expect(observeProbe(harness, contractCase)).resolves.toStrictEqual(contractCase.expected);
  });
});
