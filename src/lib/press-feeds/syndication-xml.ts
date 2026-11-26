// The documents of the syndication adapter (syndication.ts): the body of a feed's
// answer, decoded in its charset and parsed by a strict XML parser into an RSS 2.0,
// RSS 1.0 or Atom feed (TRV-17). The parser reads no DTD and knows only the five
// entities that XML predefines, so that a stranger's document can neither make it
// fetch an entity nor expand one. It stops at the first error, an element nested past a
// bound included, and keeps only the elements and attributes that the reader looks up,
// among them the first items of a feed, up to a bound.
import { SaxesParser } from 'saxes';

import { parseTimestamp } from '@/lib/time';

import type { PressFeedsError } from './errors';
import type { Feed, FeedItem } from './types';
import type { ParsedTimestamp } from '@/lib/time';
import type { SaxesAttributeNS, SaxesTagNS } from 'saxes';

/** The most items read of one feed: its first ones, in the feed's order (COL-46). */
export const MAX_FEED_ITEMS = 500;

/**
 * The deepest nesting of elements read, the root at depth 1: a feed nests four or five,
 * the XHTML of an Atom summary a few more, and a deeper document is unreadable (TRV-17).
 * The parser's cost for each element grows with its depth, so the bound keeps the read
 * of a body of up to the byte bound short.
 */
export const MAX_FEED_DEPTH = 64;

/** What a body holds: a feed, or the failure of a body that holds none. */
export type FeedDocument =
  Readonly<{ ok: true; feed: Feed }> | Readonly<{ ok: false; error: PressFeedsError }>;

// The characters given to the parser at a time: a handler cannot stop the parser within
// a write, so a document that fails, by an error or by a nesting past the depth bound,
// is dropped at the end of the slice in which it does, a few thousand characters later.
const PARSE_SLICE_CHARS = 4096;
// The XML declaration, which may name the encoding, sits at the very start of a body.
const DECLARATION_BYTES = 200;
const CHARSET = /charset\s*=\s*"?(?<label>[^";\s]+)/iu;
const XML_ENCODING = /^<\?xml[^>]+encoding\s*=\s*["'](?<label>[\w.:-]+)/u;
// The start tag of a syndication format's root, wherever a broken document holds it:
// `<rss`, or `<feed` or `<RDF` with a prefix or without, then XML whitespace, `>` or `/`.
// A prefix holds neither `<` nor `:`, so that one scan of a text stays linear in its length.
const SYNDICATION_ROOT_TAG = /<(?:rss|(?:[A-Z_a-z][\w.-]*:)?(?:feed|RDF))[\t\n\r />]/u;
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
// The summary, else the content of an item that gives no summary (COL-27).
const EXCERPT: readonly Name[] = [
  ['', 'description'],
  [RSS_1, 'description'],
  [ATOM, 'summary'],
  [CONTENT, 'encoded'],
  [ATOM, 'content'],
];
const FIELDS = [IDENTIFIER, LINK, TITLE, PUBLISHED, UPDATED, LANGUAGE, RSS_SOURCE, EXCERPT];
const ATOM_SOURCE: Name = [ATOM, 'source'];
const ATOM_TITLE: Name = [ATOM, 'title'];
const ATOM_LINK: Name = [ATOM, 'link'];
const XML_LANG: Name = [XML, 'lang'];
const XML_BASE: Name = [XML, 'base'];
const RDF_ABOUT: Name = [RDF, 'about'];
const HREF: Name = ['', 'href'];
const REL: Name = ['', 'rel'];
// The attributes that the reader looks up, the only ones that an element keeps.
const ATTRIBUTES: readonly Name[] = [XML_LANG, XML_BASE, RDF_ABOUT, HREF, REL];

/** A syndication format: its root element, its channel (none in Atom) and its items. */
type Format = Readonly<{ root: Name; channel: Name | null; item: Name; itemsInChannel: boolean }>;

const FORMATS: readonly Format[] = [
  { root: ['', 'rss'], channel: ['', 'channel'], item: ['', 'item'], itemsInChannel: true },
  { root: [RDF, 'RDF'], channel: [RSS_1, 'channel'], item: [RSS_1, 'item'], itemsInChannel: false },
  { root: [ATOM, 'feed'], channel: null, item: [ATOM, 'entry'], itemsInChannel: false },
];

/** What a kept element is to the reader. A field is the one kind that keeps its text. */
type Role = 'root' | 'channel' | 'item' | 'source' | 'field';

/** An element that the reader looks up in a parent: its name, its role, how many of it the parent keeps, and which. */
type Lookup = Readonly<{ name: Name; role: Role; most: number; accepts?: Accepts }>;
type Accepts = (element: XmlElement) => boolean;

/**
 * A kept element: its name, its role, the attributes that the reader looks up, its kept
 * elements and how many it kept of each lookup, and, for a field, the text of everything
 * it holds.
 */
type XmlElement = Readonly<{
  uri: string;
  local: string;
  role: Role;
  attributes: readonly SaxesAttributeNS[];
  children: XmlElement[];
  counts: Map<Lookup, number>;
  text: string[];
}>;

const UNREADABLE: FeedDocument = { ok: false, error: { kind: 'unreadable' } };
const NOT_A_FEED: FeedDocument = { ok: false, error: { kind: 'not_a_feed' } };

const hasName = (named: Readonly<{ uri: string; local: string }>, [uri, local]: Name): boolean =>
  named.uri === uri && named.local === local;

/** The first child of `element` that carries one of `names`, the earlier names first. */
const childOf = (element: XmlElement | undefined, names: readonly Name[]): XmlElement | undefined =>
  names
    .map((name) => element?.children.find((child) => hasName(child, name)))
    .find((child) => child !== undefined);

const attributeOf = (element: XmlElement | undefined, name: Name): string | null =>
  element?.attributes.find((attribute) => hasName(attribute, name))?.value ?? null;

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
  const alternate = childOf(item, [ATOM_LINK]);
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
    originOutlet: textAt(RSS_SOURCE) ?? textOf(childOf(childOf(item, [ATOM_SOURCE]), [ATOM_TITLE])),
    excerpt: textAt(EXCERPT),
  };
}

