// Every address of these tables is only judged, never contacted.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { addressKind } from './address-rules';

import type { AddressKind } from './address-rules';

/** Each neighbor of `neighbors`, judged public. */
const allPublic = (neighbors: readonly string[]) =>
  Object.fromEntries(neighbors.map((neighbor) => [neighbor, 'public']));

/** Each neighbor of `neighbors`, as `addressKind` judges it. */
const judged = (neighbors: readonly string[]) =>
  Object.fromEntries(neighbors.map((neighbor) => [neighbor, addressKind(neighbor)]));

/** The host of `address`, an IPv6 address, as the URL parser writes it: compressed hexadecimal. */
const canonical = (address: string): string =>
  new URL(`http://[${address}]/`).hostname.slice(1, -1);

const hexGroup = (high: number, low: number): string => ((high << 8) | low).toString(16);

// Each IPv4 block: its first and last addresses, its kind, and its neighbors outside it
// that lie in no other refused block (none below 0.0.0.0/8 or above 240.0.0.0/4, and
// 224.0.0.0/4 and 240.0.0.0/4 touch).
const IPV4_BLOCKS: readonly (readonly [string, string, AddressKind, readonly string[]])[] = [
  ['0.0.0.0', '0.255.255.255', 'this-network', ['1.0.0.0']],
  ['10.0.0.0', '10.255.255.255', 'private-use', ['9.255.255.255', '11.0.0.0']],
  ['100.64.0.0', '100.127.255.255', 'shared', ['100.63.255.255', '100.128.0.0']],
  ['127.0.0.0', '127.255.255.255', 'loopback', ['126.255.255.255', '128.0.0.0']],
  ['169.254.0.0', '169.254.255.255', 'link-local', ['169.253.255.255', '169.255.0.0']],
  ['172.16.0.0', '172.31.255.255', 'private-use', ['172.15.255.255', '172.32.0.0']],
  ['192.0.0.0', '192.0.0.255', 'protocol-assignments', ['191.255.255.255', '192.0.1.0']],
  ['192.0.2.0', '192.0.2.255', 'documentation', ['192.0.1.255', '192.0.3.0']],
  ['192.88.99.0', '192.88.99.255', 'deprecated', ['192.88.98.255', '192.88.100.0']],
  ['192.168.0.0', '192.168.255.255', 'private-use', ['192.167.255.255', '192.169.0.0']],
  ['198.18.0.0', '198.19.255.255', 'benchmarking', ['198.17.255.255', '198.20.0.0']],
  ['198.51.100.0', '198.51.100.255', 'documentation', ['198.51.99.255', '198.51.101.0']],
  ['203.0.113.0', '203.0.113.255', 'documentation', ['203.0.112.255', '203.0.114.0']],
  ['224.0.0.0', '239.255.255.255', 'multicast', ['223.255.255.255']],
  // The broadcast address, 255.255.255.255, is the last of the reserved block.
  ['240.0.0.0', '255.255.255.255', 'reserved', []],
];

