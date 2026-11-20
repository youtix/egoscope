import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { cleanLink, isSameLink } from './links';

// The article of most tests, in the form that the cleaning gives it.
const ARTICLE = 'https://media-national.example/basketball/2021/01/14/article-title';

// --- Links built from their parts, for the properties --------------------------------

type Article = Readonly<{
  scheme: 'http' | 'https';
  host: string;
  path: string;
  parameters: readonly string[];
}>;

// How an article's link may be written: tracking parameters, each with the position it
// takes among the article's own, a fragment, and the default port of its scheme.
type Writing = Readonly<{
  tracking: readonly (readonly [position: number, parameter: string])[];
  fragment: string | undefined;
  withDefaultPort: boolean;
}>;

const CLICK_IDENTIFIERS: ReadonlySet<string> = new Set(['fbclid', 'gclid', 'mc_cid', 'mc_eid']);
const DEFAULT_PORT = { http: ':80', https: ':443' } as const;

const parameterValue = fc.stringMatching(/^[\w.~-]{0,6}$/u);
// Parameters that the cleaning keeps: their names hold no `_`, so that none starts with
// `utm_`, and are none of the click identifiers.
const keptParameter = fc
  .tuple(fc.stringMatching(/^[a-z][\da-z]{0,7}$/u), parameterValue)
  .filter(([name]) => !CLICK_IDENTIFIERS.has(name))
  .map(([name, value]) => `${name}=${value}`);
const article: fc.Arbitrary<Article> = fc.record({
  scheme: fc.constantFrom('http', 'https'),
  host: fc.domain(),
  path: fc.webPath(),
  parameters: fc.array(keptParameter, { maxLength: 4 }),
});
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
  fragment: fc.option(fc.webFragments(), { nil: undefined }),
  withDefaultPort: fc.boolean(),
});

/** The link of an article as the cleaning gives it. */
function cleanedLinkOf({ scheme, host, path, parameters }: Article): string {
  const query = parameters.length === 0 ? '' : `?${parameters.join('&')}`;
  return `${scheme}://${host}${path}${query}`;
}

/** The link of an article written another way: scheme and host in capitals, and more. */
function writtenLinkOf({ scheme, host, path, parameters }: Article, how: Writing): string {
  const allParameters = [...parameters];
  for (const [position, parameter] of how.tracking) {
    allParameters.splice(position % (allParameters.length + 1), 0, parameter);
  }
  const port = how.withDefaultPort ? DEFAULT_PORT[scheme] : '';
  const query = allParameters.length === 0 ? '' : `?${allParameters.join('&')}`;
  const fragment = how.fragment === undefined ? '' : `#${how.fragment}`;
  return `${scheme.toUpperCase()}://${host.toUpperCase()}${port}${path}${query}${fragment}`;
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

  it('[CL-COL-23] keeps a parameter whose name only holds a tracking name, and one whose value does', () => {
    const url = `${ARTICLE}?xutm_source=1&fbclid2=2&my_gclid=3&mc_eid_page=4&source=utm_feed`;

    expect(cleanLink(url)).toBe(url);
  });

  it('[COL-28] [CL-COL-23] removes a tracking parameter written without a value', () => {
    expect(cleanLink(`${ARTICLE}?fbclid&id=7&utm_source`)).toBe(`${ARTICLE}?id=7`);
  });

  it('[CL-IMP-14] keeps an empty query and an empty parameter as written', () => {
    expect(cleanLink(`${ARTICLE}?`)).toBe(`${ARTICLE}?`);
    expect(cleanLink(`${ARTICLE}?id=7&&page=2`)).toBe(`${ARTICLE}?id=7&&page=2`);
  });

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
    'ftp://files.example:21/a',
  ])('[CL-IMP-14] keeps any other port: %s', (url) => {
    expect(cleanLink(url)).toBe(url);
  });

  it.each([
    [`${ARTICLE}#comments`, ARTICLE],
    [`${ARTICLE}?id=7#utm_source=feed`, `${ARTICLE}?id=7`],
    [`${ARTICLE}#top?utm_source=feed&id=7`, ARTICLE],
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

  it('[CL-IMP-14] keeps the case of the user information before the host', () => {
    expect(cleanLink('https://Reader@Media-National.EXAMPLE:443/a')).toBe(
      'https://Reader@media-national.example/a',
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

  it('[COL-28] [CL-COL-23] [CL-IMP-14] gives an article one link, whatever tracking parameters, fragment, case and default port it is written with', () => {
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
  ])('[IMP-25] [CL-IMP-14] tells two links apart by %s', (_difference, url, otherUrl) => {
    expect(isSameLink(url, otherUrl)).toBe(false);
  });
});
