import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { cleanLink, isSameLink } from './links';

// The article of most tests, in the form that the cleaning gives it.
const ARTICLE = 'https://media-national.example/basketball/2021/01/14/article-title';

// --- Links built from their parts, for the properties --------------------------------

// An article's address: its port is `:` and digits, never the default port of its
// scheme, or empty when the address names none.
type Article = Readonly<{
  scheme: 'http' | 'https';
  host: string;
  port: string;
  path: string;
  parameters: readonly string[];
}>;

// How an article's link may be written: tracking parameters, each with the position it
// takes among the article's own, then empty parameters at theirs, a fragment, and the
// default port of its scheme when the address names no port.
type Writing = Readonly<{
  tracking: readonly (readonly [position: number, parameter: string])[];
  emptyAt: readonly number[];
  fragment: string | undefined;
  withDefaultPort: boolean;
}>;

const CLICK_IDENTIFIERS: ReadonlySet<string> = new Set(['fbclid', 'gclid', 'mc_cid', 'mc_eid']);
const DEFAULT_PORT = { http: ':80', https: ':443' } as const;

// Values hold some of what RFC 3986 allows in a query besides the `&` that separates
// parameters, among them `?`, `/` and `=`, which the cleaning must keep as written.
const parameterValue = fc.stringMatching(/^[\w.~:@/?=-]{0,6}$/u);
// Parameters that the cleaning keeps: their names hold no `_`, so that none starts with
// `utm_`, and are none of the click identifiers. Some start with `utm`, at the edge of
// the tracking prefix, which ends with its underscore.
const keptName = fc.oneof(
  fc.stringMatching(/^[a-z][\da-z]{0,7}$/u),
  fc.stringMatching(/^utm[\da-z]{0,5}$/u),
);
const keptParameter = fc
  .tuple(keptName, parameterValue)
  .filter(([name]) => !CLICK_IDENTIFIERS.has(name))
  .map(([name, value]) => `${name}=${value}`);
// Ports of any number, and ports that start with the digits of a default one, which
// only the whole port tells from it.
const portDigits = fc.oneof(
  fc.nat({ max: 65_535 }).map(String),
  fc.stringMatching(/^(?:80|443)\d{1,2}$/u),
);
const article: fc.Arbitrary<Article> = fc
  .record({
    scheme: fc.constantFrom('http', 'https'),
    host: fc.domain(),
    port: fc.option(
      portDigits.map((digits) => `:${digits}`),
      { freq: 2, nil: '' },
    ),
    path: fc.webPath(),
    parameters: fc.array(keptParameter, { maxLength: 4 }),
  })
  .filter(({ scheme, port }) => port !== DEFAULT_PORT[scheme]);
// Tracking parameters in any case, with or without a value.
const campaignName = fc.stringMatching(/^[\da-z]{0,6}$/u).map((suffix) => `utm_${suffix}`);
const trackingName = fc.oneof(fc.constantFrom(...CLICK_IDENTIFIERS), campaignName);
const trackingParameter = fc
  .tuple(trackingName, fc.option(parameterValue, { nil: undefined }))
  .chain(([name, value]) =>
    fc
      .mixedCase(fc.constant(name))
      .map((casedName) => (value === undefined ? casedName : `${casedName}=${value}`)),
  );
const placedTrackingParameter = fc.tuple(fc.nat(), trackingParameter);
const writing: fc.Arbitrary<Writing> = fc.record({
  tracking: fc.array(placedTrackingParameter, { maxLength: 4 }),
  emptyAt: fc.array(fc.nat(), { maxLength: 3 }),
  fragment: fc.option(fc.webFragments(), { nil: undefined }),
  withDefaultPort: fc.boolean(),
});

/** The link of an article as the cleaning gives it. */
function cleanedLinkOf({ scheme, host, port, path, parameters }: Article): string {
  const query = parameters.length === 0 ? '' : `?${parameters.join('&')}`;
  return `${scheme}://${host}${port}${path}${query}`;
}

/** The link of an article written another way: scheme and host in capitals, and more. */
function writtenLinkOf({ scheme, host, port, path, parameters }: Article, how: Writing): string {
  const allParameters = [...parameters];
  for (const [position, parameter] of how.tracking) {
    allParameters.splice(position % (allParameters.length + 1), 0, parameter);
  }
  // An empty parameter alone writes the query as a `?` alone.
  for (const position of how.emptyAt) {
    allParameters.splice(position % (allParameters.length + 1), 0, '');
  }
  const writtenPort = port === '' && how.withDefaultPort ? DEFAULT_PORT[scheme] : port;
  const query = allParameters.length === 0 ? '' : `?${allParameters.join('&')}`;
  const fragment = how.fragment === undefined ? '' : `#${how.fragment}`;
  return `${scheme.toUpperCase()}://${host.toUpperCase()}${writtenPort}${path}${query}${fragment}`;
}