// Each IPv6 block: its first and last addresses, and its kind.
const IPV6_BLOCKS: readonly (readonly [string, string, AddressKind])[] = [
  ['::', '::', 'unspecified'],
  ['::1', '::1', 'loopback'],
  ['64:ff9b:1::', '64:ff9b:1:ffff:ffff:ffff:ffff:ffff', 'local-translation'],
  ['100::', '100::ffff:ffff:ffff:ffff', 'discard-only'],
  ['100:0:0:1::', '100::1:ffff:ffff:ffff:ffff', 'dummy'],
  ['2001::', '2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff', 'protocol-assignments'],
  ['2001:db8::', '2001:db8:ffff:ffff:ffff:ffff:ffff:ffff', 'documentation'],
  ['3fff::', '3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff', 'documentation'],
  ['5f00::', '5f00:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'segment-routing'],
  ['fc00::', 'fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'unique-local'],
  ['fe80::', 'febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'link-local'],
  // The site-local block (RFC 3879).
  ['fec0::', 'feff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'deprecated'],
  ['ff00::', 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'multicast'],
];

// The neighbors that lie in no refused block on each side of every refused IPv6 block
// inside the global unicast block 2000::/3 (RFC 4291), and that of :: and ::1, which
// touch: ::2 is the IPv4-compatible address of 0.0.0.2, so their neighbor is ::100:0,
// that of 1.0.0.0.
const IPV6_NEIGHBORS: readonly (readonly [string, readonly string[]])[] = [
  ['::/128 and ::1/128', ['::100:0']],
  ['2001::/23', ['2000:ffff:ffff:ffff:ffff:ffff:ffff:ffff', '2001:200::']],
  ['2001:db8::/32', ['2001:db7:ffff:ffff:ffff:ffff:ffff:ffff', '2001:db9::']],
  ['3fff::/20', ['3ffe:ffff:ffff:ffff:ffff:ffff:ffff:ffff', '3fff:1000::']],
];

// The edges of the global unicast block 2000::/3, which holds every public IPv6 address
// that holds no IPv4 one, and its neighbors outside it.
const GLOBAL_UNICAST_EDGES: readonly (readonly [string, AddressKind])[] = [
  ['2000::', 'public'],
  ['3fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'public'],
  ['1fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'reserved'],
  ['4000::', 'reserved'],
];

// Addresses outside 2000::/3 that hold no IPv4 address: the neighbors of the refused
// blocks outside it, and the forms that a system may still route. Each one is refused,
// as `reserved` unless it lies in a refused block, whose kind it keeps.
const OUTSIDE_GLOBAL_UNICAST: readonly (readonly [string, string, AddressKind])[] = [
  ['64:ff9b:0:ffff:ffff:ffff:ffff:ffff', 'below 64:ff9b:1::/48', 'reserved'],
  ['64:ff9b:2::', 'above 64:ff9b:1::/48', 'reserved'],
  ['ff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'below 100::/64', 'reserved'],
  ['100:0:0:2::', 'above 100:0:0:1::/64', 'reserved'],
  ['5eff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'below 5f00::/16', 'reserved'],
  ['5f01::', 'above 5f00::/16', 'reserved'],
  ['fbff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'below fc00::/7', 'reserved'],
  ['fe00::', 'above fc00::/7', 'reserved'],
  ['fe7f:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'below fe80::/10', 'reserved'],
  ['fec0::', 'above fe80::/10, site-local', 'deprecated'],
  ['feff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'below ff00::/8, site-local', 'deprecated'],
  ['fec0::1', 'a site-local address', 'deprecated'],
  ['4000::1', 'an address of no special-purpose block', 'reserved'],
  ['::ffff:0:7f00:1', 'a SIIT address, outside the IPv4-mapped block', 'reserved'],
];

// IPv6 addresses that hold an IPv4 one, in two written forms each, and the kind of
// the IPv4 address they hold. The dotted tail of a 6to4 address is its interface, not
// the address it holds. An IPv4-compatible, IPv4-mapped or NAT64 address lies outside
// 2000::/3, yet one that holds a public IPv4 address, such as ::ffff:11.0.0.1, stays
// public: it is judged by that IPv4 address alone, which is where it leads.
const EMBEDDED: readonly (readonly [string, string, AddressKind])[] = [
  ['::127.0.0.1', '::7f00:1', 'loopback'],
  ['::0.0.0.2', '::2', 'this-network'],
  ['::11.0.0.1', '0:0:0:0:0:0:b00:1', 'public'],
  ['::ffff:10.0.0.1', '::ffff:a00:1', 'private-use'],
  ['::FFFF:127.0.0.1', '0:0:0:0:0:FFFF:7F00:0001', 'loopback'],
  ['::ffff:11.0.0.1', '::ffff:b00:1', 'public'],
  ['64:ff9b::169.254.169.254', '64:ff9b::a9fe:a9fe', 'link-local'],
  ['64:ff9b::11.0.0.1', '64:ff9b:0:0:0:0:b00:1', 'public'],
  ['2002:a00:1::11.0.0.1', '2002:0a00:0001:0000:0000:0000:0b00:0001', 'private-use'],
  ['2002:b00:1::10.0.0.1', '2002:b00:1::a00:1', 'public'],
  ['2002:7f00:1::', '2002:7f00:0001:0000:0000:0000:0000:0000', 'loopback'],
];

const IPV6_GROUP_COUNT = 8;
const GROUP_BITS = 16n;
const GROUP_MASK = 0xff_ffn;
const IPV6_MAX = (1n << 128n) - 1n;
const IPV4_MASK = 0xff_ff_ff_ffn;
const IPV4_OCTET_BITS = 8n;
const IPV4_OCTET_MASK = 0xffn;
const HOLDER_FILLER_BITS = 80n;
const SIX_TO_FOUR_PREFIX_BITS = 112n;
// The global unicast block 2000::/3: the addresses whose three top bits are 001.
const GLOBAL_UNICAST_FIRST = 1n << 125n;
const GLOBAL_UNICAST_LAST = (2n << 125n) - 1n;

/** The hexadecimal groups of one side of a `::`. */
const groupsOfSide = (side: string): string[] => (side === '' ? [] : side.split(':'));

/** The value of an IPv6 address written in hexadecimal groups, with or without one `::`, and no dotted tail. */
const ipv6Number = (text: string): bigint => {
  const [head = '', tail = ''] = text.split('::', 2);
  const before = groupsOfSide(head);
  const after = groupsOfSide(tail);
  const zeros = Array.from({ length: IPV6_GROUP_COUNT - before.length - after.length }, () => '0');
  return [...before, ...zeros, ...after].reduce(
    (value, group) => (value << GROUP_BITS) | BigInt(`0x${group}`),
    0n,
  );
};

/** The eight 16-bit groups of `value`, written in hexadecimal and joined by colons. */
const ipv6Text = (value: bigint): string =>
  Array.from({ length: IPV6_GROUP_COUNT }, (_, index) =>
    ((value >> (GROUP_BITS * BigInt(IPV6_GROUP_COUNT - 1 - index))) & GROUP_MASK).toString(16),
  ).join(':');

/** The dotted-quad IPv4 address of the 32-bit `value`. */
const ipv4Text = (value: bigint): string =>
  [3n, 2n, 1n, 0n]
    .map((octet) => String((value >> (octet * IPV4_OCTET_BITS)) & IPV4_OCTET_MASK))
    .join('.');

/**
 * The blocks of IPv6 addresses that hold an IPv4 address, each with the range it covers,
 * where it keeps the IPv4 address, and how to write an address of it holding a given one.
 */
const IPV4_HOLDERS: readonly Readonly<{
  first: bigint;
  last: bigint;
  held: (address: bigint) => bigint;
  place: (ipv4: bigint, filler: bigint) => bigint;
}>[] = [
  // IPv4-compatible, ::/96.
  { first: 0n, last: IPV4_MASK, held: (a) => a & IPV4_MASK, place: (ipv4) => ipv4 },
  // IPv4-mapped, ::ffff:0:0/96.
  {
    first: 0xff_ffn << 32n,
    last: (0xff_ffn << 32n) | IPV4_MASK,
    held: (a) => a & IPV4_MASK,
    place: (ipv4) => (0xff_ffn << 32n) | ipv4,
  },
  // NAT64, 64:ff9b::/96.
  {
    first: 0x00_64_ff_9bn << 96n,
    last: (0x00_64_ff_9bn << 96n) | IPV4_MASK,
    held: (a) => a & IPV4_MASK,
    place: (ipv4) => (0x00_64_ff_9bn << 96n) | ipv4,
  },
  // 6to4, 2002::/16: the IPv4 address follows the prefix.
  {
    first: 0x20_02n << SIX_TO_FOUR_PREFIX_BITS,
    last: (0x20_02n << SIX_TO_FOUR_PREFIX_BITS) | ((1n << SIX_TO_FOUR_PREFIX_BITS) - 1n),
    held: (a) => (a >> HOLDER_FILLER_BITS) & IPV4_MASK,
    place: (ipv4, filler) =>
      (0x20_02n << SIX_TO_FOUR_PREFIX_BITS) | (ipv4 << HOLDER_FILLER_BITS) | filler,
  },
];

/** The refused IPv6 blocks as the tables above write them: first and last value, and kind. */
const REFUSED_RANGES = IPV6_BLOCKS.map(
  ([first, last, kind]) => [ipv6Number(first), ipv6Number(last), kind] as const,
);

/** What an address that lies in a refused block, holds an IPv4 address or lies in none, must be judged. */
type Oracle = Readonly<{ kind: AddressKind; source: 'refused' | 'held' | 'complement' }>;

/**
 * The verdict of the rule, written from its definition and from the tables of this file
 * alone: a refused block gives its kind, an IPv4-holding block the kind of the IPv4 address
 * it holds, and any other address is public inside 2000::/3 and reserved outside it.
 */
const oracle = (address: bigint): Oracle => {
  const refused = REFUSED_RANGES.find(([first, last]) => address >= first && address <= last);
  if (refused !== undefined) {
    return { kind: refused[2], source: 'refused' };
  }
  const holder = IPV4_HOLDERS.find(({ first, last }) => address >= first && address <= last);
  if (holder !== undefined) {
    return { kind: addressKind(ipv4Text(holder.held(address))), source: 'held' };
  }
  const isGlobalUnicast = address >= GLOBAL_UNICAST_FIRST && address <= GLOBAL_UNICAST_LAST;
  return { kind: isGlobalUnicast ? 'public' : 'reserved', source: 'complement' };
};

const clamped = (value: bigint): bigint => {
  if (value < 0n) {
    return 0n;
  }
  return value > IPV6_MAX ? IPV6_MAX : value;
};

/** First, last, one below and one above of every range of the rule: where a wrong edge shows. */
const RANGE_EDGES: readonly bigint[] = [
  ...REFUSED_RANGES.map(([first, last]) => [first, last] as const),
  ...IPV4_HOLDERS.map(({ first, last }) => [first, last] as const),
  [GLOBAL_UNICAST_FIRST, GLOBAL_UNICAST_LAST] as const,
].flatMap(([first, last]) => [first - 1n, first, last, last + 1n].map((value) => clamped(value)));

// The first octets of the refused IPv4 blocks, which a uniform draw of 32 bits seldom hits.
const REFUSED_IPV4_OCTETS = [0n, 10n, 100n, 127n, 169n, 172n, 192n, 198n, 224n, 240n, 255n];
const IPV4_LOW_BITS = 24n;
const EIGHTHS_OF_SPACE = 8;
const EIGHTH_SHIFT_BITS = 125n;

/** A 32-bit value, uniform or in a refused IPv4 block. */
const heldIpv4 = fc.oneof(
  fc.bigInt({ min: 0n, max: IPV4_MASK }),
  fc
    .tuple(
      fc.constantFrom(...REFUSED_IPV4_OCTETS),
      fc.bigInt({ min: 0n, max: (1n << IPV4_LOW_BITS) - 1n }),
    )
    .map(([octet, rest]) => (octet << IPV4_LOW_BITS) | rest),
);

/** Addresses of the whole 128-bit space, with a share at the edges, in 2000::/3 and in IPv4-holding blocks. */
const ipv6Values = fc.oneof(
  { arbitrary: fc.bigInt({ min: 0n, max: IPV6_MAX }), weight: 3 },
  { arbitrary: fc.constantFrom(...RANGE_EDGES), weight: 3 },
  {
    arbitrary: fc
      .bigInt({ min: 0n, max: GLOBAL_UNICAST_FIRST - 1n })
      .map((rest) => GLOBAL_UNICAST_FIRST | rest),
    weight: 2,
  },
  {
    arbitrary: fc
      .tuple(
        fc.constantFrom(...IPV4_HOLDERS),
        heldIpv4,
        fc.bigInt({ min: 0n, max: (1n << HOLDER_FILLER_BITS) - 1n }),
      )
      .map(([holder, ipv4, filler]) => holder.place(ipv4, filler)),
    weight: 2,
  },
);

// The first octets of which every IPv4 address is refused, and of which every one is public.
const FULLY_REFUSED_IPV4_OCTETS = [0n, 10n, 127n, 224n, 240n, 255n];
const FULLY_PUBLIC_IPV4_OCTETS = [8n, 9n, 11n, 12n];

const HELD_DRAW_RUNS = 2000;
const HELD_OCTETS: readonly (readonly [readonly bigint[], boolean])[] = [
  [FULLY_REFUSED_IPV4_OCTETS, false],
  [FULLY_PUBLIC_IPV4_OCTETS, true],
];

/**
 * An address of each IPv4-holding block that holds an IPv4 address of a block of which every
 * address is refused, and one that holds a public one, each with its block and its verdict.
 */
const HELD_ADDRESSES = IPV4_HOLDERS.flatMap((holder) =>
  HELD_OCTETS.map(
    ([octets, isPublic]) =>
      [
        holder,
        isPublic,
        fc
          .tuple(
            fc.constantFrom(...octets),
            fc.bigInt({ min: 0n, max: (1n << IPV4_LOW_BITS) - 1n }),
            fc.bigInt({ min: 0n, max: (1n << HOLDER_FILLER_BITS) - 1n }),
          )
          .map(([octet, rest, filler]) => holder.place((octet << IPV4_LOW_BITS) | rest, filler))
          // ::/96 holds :: and ::1, which are refused blocks of their own and hold nothing.
          .filter((address) => oracle(address).source === 'held'),
      ] as const,
  ),
);

/**
 * One address inside every range of the rule, drawn afresh in each run: each of the refused
 * blocks, each eighth of the 128-bit space (the three top bits, which tell 2000::/3 from its
 * neighbors), and each IPv4-holding block with a refused and with a public held IPv4 address. A
 * single draw of `ipv6Values` reaches a given narrow block in a run seldom, so a rule broken
 * for one block would pass about one run in five hundred; this reaches every block in every run.
 */
const ipv6EveryRange = fc.tuple(
  ...REFUSED_RANGES.map(([first, last]) => fc.bigInt({ min: first, max: last })),
  ...Array.from({ length: EIGHTHS_OF_SPACE }, (_, eighth) =>
    fc
      .noBias(fc.bigInt({ min: 0n, max: GLOBAL_UNICAST_FIRST - 1n }))
      .map((rest) => (BigInt(eighth) << EIGHTH_SHIFT_BITS) | rest),
  ),
  ...HELD_ADDRESSES.map((held) => held[2]),
);

/** The addresses of one run: one of `ipv6Values` and one in every range. */
const ipv6Run = fc
  .tuple(ipv6Values, ipv6EveryRange)
  .map(([address, inRanges]) => [address, ...inRanges]);

describe('addressKind', () => {
  it.each(IPV4_BLOCKS.map(([first, last, kind, neighbors]) => ({ first, last, kind, neighbors })))(
    '[TRV-66] refuses the IPv4 block from $first to $last as $kind, and accepts its neighbors outside it',
    ({ first, last, kind, neighbors }) => {
      expect([addressKind(first), addressKind(last)]).toStrictEqual([kind, kind]);
      expect(judged(neighbors)).toStrictEqual(allPublic(neighbors));
    },
  );

  it.each(IPV6_BLOCKS)(
    '[TRV-66] refuses the IPv6 block from %s to %s as %s',
    (first, last, kind) => {
      expect([addressKind(first), addressKind(last)]).toStrictEqual([kind, kind]);
    },
  );

  it.each(IPV6_NEIGHBORS)('[TRV-66] accepts the neighbors outside %s', (_blocks, neighbors) => {
    expect(judged(neighbors)).toStrictEqual(allPublic(neighbors));
  });

  it.each(GLOBAL_UNICAST_EDGES)(
    '[TRV-66] [CL-IMP-25] judges %s, at an edge of the global unicast block 2000::/3, as %s',
    (address, kind) => {
      expect(addressKind(address)).toBe(kind);
    },
  );

  it.each(OUTSIDE_GLOBAL_UNICAST)(
    '[TRV-66] [CL-IMP-25] refuses %s (%s), which lies outside 2000::/3, as %s',
    (address, _where, kind) => {
      expect(addressKind(address)).toBe(kind);
    },
  );

  it.each(EMBEDDED)(
    '[TRV-66] judges %s, also written %s, by the IPv4 address it holds: %s',
    (written, otherwise, kind) => {
      expect([addressKind(written), addressKind(otherwise)]).toStrictEqual([kind, kind]);
    },
  );

  it.each([
    '',
    'news.test',
    '256.0.0.1',
    '010.0.0.1',
    '1.2.3',
    '[::1]',
    '1::2::3',
    '::ffff:10.0.0.1:1',
    '2001:4860::1%eth0',
  ])('[TRV-66] refuses "%s", which it cannot read, as unreadable', (text) => {
    expect(addressKind(text)).toBe('unreadable');
  });

  it('[TRV-66] judges an IPv4-mapped or NAT64 address, in either form, as the IPv4 address it holds', () => {
    fc.assert(
      fc.property(fc.ipV4(), (ipv4) => {
        const kind = addressKind(ipv4);
        const forms = [`::ffff:${ipv4}`, `64:ff9b::${ipv4}`].flatMap((form) => [
          form,
          canonical(form),
        ]);

        expect(kind).not.toBe('unreadable');
        expect(forms.map((form) => addressKind(form))).toStrictEqual(forms.map(() => kind));
      }),
    );
  });

  it('[TRV-66] judges a 6to4 address as the IPv4 address it holds, whatever its interface', () => {
    fc.assert(
      fc.property(fc.ipV4(), fc.ipV4(), (ipv4, interfaceId) => {
        const [a = 0, b = 0, c = 0, d = 0] = ipv4.split('.').map(Number);
        const sixToFour = `2002:${hexGroup(a, b)}:${hexGroup(c, d)}::${interfaceId}`;

        expect(addressKind(sixToFour)).toBe(addressKind(ipv4));
      }),
    );
  });

  it('[TRV-66] judges an IPv6 address the same in any of its written forms', () => {
    fc.assert(
      fc.property(fc.ipV6(), (ipv6) => {
        expect(addressKind(ipv6)).not.toBe('unreadable');
        expect(addressKind(ipv6)).toBe(addressKind(canonical(ipv6)));
      }),
    );
  });

  it('[TRV-66] [CL-IMP-25] judges every address of the 128-bit space by the complement of the refused blocks', () => {
    fc.assert(
      fc.property(ipv6Run, (addresses) => {
        const texts = addresses.map((address) => ipv6Text(address));

        expect(texts.map((text) => ({ address: text, kind: addressKind(text) }))).toStrictEqual(
          addresses.map((address, index) => ({
            address: texts[index],
            kind: oracle(address).kind,
          })),
        );
      }),
    );
  });

  it.each(
    HELD_ADDRESSES.map(([holder, isPublic, draw]) => ({
      holder,
      isPublic,
      draw,
      block: ipv6Text(holder.first),
    })),
  )(
    '[TRV-66] draws only addresses of the block from $block that hold an IPv4 address, public: $isPublic',
    ({ holder, isPublic, draw }) => {
      // Many runs, since the draw leans on small values and a block may hold a few refused ones.
      fc.assert(
        fc.property(draw, (address) => {
          expect(address >= holder.first && address <= holder.last).toBe(true);
          expect(oracle(address).source).toBe('held');
          expect(oracle(address).kind === 'public').toBe(isPublic);
        }),
        { numRuns: HELD_DRAW_RUNS },
      );
    },
  );

  it('[TRV-66] draws, in every run, an address of each refused block and of each IPv4 holder with a refused and a public held address', () => {
    const cases: readonly (readonly [string, (address: bigint) => boolean])[] = [
      ...REFUSED_RANGES.map(
        ([first, last, kind]) =>
          [`refused ${kind} ${ipv6Text(first)}`, (a: bigint) => a >= first && a <= last] as const,
      ),
      ...IPV4_HOLDERS.flatMap(({ first, last }) => [
        [
          `held refused ${ipv6Text(first)}`,
          (a: bigint) =>
            a >= first && a <= last && oracle(a).source === 'held' && oracle(a).kind !== 'public',
        ] as const,
        [
          `held public ${ipv6Text(first)}`,
          (a: bigint) =>
            a >= first && a <= last && oracle(a).source === 'held' && oracle(a).kind === 'public',
        ] as const,
      ]),
    ];
    const unreachedIn = (addresses: readonly bigint[]) =>
      cases.filter(([, isCase]) => addresses.every((a) => !isCase(a))).map(([name]) => name);
    const unreached = fc.sample(ipv6Run, { numRuns: 50 }).flatMap((run) => unreachedIn(run));

    expect(unreached).toStrictEqual([]);
  });

  it('[TRV-66] draws, in nearly every run, an address that no block refuses, public inside 2000::/3 and reserved outside it', () => {
    const runs = fc.sample(ipv6Run, { numRuns: 50 });
    const runsWith = (kind: AddressKind) =>
      runs.filter((run) =>
        run.some((a) => oracle(a).source === 'complement' && oracle(a).kind === kind),
      ).length;
    const minimum = 45;

    expect(runsWith('public')).toBeGreaterThanOrEqual(minimum);
    expect(runsWith('reserved')).toBeGreaterThanOrEqual(minimum);
  });
});