/** The feed of a document in `format`: its language and its first items. */
function feedOf(root: XmlElement, format: Format, address: string): Feed {
  const channel = format.channel === null ? undefined : childOf(root, [format.channel]);
  const items = ((format.itemsInChannel ? channel : root)?.children ?? []).filter((child) =>
    hasName(child, format.item),
  );
  return {
    language: languageOf(channel) ?? languageOf(root),
    items: items.map((item) => itemOf(item, [root, channel], address)),
  };
}

/** The first element of a name in a parent, in `role`. */
const first =
  (role: Role) =>
  (name: Name): Lookup => ({ name, role, most: 1 });
const isAlternate = (link: XmlElement): boolean =>
  (attributeOf(link, REL) ?? 'alternate') === 'alternate';

/**
 * What the reader looks up in the kept elements of a document in `format`, by their role:
 * in the root and the channel, the channel, the items up to the bound (COL-46) and the
 * language; in an item, the first element of each name of a field, the first alternate
 * link and the source; in a source, its title. A field keeps no element.
 */
function lookupsOf({ channel, item, itemsInChannel }: Format): Partial<Record<Role, Lookup[]>> {
  const items: Lookup[] = [{ name: item, role: 'item', most: MAX_FEED_ITEMS }];
  const channels = channel === null ? [] : [first('channel')(channel)];
  const languages = LANGUAGE.map(first('field'));
  return {
    root: [...channels, ...(itemsInChannel ? [] : items), ...languages],
    channel: [...(itemsInChannel ? items : []), ...languages],
    item: [
      ...FIELDS.flat().map(first('field')),
      { name: ATOM_LINK, role: 'field', most: 1, accepts: isAlternate },
      first('source')(ATOM_SOURCE),
    ],
    source: [first('field')(ATOM_TITLE)],
  };
}

/** A new kept element for `tag` in `role`, with the attributes that the reader looks up, as yet with no elements and no text. */
const elementOf = ({ uri, local, attributes }: SaxesTagNS, role: Role): XmlElement => ({
  uri,
  local,
  role,
  attributes: Object.values(attributes).filter((attribute) =>
    ATTRIBUTES.some((name) => hasName(attribute, name)),
  ),
  children: [],
  counts: new Map(),
  text: [],
});

/** A document in a syndication format: its root, as far as it is kept, and its format. */
type KeptFeed = Readonly<{ root: XmlElement; format: Format }>;

/**
 * The elements of a document that the reader looks up below a syndication root, kept as
 * the parser meets them, and the errors met on the way. Once an error is met, the answer
 * no longer depends on the elements, and the parse ends with the slice.
 */
