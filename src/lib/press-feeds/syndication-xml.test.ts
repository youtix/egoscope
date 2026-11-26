import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseTimestamp } from '@/lib/time';

import { MAX_FEED_BYTES } from './syndication';
import { feedIn, MAX_FEED_DEPTH, MAX_FEED_ITEMS, webAddress } from './syndication-xml';

import type { FeedItem } from './types';
import type { ParsedTimestamp } from '@/lib/time';

const FIXTURES = path.join(import.meta.dirname, '../../../data/fixtures/press-feeds');
const COURTSIDE = 'https://courtside.example.test/feed.xml';
const BASELINE = 'https://baseline.example.test/atom.xml';
const XML_TYPE = 'application/xml';

const fixture = (name: string): Uint8Array => readFileSync(path.join(FIXTURES, name));
const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

/** A date as the time module reads the text a feed wrote. */
function at(text: string): ParsedTimestamp {
  const parsed = parseTimestamp(text);
  if (!parsed.ok) {
    throw new RangeError(`Not a date: ${text}`);
  }
  return parsed.timestamp;
}

const EMPTY_ITEM: FeedItem = {
  identifier: null,
  link: null,
  title: null,
  publishedAt: null,
  updatedAt: null,
  language: null,
  originOutlet: null,
  excerpt: null,
};

/** An item that gives `fields` and lacks every other. */
const item = (fields: Partial<FeedItem>): FeedItem => ({ ...EMPTY_ITEM, ...fields });

/** An RSS 2.0 document whose channel holds `items`. */
const rss = (items: string, before = ''): string =>
  `${before}<rss version="2.0"><channel><title>Invented</title>${items}</channel></rss>`;

/** An RSS 2.0 document after `declaration`, in ISO-8859-1, whose one item has a title with an accent. */
const latin = (declaration: string): Uint8Array =>
  Buffer.from(`${declaration}${rss('<item><title>Crónica</title></item>')}`, 'latin1');

/** An RSS 2.0 document whose one item's description holds `levels` nested elements around its text. */
const nested = (levels: number): Uint8Array =>
  bytesOf(
    rss(
      `<item><description>${'<em>'.repeat(levels)}Deep${'</em>'.repeat(levels)}</description></item>`,
    ),
  );

// Room left beside the repeated content for a document's root, within the byte bound.
const ROOT_BYTES = 64;
// A body up to the byte bound is read in far less time than this.
const READ_BUDGET_MS = 1000;
const UNREADABLE = { ok: false, error: { kind: 'unreadable' } } as const;
const NOT_A_FEED = { ok: false, error: { kind: 'not_a_feed' } } as const;

/** `unit` repeated as often as the byte bound allows beside a root. */
const filling = (unit: string): string =>
  unit.repeat(Math.floor((MAX_FEED_BYTES - ROOT_BYTES) / unit.length));

/** What `documents` give, the time they took to read and the bytes of the largest. */
function timed(
  documents: readonly string[],
): Readonly<{ answers: unknown[]; elapsedMs: number; largestBytes: number }> {
  const bodies = documents.map((text) => bytesOf(text));
  const started = performance.now();
  const answers = bodies.map((bytes) => feedIn(bytes, XML_TYPE, COURTSIDE));
  const elapsedMs = performance.now() - started;
  return { answers, elapsedMs, largestBytes: Math.max(...bodies.map((body) => body.byteLength)) };
}

/** The title of the first item that `bytes` give, or the error of a body that gives none. */
function titleOf(bytes: Uint8Array, contentType: string | null): unknown {
  const document = feedIn(bytes, contentType, COURTSIDE);
  return document.ok ? document.feed.items[0]?.title : document.error;
}