describe('cleanLink', () => {
  it('[COL-28] [CL-COL-23] removes every parameter whose name starts with utm_, whatever its case', () => {
    expect(
      cleanLink(`${ARTICLE}?utm_source=feed&UTM_Medium=social&Utm_campaign=spring&utm_=1`),
    ).toBe(ARTICLE);
  });

  it.each(['fbclid', 'gclid', 'mc_cid', 'mc_eid', 'FBCLID', 'Mc_Eid'])(
    '[COL-28] [CL-COL-23] removes the click identifier %s',
    (name) => {
      expect(cleanLink(`${ARTICLE}?id=7&${name}=IwAR0xYz`)).toBe(`${ARTICLE}?id=7`);
    },
  );

  it('[COL-28] [CL-COL-23] keeps the other parameters in their order, with their values', () => {
    expect(
      cleanLink(`${ARTICLE}?id=7&utm_source=feed&Page=2&fbclid=IwAR&ref=Home&gclid=Cj0&x=`),
    ).toBe(`${ARTICLE}?id=7&Page=2&ref=Home&x=`);
  });

  it('[COL-28] [CL-COL-23] [CL-IMP-14] keeps a parameter whose value holds ? as written, and removes the tracking parameters around it', () => {
    expect(cleanLink(`${ARTICLE}?utm_source=feed&next=/b?id=1&fbclid=x`)).toBe(
      `${ARTICLE}?next=/b?id=1`,
    );
  });

  it('[COL-28] [CL-COL-23] removes a click identifier whose value holds =', () => {
    expect(cleanLink(`${ARTICLE}?gclid=Cj0=&id=7&mc_eid=a=b`)).toBe(`${ARTICLE}?id=7`);
  });

  it('[CL-COL-23] keeps a parameter whose name only holds a tracking name, and one whose value does', () => {
    const url = `${ARTICLE}?xutm_source=1&fbclid2=2&my_gclid=3&mc_eid_page=4&source=utm_feed`;

    expect(cleanLink(url)).toBe(url);
  });

  it('[COL-28] [CL-COL-23] keeps a parameter whose name starts with utm without the underscore', () => {
    const url = `${ARTICLE}?utm=1&utmost=2&utm-source=3&UTMcampaign=4`;

    expect(cleanLink(url)).toBe(url);
  });

  it('[COL-28] [CL-COL-23] removes a tracking parameter written without a value', () => {
    expect(cleanLink(`${ARTICLE}?fbclid&id=7&utm_source`)).toBe(`${ARTICLE}?id=7`);
  });

  it.each([
    ['https://media-national.example/a?utm_source=feed&', 'https://media-national.example/a'],
    ['https://media-national.example/a?&utm_source=feed', 'https://media-national.example/a'],
    ['https://media-national.example/a?', 'https://media-national.example/a'],
    ['https://media-national.example/?utm_source=feed&', 'https://media-national.example/'],
    [
      'https://media-national.example/a?id=7&&page=2',
      'https://media-national.example/a?id=7&page=2',
    ],
    ['https://media-national.example/a?&id=7&#top', 'https://media-national.example/a?id=7'],
  ])(
    '[COL-28] [CL-COL-23] [CL-IMP-14] removes the empty parameters of %s, and its ? when none remains',
    (url, expected) => {
      expect(cleanLink(url)).toBe(expected);
    },
  );

  it('[CL-IMP-14] lowercases the scheme and the host, and keeps the case of the path and the query', () => {
    expect(cleanLink('HTTPS://Media-National.EXAMPLE/Basketball/Article-Title?Id=AbC')).toBe(
      'https://media-national.example/Basketball/Article-Title?Id=AbC',
    );
  });

  it.each([
    ['http://Media-National.EXAMPLE:80/a', 'http://media-national.example/a'],
    ['https://media-national.example:443/a', 'https://media-national.example/a'],
    ['HTTPS://Media-National.EXAMPLE:443', 'https://media-national.example'],
    ['https://media-national.example:443?id=7#top', 'https://media-national.example?id=7'],
  ])('[CL-IMP-14] drops the default port of its scheme from %s', (url, expected) => {
    expect(cleanLink(url)).toBe(expected);
  });

  it.each([
    'https://media-national.example:80/a',
    'http://media-national.example:443/a',
    'https://media-national.example:8443/a',
    'http://media-national.example:8080/a',
    'https://media-national.example:4433/a',
    'ftp://files.example:21/a',
  ])('[CL-IMP-14] keeps any other port: %s', (url) => {
    expect(cleanLink(url)).toBe(url);
  });

  it('[CL-IMP-14] keeps an IPv6 host whose address ends with the digits of the default port', () => {
    const url = 'https://[2001:db8::443]/a';

    expect(cleanLink(url)).toBe(url);
  });

  it.each([
    [`${ARTICLE}#comments`, ARTICLE],
    [`${ARTICLE}?id=7#utm_source=feed`, `${ARTICLE}?id=7`],
    [`${ARTICLE}#top?utm_source=feed&id=7`, ARTICLE],
    [`${ARTICLE}?id=7#top#comments`, `${ARTICLE}?id=7`],
    [`${ARTICLE}#`, ARTICLE],
  ])('[CL-IMP-14] drops the fragment of %s', (url, expected) => {
    expect(cleanLink(url)).toBe(expected);
  });

  it.each([
    'http://media-national.example/a',
    'https://www.media-national.example/a',
    'https://media-national.example/a/',
    'https://media-national.example/A%2fb/./c/../d?q=a+b%2C&q=a',
  ])('[CL-IMP-14] keeps %s as it is: scheme, www., trailing slash, path and query', (url) => {
    expect(cleanLink(url)).toBe(url);
  });

  it('[CL-IMP-14] keeps the case of the user information, up to the last @ before the host', () => {
    expect(cleanLink('https://Reader@Media-National.EXAMPLE:443/a')).toBe(
      'https://Reader@media-national.example/a',
    );
    expect(cleanLink('https://Reader@Home@Media-National.EXAMPLE/a')).toBe(
      'https://Reader@Home@media-national.example/a',
    );
  });

  it.each([
    ['S3://Bucket.EXAMPLE/a', 's3://bucket.example/a'],
    ['Svn+SSH://Repository.EXAMPLE/a', 'svn+ssh://repository.example/a'],
  ])('[CL-IMP-14] lowercases a scheme with digits or signs: %s', (url, expected) => {
    expect(cleanLink(url)).toBe(expected);
  });

  it.each([
    ['www.Media-National.EXAMPLE/a?utm_source=feed&id=7#top', 'www.Media-National.EXAMPLE/a?id=7'],
    ['[1] https://Media-National.EXAMPLE/a', '[1] https://Media-National.EXAMPLE/a'],
    [
      'Media-National.EXAMPLE/share/https://Other.EXAMPLE/a',
      'Media-National.EXAMPLE/share/https://Other.EXAMPLE/a',
    ],
  ])(
    '[CL-IMP-14] keeps the case of a link that does not start with a scheme and ://: %s',
    (url, expected) => {
      expect(cleanLink(url)).toBe(expected);
    },
  );

  it('[COL-28] [CL-COL-23] [CL-IMP-14] gives an article one link, whatever tracking and empty parameters, fragment, case and default port it is written with', () => {
    fc.assert(
      fc.property(article, writing, (parts, how) => {
        expect(cleanLink(writtenLinkOf(parts, how))).toBe(cleanedLinkOf(parts));
      }),
    );
  });

  it('[CL-IMP-14] gives a cleaned link back unchanged', () => {
    const urls = fc.webUrl({
      validSchemes: ['http', 'https', 'ftp'],
      authoritySettings: { withIPv4: true, withIPv6: true, withPort: true, withUserInfo: true },
      withQueryParameters: true,
      withFragments: true,
    });

    fc.assert(
      fc.property(urls, (url) => {
        expect(cleanLink(cleanLink(url))).toBe(cleanLink(url));
      }),
    );
  });
});

