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
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['0.0.0.0', '0.255.255.255', 'this-network', ['1.0.0.0']],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['10.0.0.0', '10.255.255.255', 'private-use', ['9.255.255.255', '11.0.0.0']],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['100.64.0.0', '100.127.255.255', 'shared', ['100.63.255.255', '100.128.0.0']],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['127.0.0.0', '127.255.255.255', 'loopback', ['126.255.255.255', '128.0.0.0']],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['169.254.0.0', '169.254.255.255', 'link-local', ['169.253.255.255', '169.255.0.0']],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['172.16.0.0', '172.31.255.255', 'private-use', ['172.15.255.255', '172.32.0.0']],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['192.0.0.0', '192.0.0.255', 'protocol-assignments', ['191.255.255.255', '192.0.1.0']],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['192.0.2.0', '192.0.2.255', 'documentation', ['192.0.1.255', '192.0.3.0']],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['192.88.99.0', '192.88.99.255', 'deprecated', ['192.88.98.255', '192.88.100.0']],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['192.168.0.0', '192.168.255.255', 'private-use', ['192.167.255.255', '192.169.0.0']],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['198.18.0.0', '198.19.255.255', 'benchmarking', ['198.17.255.255', '198.20.0.0']],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['198.51.100.0', '198.51.100.255', 'documentation', ['198.51.99.255', '198.51.101.0']],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['203.0.113.0', '203.0.113.255', 'documentation', ['203.0.112.255', '203.0.114.0']],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['224.0.0.0', '239.255.255.255', 'multicast', ['223.255.255.255']],
  // The broadcast address, 255.255.255.255, is the last of the reserved block.
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['240.0.0.0', '255.255.255.255', 'reserved', []],
];

// Each IPv6 block: its first and last addresses, and its kind.
const IPV6_BLOCKS: readonly (readonly [string, string, AddressKind])[] = [
  ['::', '::', 'unspecified'],
  ['::1', '::1', 'loopback'],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['64:ff9b:1::', '64:ff9b:1:ffff:ffff:ffff:ffff:ffff', 'local-translation'],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['100::', '100::ffff:ffff:ffff:ffff', 'discard-only'],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['100:0:0:1::', '100::1:ffff:ffff:ffff:ffff', 'dummy'],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['2001::', '2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff', 'protocol-assignments'],
  ['2001:db8::', '2001:db8:ffff:ffff:ffff:ffff:ffff:ffff', 'documentation'],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['3fff::', '3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff', 'documentation'],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['5f00::', '5f00:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'segment-routing'],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['fc00::', 'fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'unique-local'],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['fe80::', 'febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'link-local'],
  // The site-local block (RFC 3879).
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['fec0::', 'feff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'deprecated'],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['ff00::', 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'multicast'],
];

// The neighbors that lie in no refused block on each side of every refused IPv6 block
// inside the global unicast block 2000::/3 (RFC 4291), and that of :: and ::1, which
// touch: ::2 is the IPv4-compatible address of 0.0.0.2, so their neighbor is ::100:0,
// that of 1.0.0.0.
const IPV6_NEIGHBORS: readonly (readonly [string, readonly string[]])[] = [
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['::/128 and ::1/128', ['::100:0']],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['2001::/23', ['2000:ffff:ffff:ffff:ffff:ffff:ffff:ffff', '2001:200::']],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['2001:db8::/32', ['2001:db7:ffff:ffff:ffff:ffff:ffff:ffff', '2001:db9::']],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['3fff::/20', ['3ffe:ffff:ffff:ffff:ffff:ffff:ffff:ffff', '3fff:1000::']],
];

// The edges of the global unicast block 2000::/3, which holds every public IPv6 address
// that holds no IPv4 one, and its neighbors outside it.
const GLOBAL_UNICAST_EDGES: readonly (readonly [string, AddressKind])[] = [
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['2000::', 'public'],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['3fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'public'],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['1fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'reserved'],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['4000::', 'reserved'],
];

// Addresses outside 2000::/3 that hold no IPv4 address: the neighbors of the refused
// blocks outside it, and the forms that a system may still route. Each one is refused,
// as `reserved` unless it lies in a refused block, whose kind it keeps.
const OUTSIDE_GLOBAL_UNICAST: readonly (readonly [string, string, AddressKind])[] = [
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['64:ff9b:0:ffff:ffff:ffff:ffff:ffff', 'below 64:ff9b:1::/48', 'reserved'],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['64:ff9b:2::', 'above 64:ff9b:1::/48', 'reserved'],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['ff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'below 100::/64', 'reserved'],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['100:0:0:2::', 'above 100:0:0:1::/64', 'reserved'],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['5eff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'below 5f00::/16', 'reserved'],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['5f01::', 'above 5f00::/16', 'reserved'],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['fbff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'below fc00::/7', 'reserved'],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['fe00::', 'above fc00::/7', 'reserved'],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['fe7f:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'below fe80::/10', 'reserved'],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['fec0::', 'above fe80::/10, site-local', 'deprecated'],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['feff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'below ff00::/8, site-local', 'deprecated'],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['fec0::1', 'a site-local address', 'deprecated'],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['4000::1', 'an address of no special-purpose block', 'reserved'],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['::ffff:0:7f00:1', 'a SIIT address, outside the IPv4-mapped block', 'reserved'],
];

// IPv6 addresses that hold an IPv4 one, in two written forms each, and the kind of
// the IPv4 address they hold. The dotted tail of a 6to4 address is its interface, not
// the address it holds. An IPv4-compatible, IPv4-mapped or NAT64 address lies outside
// 2000::/3, yet one that holds a public IPv4 address, such as ::ffff:11.0.0.1, stays
// public: it is judged by that IPv4 address alone, which is where it leads.
const EMBEDDED: readonly (readonly [string, string, AddressKind])[] = [
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['::127.0.0.1', '::7f00:1', 'loopback'],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['::0.0.0.2', '::2', 'this-network'],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['::11.0.0.1', '0:0:0:0:0:0:b00:1', 'public'],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['::ffff:10.0.0.1', '::ffff:a00:1', 'private-use'],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['::FFFF:127.0.0.1', '0:0:0:0:0:FFFF:7F00:0001', 'loopback'],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['::ffff:11.0.0.1', '::ffff:b00:1', 'public'],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['64:ff9b::169.254.169.254', '64:ff9b::a9fe:a9fe', 'link-local'],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['64:ff9b::11.0.0.1', '64:ff9b:0:0:0:0:b00:1', 'public'],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['2002:a00:1::11.0.0.1', '2002:0a00:0001:0000:0000:0000:0b00:0001', 'private-use'],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['2002:b00:1::10.0.0.1', '2002:b00:1::a00:1', 'public'],
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
  ['2002:7f00:1::', '2002:7f00:0001:0000:0000:0000:0000:0000', 'loopback'],
];

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
    // eslint-disable-next-line sonarjs/no-hardcoded-ip -- a test address, judged and never contacted
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
});