describe('feedIn', () => {
  it('[TRV-17] [COL-06] [COL-17] [COL-19] [COL-20] [COL-27] [CL-COL-01] reads an RSS 2.0 feed into its items as the feed gives them', () => {
    expect(feedIn(fixture('courtside-rss.xml'), 'application/rss+xml', COURTSIDE)).toStrictEqual({
      ok: true,
      feed: {
        language: 'en-us',
        items: [
          item({
            identifier: 'courtside-1042',
            link: 'https://courtside.example.test/2026/11/20/vrask-ankle',
            title: 'Teodor Vrask leaves practice with a sprained ankle',
            publishedAt: at('Fri, 20 Nov 2026 18:30:00 -0500'),
            excerpt: '<p>The forward <b>limped off</b> during the morning session.</p>',
          }),
          item({
            identifier: 'courtside-1041',
            link: 'https://courtside.example.test/2026/11/20/lindqvar-return',
            title: 'Mika Lindqvar is cleared to return',
            publishedAt: at('2026-11-20'),
            excerpt: '<p>Back on the floor before the road trip & ready.</p>',
          }),
          item({
            identifier: 'courtside-1040',
            link: 'https://courtside.example.test/2026/11/20/brannoch-trade',
            title: 'Ozzie Brannoch asks for a trade',
            publishedAt: at('Fri, 20 Nov 2026 09:15:00'),
            excerpt: "<p>The guard's agent met the front office.</p>",
          }),
          item({
            identifier: 'courtside-1039',
            link: 'https://courtside.example.test/2026/11/19/injury-report',
            title: 'The injury report, updated',
            updatedAt: at('2026-11-19T22:00:00Z'),
          }),
          item({
            identifier: 'courtside-1038',
            title: 'A headline without a link',
            publishedAt: at('Thu, 19 Nov 2026 20:00:00 GMT'),
          }),
          item({
            identifier: 'courtside-1037',
            link: 'https://courtside.example.test/2026/11/19/untitled',
            publishedAt: at('Thu, 19 Nov 2026 19:00:00 +0000'),
          }),
          item({
            identifier: 'courtside-1036',
            link: 'https://courtside.example.test/2026/11/19/cronica',
            title: 'Crónica del partido de anoche',
            publishedAt: at('Thu, 19 Nov 2026 12:00:00 +0000'),
            language: 'es',
          }),
          item({
            identifier: 'courtside-1035',
            link: 'https://dunkdigest.example.test/2026/11/20/corvato-extension',
            title: 'Ilan Corvato extends his contract',
            publishedAt: at('Fri, 20 Nov 2026 08:00:00 +0100'),
            originOutlet: 'Dunk Digest',
          }),
          item({ excerpt: 'An item with neither a title, a link, an identifier nor a date.' }),
        ],
      },
    });
  });

  it('[TRV-17] [COL-06] [COL-17] [COL-19] [COL-27] [CL-COL-01] reads an Atom feed, its links against its bases and its web addresses only', () => {
    expect(feedIn(fixture('baseline-atom.xml'), null, BASELINE)).toStrictEqual({
      ok: true,
      feed: {
        language: 'fr',
        items: [
          item({
            identifier: 'tag:baseline.example.test,2026:entry-311',
            link: 'https://baseline.example.test/articles/corvato-prolonge',
            title: 'Ilan Corvato prolonge <em>trois ans</em>',
            publishedAt: at('2026-11-21T07:45:00+01:00'),
            updatedAt: at('2026-11-21T09:10:00+01:00'),
            excerpt: '<p>Le pivot reste au club.</p>',
          }),
          item({
            identifier: 'tag:baseline.example.test,2026:entry-310',
            link: 'https://baseline.example.test/english/brannoch-talks',
            title: 'Ozzie Brannoch trade talks stall',
            updatedAt: at('2026-11-20T23:30:00Z'),
            language: 'en',
            excerpt: 'Talks stalled overnight.',
          }),
          item({
            identifier: 'tag:baseline.example.test,2026:entry-309',
            link: 'https://courtside.example.test/2026/11/20/lindqvar-return',
            title: "Mika Lindqvar reprend l'entraînement",
            publishedAt: at('2026-11-20T18:00:00Z'),
            updatedAt: at('2026-11-20T18:00:00Z'),
            originOutlet: 'Courtside Daily',
            excerpt: "Le meneur a repris l'entraînement.",
          }),
          item({
            identifier: 'tag:baseline.example.test,2026:entry-308',
            updatedAt: at('2026-11-19T10:00:00Z'),
          }),
        ],
      },
    });
  });

  it('[TRV-17] [CL-COL-01] reads an RSS 1.0 feed, an RSS feed without a channel and an Atom feed whose elements carry a prefix', () => {
    const rdf = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
        xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <channel rdf:about="https://quiet.example.test/"><title>Quiet</title><dc:language>fr</dc:language></channel>
      <item rdf:about=" https://quiet.example.test/a1 "><title>Calme plat</title>
        <link>https://quiet.example.test/a1</link><dc:date>2026-11-20T10:00:00+01:00</dc:date>
        <description>Rien de neuf.</description></item>
    </rdf:RDF>`;
    const prefixed = `<atom:feed xmlns:atom="http://www.w3.org/2005/Atom">
      <atom:entry><atom:id>p-1</atom:id><atom:title>Prefixed</atom:title>
        <atom:link href="https://prefixed.example.test/p-1"/></atom:entry>
    </atom:feed>`;

    expect(feedIn(bytesOf(rdf), XML_TYPE, 'https://quiet.example.test/rss')).toStrictEqual({
      ok: true,
      feed: {
        language: 'fr',
        items: [
          item({
            identifier: 'https://quiet.example.test/a1',
            link: 'https://quiet.example.test/a1',
            title: 'Calme plat',
            publishedAt: at('2026-11-20T10:00:00+01:00'),
            excerpt: 'Rien de neuf.',
          }),
        ],
      },
    });
    expect(feedIn(bytesOf('<rss version="2.0"/>'), XML_TYPE, COURTSIDE)).toStrictEqual({
      ok: true,
      feed: { language: null, items: [] },
    });
    expect(feedIn(bytesOf(prefixed), XML_TYPE, BASELINE)).toStrictEqual({
      ok: true,
      feed: {
        language: null,
        items: [
          item({ identifier: 'p-1', link: 'https://prefixed.example.test/p-1', title: 'Prefixed' }),
        ],
      },
    });
  });

  it('[TRV-17] reads the first items of a feed, up to the bound, in the feed order', () => {
    const items = Array.from(
      { length: MAX_FEED_ITEMS + 1 },
      (_, index) => `<item><guid>item-${String(index)}</guid></item>`,
    ).join('');
    // The channel's other elements, after its items, are still read.
    const document = feedIn(bytesOf(rss(`${items}<language>fr</language>`)), XML_TYPE, COURTSIDE);
    const identifiers = document.ok ? document.feed.items.map(({ identifier }) => identifier) : [];

    expect(MAX_FEED_ITEMS).toBe(500);
    expect(identifiers).toHaveLength(MAX_FEED_ITEMS);
    expect([identifiers.at(0), identifiers.at(-1)]).toStrictEqual(['item-0', 'item-499']);
    expect(document.ok && document.feed.language).toBe('fr');
  });

  it('[TRV-17] [COL-41] answers a document whose root is no feed, or that has none, as not a feed', () => {
    const notFeeds = [
      fixture('front-page.html'),
      bytesOf('<?xml version="1.0"?><html><body><p>A page</p></body></html>'),
      bytesOf('{"items":[]}'),
      bytesOf(''),
      bytesOf('<feed><entry/></feed>'),
    ];

    expect(notFeeds.map((bytes) => feedIn(bytes, 'text/html', COURTSIDE))).toStrictEqual(
      notFeeds.map(() => ({ ok: false, error: { kind: 'not_a_feed' } })),
    );
  });

  it('[TRV-17] [COL-41] answers a feed that is not well-formed as unreadable', () => {
    const broken = [
      rss('<item><title>Cut off</title>').slice(0, -'</channel></rss>'.length),
      rss('<item><title>An&nbsp;entity that XML does not define</title></item>'),
      rss('<item><dc:date>2026-11-20</dc:date></item>'),
    ];

    expect(broken.map((text) => feedIn(bytesOf(text), XML_TYPE, COURTSIDE))).toStrictEqual(
      broken.map(() => ({ ok: false, error: { kind: 'unreadable' } })),
    );
  });

  it('[TRV-17] refuses an entity bomb as unreadable without expanding it', () => {
    const levels = Array.from({ length: 9 }, (_, level) => {
      const inner = level === 0 ? 'lol' : `&lol${String(level - 1)};`.repeat(10);
      return `<!ENTITY lol${String(level)} "${inner}">`;
    });
    const bomb = rss('<item><title>&lol8;</title></item>', `<!DOCTYPE rss [${levels.join('')}]>`);

    expect(feedIn(bytesOf(bomb), XML_TYPE, COURTSIDE)).toStrictEqual({
      ok: false,
      error: { kind: 'unreadable' },
    });
  });

  it('[TRV-17] reads a feed nested down to the depth bound and answers a deeper one as unreadable', () => {
    // The nested elements sit in rss > channel > item > description.
    const around = 4;

    expect(MAX_FEED_DEPTH).toBe(64);
    expect(feedIn(nested(MAX_FEED_DEPTH - around), XML_TYPE, COURTSIDE)).toStrictEqual({
      ok: true,
      feed: { language: null, items: [item({ excerpt: 'Deep' })] },
    });
    expect(feedIn(nested(MAX_FEED_DEPTH - around + 1), XML_TYPE, COURTSIDE)).toStrictEqual({
      ok: false,
      error: { kind: 'unreadable' },
    });
  });

  it('[TRV-17] answers an RSS or Atom document nested as deep as the byte bound allows as unreadable, at once', () => {
    const levels = Math.floor((MAX_FEED_BYTES - ROOT_BYTES) / '<a></a>'.length);
    const nesting = `${'<a>'.repeat(levels)}${'</a>'.repeat(levels)}`;
    const { answers, elapsedMs, largestBytes } = timed([
      `<rss version="2.0">${nesting}</rss>`,
      `<feed xmlns="http://www.w3.org/2005/Atom">${nesting}</feed>`,
    ]);

    expect(largestBytes).toBeLessThanOrEqual(MAX_FEED_BYTES);
    expect(answers).toStrictEqual([UNREADABLE, UNREADABLE]);
    expect(elapsedMs).toBeLessThan(READ_BUDGET_MS);
  });

  it('[TRV-17] [COL-41] stops at the first error of a body full of them, unreadable after a feed root and not a feed when no root opens near it', () => {
    const { answers, elapsedMs, largestBytes } = timed([
      `<rss version="2.0">${filling('&x;')}</rss>`,
      `<rss version="2.0">${filling('</>')}</rss>`,
      `${filling('</>')}<rss version="2.0"/>`,
      `${filling('</>')}<html><body/></html>`,
    ]);

    expect(largestBytes).toBeLessThanOrEqual(MAX_FEED_BYTES);
    expect(answers).toStrictEqual([UNREADABLE, UNREADABLE, NOT_A_FEED, NOT_A_FEED]);
    expect(elapsedMs).toBeLessThan(READ_BUDGET_MS);
  });

  it('[COL-41] answers a feed with an error before its root as unreadable, and a page with one as not a feed', () => {
    const feed = rss('<item><title>Stray text above</title></item>');
    const before = [
      'Some text',
      'Warning: Undefined variable $title in /srv/feed.php on line 12\n<?xml version="1.0"?>\n',
      '<!-- cached -->\n<?xml version="1.0"?>',
    ];
    // A UTF-8 byte order mark, read as three characters under the ISO-8859-1 that the answer names.
    const marked = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(`<?xml version="1.0"?>${feed}`),
    ]);

    expect([
      ...before.map((text) => feedIn(bytesOf(`${text}${feed}`), XML_TYPE, COURTSIDE)),
      feedIn(marked, 'application/rss+xml; charset=ISO-8859-1', COURTSIDE),
    ]).toStrictEqual([UNREADABLE, UNREADABLE, UNREADABLE, UNREADABLE]);
    // The same feed read without the error, and a page after the same errors.
    expect(titleOf(bytesOf(feed), XML_TYPE)).toBe('Stray text above');
    expect(
      ['Some text<html><body/></html>', '<!-- cached -->\n<?xml version="1.0"?><html/>'].map(
        (text) => feedIn(bytesOf(text), XML_TYPE, COURTSIDE),
      ),
    ).toStrictEqual([NOT_A_FEED, NOT_A_FEED]);
  });

  it('[COL-17] [TRV-17] decodes a feed in the charset its answer names, else its declaration', () => {
    expect(titleOf(latin(''), 'application/rss+xml; charset="ISO-8859-1"')).toBe('Crónica');
    expect(titleOf(latin(' <?xml version="1.0" encoding="iso-8859-1"?>'), null)).toBe('Crónica');
    expect(titleOf(latin(''), null)).toStrictEqual({ kind: 'unreadable' });
    expect(titleOf(latin(''), 'text/xml; charset=no-such-charset')).toStrictEqual({
      kind: 'unreadable',
    });
  });
});

describe('webAddress', () => {
  it('[COL-26] gives web addresses only, made absolute against their base', () => {
    expect(webAddress(' /a/b ', 'https://x.example.test/feed')).toBe('https://x.example.test/a/b');
    expect(webAddress('http://x.example.test/a')).toBe('http://x.example.test/a');
    expect(
      ['file:///etc/hosts', 'mailto:desk@x.example.test', 'no address', null].map((text) =>
        webAddress(text),
      ),
    ).toStrictEqual([null, null, null, null]);
  });
});
