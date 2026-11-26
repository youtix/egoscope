// The documents of the syndication adapter (syndication.ts): the body of a feed's
// answer, decoded in its charset and parsed by a strict XML parser into an RSS 2.0,
// RSS 1.0 or Atom feed (TRV-17). The parser reads no DTD and knows only the five
// entities that XML predefines, so that a stranger's document can neither make it
// fetch an entity nor expand one; only the first items of a feed, up to a bound, are
// read.
import { SaxesParser } from 'saxes';

import { parseTimestamp } from '@/lib/time';

import type { PressFeedsError } from './errors';
import type { Feed, FeedItem } from './types';
import type { ParsedTimestamp } from '@/lib/time';
import type { SaxesAttributeNS, SaxesTagNS } from 'saxes';

/** The most items read of one feed: its first ones, in the feed's order (COL-46). */
export const MAX_FEED_ITEMS = 500;

/** What a body holds: a feed, or the failure of a body that holds none. */
export type FeedDocument =
  Readonly<{ ok: true; feed: Feed }> | Readonly<{ ok: false; error: PressFeedsError }>;

// The depth of the deepest element read apart: Atom's feed > entry > source > title.
// A deeper one, such as the XHTML of an Atom summary, gives its text to its kept
// ancestors, each of which gathers the text of everything it holds.
const KEPT_DEPTH = 4;
// The XML declaration, which may name the encoding, sits at the very start of a body.
const DECLARATION_BYTES = 200;
const CHARSET = /charset\s*=\s*"?(?<label>[^";\s]+)/iu;
const XML_ENCODING = /^<\?xml[^>]+encoding\s*=\s*["'](?<label>[\w.:-]+)/u;
const WEB_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

const ATOM = 'http://www.w3.org/2005/Atom';
const RSS_1 = 'http://purl.org/rss/1.0/';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const DC = 'http://purl.org/dc/elements/1.1/';
// eslint-disable-next-line unicorn/prefer-https -- a namespace is a name that XML compares as written, not an address to request
const CONTENT = 'http://purl.org/rss/1.0/modules/content/';
const XML = 'http://www.w3.org/XML/1998/namespace';

/** A name in its namespace: the namespace's URI, empty for none, and the local name. */
type Name = readonly [uri: string, local: string];

// Where each field of an item is, by the names that carry it, the earlier ones first.
const IDENTIFIER: readonly Name[] = [
  ['', 'guid'],
  [ATOM, 'id'],
];
const LINK: readonly Name[] = [
  ['', 'link'],
  [RSS_1, 'link'],
];
const TITLE: readonly Name[] = [
  ['', 'title'],
  [RSS_1, 'title'],
  [ATOM, 'title'],
];
const PUBLISHED: readonly Name[] = [
  ['', 'pubDate'],
  [ATOM, 'published'],
  [DC, 'date'],
];
const UPDATED: readonly Name[] = [[ATOM, 'updated']];
const LANGUAGE: readonly Name[] = [
  ['', 'language'],
  [DC, 'language'],
];
// RSS's source names the outlet; Atom's names its feed, whose title is the outlet (COL-06).
const RSS_SOURCE: readonly Name[] = [['', 'source']];
const ATOM_SOURCE: readonly Name[] = [[ATOM, 'source']];
const ATOM_TITLE: readonly Name[] = [[ATOM, 'title']];
// The summary, else the content of an item that gives no summary (COL-27).
const EXCERPT: readonly Name[] = [
  ['', 'description'],
  [RSS_1, 'description'],
  [ATOM, 'summary'],
  [CONTENT, 'encoded'],
  [ATOM, 'content'],
];
const ATOM_LINK: Name = [ATOM, 'link'];
const XML_LANG: Name = [XML, 'lang'];
const XML_BASE: Name = [XML, 'base'];
const RDF_ABOUT: Name = [RDF, 'about'];
const HREF: Name = ['', 'href'];
const REL: Name = ['', 'rel'];

/** A syndication format: its root element, its channel (none in Atom) and its items. */
type Format = Readonly<{ root: Name; channel: Name | null; item: Name; itemsInChannel: boolean }>;

const FORMATS: readonly Format[] = [
  { root: ['', 'rss'], channel: ['', 'channel'], item: ['', 'item'], itemsInChannel: true },
  { root: [RDF, 'RDF'], channel: [RSS_1, 'channel'], item: [RSS_1, 'item'], itemsInChannel: false },
  { root: [ATOM, 'feed'], channel: null, item: [ATOM, 'entry'], itemsInChannel: false },
];

/** An element of a document, down to the kept depth: its name, its attributes, its elements and its whole text. */
type XmlElement = Readonly<{
  uri: string;
  local: string;
  attributes: readonly SaxesAttributeNS[];
  children: XmlElement[];
  text: string[];
}>;

const UNREADABLE: FeedDocument = { ok: false, error: { kind: 'unreadable' } };
const NOT_A_FEED: FeedDocument = { ok: false, error: { kind: 'not_a_feed' } };

const hasName = (element: XmlElement, [uri, local]: Name): boolean =>
  element.uri === uri && element.local === local;

/** The first child of `element` that carries one of `names`, the earlier names first. */
const childOf = (element: XmlElement | undefined, names: readonly Name[]): XmlElement | undefined =>
  names
    .map((name) => element?.children.find((child) => hasName(child, name)))
    .find((child) => child !== undefined);

const attributeOf = (element: XmlElement | undefined, [uri, local]: Name): string | null =>
  element?.attributes.find((attribute) => attribute.uri === uri && attribute.local === local)
    ?.value ?? null;

/** `text` trimmed, or null when nothing is left. */
function trimmed(text: string | null | undefined): string | null {
  const value = text?.trim() ?? '';
  return value === '' ? null : value;
}

/** The text of `element` and of everything it holds, trimmed, or null when it has none. */
const textOf = (element: XmlElement | undefined): string | null => trimmed(element?.text.join(''));

/** The language that `element` declares, by a language element or by its `xml:lang` (COL-17). */
const languageOf = (element: XmlElement | undefined): string | null =>
  textOf(childOf(element, LANGUAGE)) ?? trimmed(attributeOf(element, XML_LANG));

const dateOf = (text: string | null): ParsedTimestamp | null => {
  const parsed = text === null ? null : parseTimestamp(text);
  return parsed?.ok === true ? parsed.timestamp : null;
};

/**
 * `text` as an absolute web address, resolved against `base`, or null when it is not
 * one: a feed's address, the target of a redirect or the link of an item (COL-26).
 */
export function webAddress(text: string | null, base?: string): string | null {
  const url = text === null ? null : URL.parse(text.trim(), base);
  return url !== null && WEB_PROTOCOLS.has(url.protocol) ? url.href : null;
}

/**
 * The address of an item: RSS's link, else Atom's alternate link, made absolute against
 * the document's address and the `xml:base` of the elements around it.
 */
function linkOf(
  item: XmlElement,
  around: readonly (XmlElement | undefined)[],
  address: string,
): string | null {
  const alternate = item.children.find(
    (child) =>
      hasName(child, ATOM_LINK) && (attributeOf(child, REL) ?? 'alternate') === 'alternate',
  );
  const href = textOf(childOf(item, LINK)) ?? attributeOf(alternate, HREF);
  let base = address;
  for (const element of [...around, item, alternate]) {
    base = webAddress(attributeOf(element, XML_BASE), base) ?? base;
  }
  return webAddress(href, base);
}

/** An item as the feed gives it, each field null when the item lacks it (COL-06, COL-17, COL-19, COL-27, CL-COL-01). */
function itemOf(
  item: XmlElement,
  around: readonly (XmlElement | undefined)[],
  address: string,
): FeedItem {
  const textAt = (names: readonly Name[]): string | null => textOf(childOf(item, names));
  return {
    identifier: textAt(IDENTIFIER) ?? trimmed(attributeOf(item, RDF_ABOUT)),
    link: linkOf(item, around, address),
    title: textAt(TITLE),
    publishedAt: dateOf(textAt(PUBLISHED)),
    updatedAt: dateOf(textAt(UPDATED)),
    language: languageOf(item),
    originOutlet: textAt(RSS_SOURCE) ?? textOf(childOf(childOf(item, ATOM_SOURCE), ATOM_TITLE)),
    excerpt: textAt(EXCERPT),
  };
}

/** The feed of a document in `format`: its language and its first items. */
function feedOf(root: XmlElement, format: Format, address: string): Feed {
  const channel = format.channel === null ? undefined : childOf(root, [format.channel]);
  const items = ((format.itemsInChannel ? channel : root)?.children ?? [])
    .filter((child) => hasName(child, format.item))
    .slice(0, MAX_FEED_ITEMS);
  return {
    language: languageOf(channel) ?? languageOf(root),
    items: items.map((item) => itemOf(item, [root, channel], address)),
  };
}

/** The elements of `text` down to the kept depth, and the number of errors the parser met. */
function elementsOf(text: string): Readonly<{ roots: readonly XmlElement[]; errors: number }> {
  const parser = new SaxesParser({ xmlns: true });
  const roots: XmlElement[] = [];
  const open: XmlElement[] = [];
  let depth = 0;
  let errors = 0;
  const gather = (chunk: string): void => {
    for (const element of open) {
      element.text.push(chunk);
    }
  };
  parser.on('error', () => {
    errors += 1;
  });
  parser.on('opentag', ({ uri, local, attributes }: SaxesTagNS) => {
    depth += 1;
    if (depth > KEPT_DEPTH) {
      return;
    }
    const element: XmlElement = {
      uri,
      local,
      attributes: Object.values(attributes),
      children: [],
      text: [],
    };
    (open.at(-1)?.children ?? roots).push(element);
    open.push(element);
  });
  parser.on('closetag', () => {
    if (depth <= KEPT_DEPTH) {
      open.pop();
    }
    depth -= 1;
  });
  parser.on('text', gather);
  parser.on('cdata', gather);
  parser.write(text).close();
  return { roots, errors };
}

/** The text of a body in the charset of its answer, else that of its XML declaration, else UTF-8; null when it is none. */
function decoded(bytes: Uint8Array, contentType: string | null): string | null {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, DECLARATION_BYTES));
  const label =
    CHARSET.exec(contentType ?? '')?.groups?.['label'] ??
    XML_ENCODING.exec(head.trimStart())?.groups?.['label'];
  try {
    // Without a label, the decoder reads UTF-8, the encoding of an XML document that names none.
    return new TextDecoder(label, { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * The feed that the body of an answer at `address` holds (COL-41, TRV-17): not a feed
 * when its root is no syndication format's, or when it has none; unreadable when it is
 * not text in its charset or not well-formed XML, a reference to an entity other than
 * XML's five included, whether a DTD declares it or not.
 */
export function feedIn(
  bytes: Uint8Array,
  contentType: string | null,
  address: string,
): FeedDocument {
  const text = decoded(bytes, contentType);
  if (text === null) {
    return UNREADABLE;
  }
  // Whitespace before the XML declaration, which some servers write, is not the feed's.
  const { roots, errors } = elementsOf(text.trimStart());
  const [root] = roots;
  const format = FORMATS.find((candidate) => root !== undefined && hasName(root, candidate.root));
  if (root === undefined || format === undefined) {
    return NOT_A_FEED;
  }
  return errors === 0 ? { ok: true, feed: feedOf(root, format, address) } : UNREADABLE;
}