class Outline {
  // The kept elements around the parser's position, from the root.
  readonly #open: XmlElement[] = [];
  #lookups: Partial<Record<Role, Lookup[]>> = {};
  #depth = 0;
  #errors = 0;
  // The syndication root of the document and the elements kept below it, if it has one.
  feed: KeptFeed | undefined;

  /** The root of a document in a syndication format, whose format says what is kept below it. */
  #root(tag: SaxesTagNS): XmlElement | undefined {
    const format = FORMATS.find(({ root }) => hasName(tag, root));
    if (format === undefined) {
      return undefined;
    }
    const root = elementOf(tag, 'root');
    this.feed = { root, format };
    this.#lookups = lookupsOf(format);
    return root;
  }

  /** An element that the reader looks up in `parent`, unless `parent` keeps it already as often as it may. */
  #child(parent: XmlElement, tag: SaxesTagNS): XmlElement | undefined {
    const lookup = this.#lookups[parent.role]?.find(({ name }) => hasName(tag, name));
    if (lookup === undefined) {
      return undefined;
    }
    const element = elementOf(tag, lookup.role);
    const count = parent.counts.get(lookup) ?? 0;
    if (count >= lookup.most || lookup.accepts?.(element) === false) {
      return undefined;
    }
    parent.counts.set(lookup, count + 1);
    parent.children.push(element);
    return element;
  }

  /** The errors met, each element nested past the depth bound counted as one. */
  get errors(): number {
    return this.#errors;
  }

  fail(): void {
    this.#errors += 1;
  }

  /** Keeps a syndication root, or an element that the reader looks up in a kept one. */
  open(tag: SaxesTagNS): void {
    this.#depth += 1;
    if (this.#depth > MAX_FEED_DEPTH) {
      this.fail();
    }
    // An element below one that is not kept is not kept either.
    if (this.#depth !== this.#open.length + 1) {
      return;
    }
    const parent = this.#open.at(-1);
    const element = parent === undefined ? this.#root(tag) : this.#child(parent, tag);
    if (element !== undefined) {
      this.#open.push(element);
    }
  }

  close(): void {
    if (this.#depth === this.#open.length) {
      this.#open.pop();
    }
    this.#depth -= 1;
  }

  /** Gives `chunk` to the kept field around it, if any, which gathers the text of everything it holds. */
  gather(chunk: string): void {
    const element = this.#open.at(-1);
    if (element?.role === 'field') {
      element.text.push(chunk);
    }
  }
}

/**
 * The outline of `text` (TRV-17): its syndication root and the elements kept below it,
 * and the number of errors that the parser met. The parser takes `text` a slice at a
 * time and stops after the slice of the first error, which settles the answer, so that a
 * document full of errors, or one nested past the depth bound, whose cost would grow with
 * the square of its depth, costs a slice or two.
 */
export function outlineOf(text: string): Readonly<{ feed: KeptFeed | undefined; errors: number }> {
  const parser = new SaxesParser({ xmlns: true });
  const outline = new Outline();
  const gather = (chunk: string): void => {
    outline.gather(chunk);
  };
  parser.on('error', () => {
    outline.fail();
  });
  parser.on('opentag', (tag: SaxesTagNS) => {
    outline.open(tag);
  });
  parser.on('closetag', () => {
    outline.close();
  });
  parser.on('text', gather);
  parser.on('cdata', gather);
  for (let start = 0; start < text.length && outline.errors === 0; start += PARSE_SLICE_CHARS) {
    parser.write(text.slice(start, start + PARSE_SLICE_CHARS));
  }
  parser.close();
  return { feed: outline.feed, errors: outline.errors };
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
 * The feed that the body of an answer at `address` holds (COL-41, TRV-17), by one rule:
 * - a body that is not text in its charset is unreadable;
 * - a document that the parser reads to its end without an error is judged by its root
 *   element: the root of a syndication format is read as a feed, any other root is not a
 *   feed;
 * - a document with a parse error (XML that is not well-formed, a reference to an entity
 *   other than XML's five, an element nested past the depth bound) is unreadable when its
 *   text holds the start tag of a syndication format's root anywhere, and not a feed when
 *   it holds none. The parse stops at the first error, and what came before that error,
 *   such as a server's warning or a byte order mark under another charset, does not count.
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
  const { feed, errors } = outlineOf(text.trimStart());
  if (errors > 0) {
    return SYNDICATION_ROOT_TAG.test(text) ? UNREADABLE : NOT_A_FEED;
  }
  return feed === undefined
    ? NOT_A_FEED
    : { ok: true, feed: feedOf(feed.root, feed.format, address) };
}