describe('isSameLink', () => {
  it('[IMP-25] [CL-IMP-14] takes two links that differ only by what the cleaning removes for one', () => {
    expect(
      isSameLink(
        'HTTPS://Media-National.EXAMPLE:443/a?utm_source=feed&id=7#comments',
        'https://media-national.example/a?id=7&fbclid=IwAR',
      ),
    ).toBe(true);
  });

  it.each([
    ['https://media-national.example/a?', 'https://media-national.example/a'],
    ['https://media-national.example/a?utm_source=feed&', 'https://media-national.example/a'],
    ['https://media-national.example/a?id=7&', 'https://media-national.example/a?&id=7'],
  ])(
    '[IMP-25] [COL-28] [CL-IMP-14] takes %s and %s, which differ only by an empty query or empty parameters, for one link',
    (url, otherUrl) => {
      expect(isSameLink(url, otherUrl)).toBe(true);
    },
  );

  it.each([
    ['http and https', 'http://media-national.example/a', 'https://media-national.example/a'],
    ['a www. prefix', 'https://www.media-national.example/a', 'https://media-national.example/a'],
    ['a trailing slash', 'https://media-national.example/a/', 'https://media-national.example/a'],
    [
      'the case of the path',
      'https://media-national.example/A',
      'https://media-national.example/a',
    ],
    [
      'the order of the parameters',
      'https://media-national.example/a?id=7&page=2',
      'https://media-national.example/a?page=2&id=7',
    ],
    ['another port', 'https://media-national.example:8443/a', 'https://media-national.example/a'],
    [
      'two ports that start with the digits of the default one',
      'http://media-national.example:8080/a',
      'http://media-national.example:8090/a',
    ],
    [
      'what follows a second ? in the value of a parameter',
      'https://media-national.example/a?next=/b?id=1',
      'https://media-national.example/a?next=/b?id=2',
    ],
    [
      'the value of a parameter whose name starts with utm without the underscore',
      'https://media-national.example/a?utmost=1',
      'https://media-national.example/a?utmost=2',
    ],
  ])('[IMP-25] [CL-IMP-14] tells two links apart by %s', (_difference, url, otherUrl) => {
    expect(isSameLink(url, otherUrl)).toBe(false);
  });
});
