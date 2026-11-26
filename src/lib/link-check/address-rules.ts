// Which IP addresses the link check may connect to: public unicast ones only. A
// link comes from outside, from a research result that an AI wrote, so nothing
// stops it from pointing inside: the machine itself, a private network, the
// metadata service of the host (TRV-66). Every block of the IANA special-purpose
// registries for IPv4 and IPv6 (RFC 6890 and its updates) that is not globally
// reachable is refused whole, its anycast exceptions included, since no article
// lives on a protocol's anycast address; multicast is refused too, and so is the
// former site-local block of IPv6. An IPv6 address in a refused block has that block's
// kind; any other is judged by the IPv4 address it holds when it holds one
// (IPv4-compatible, IPv4-mapped, NAT64 or 6to4), wherever it lies; any other is public
// inside the global unicast block 2000::/3 (RFC 4291) and reserved outside it, since
// no web server lives outside it and a network that still routes an address outside
// it would be reached through a link.
import { isIP } from 'node:net';

/** Why an IP address is not public: the kind of its block, or `unreadable`. */
export type RefusedKind =
  | 'unreadable'
  | 'unspecified'
  | 'this-network'
  | 'loopback'
  | 'private-use'
  | 'shared'
  | 'link-local'
  | 'unique-local'
  | 'protocol-assignments'
  | 'documentation'
  | 'benchmarking'
  | 'deprecated'
  | 'discard-only'
  | 'dummy'
  | 'local-translation'
  | 'segment-routing'
  | 'multicast'
  | 'reserved';

/** What an IP address is for the link check: `public`, or why it is not. */
export type AddressKind = 'public' | RefusedKind;

/** A block of addresses: the network part of its first address, and the bits of the host part. */
type Block = Readonly<{ network: bigint; hostBits: bigint }>;

/** A block that is not public, and its kind. */
type RefusedBlock = Block & Readonly<{ kind: RefusedKind }>;

/** An IPv6 block whose addresses hold an IPv4 address, and how to read it. */
type Embedding = Block & Readonly<{ ipv4: (address: bigint) => bigint }>;

const IPV4 = 4;
const IPV6 = 6;
const IPV4_BITS = 32;
const IPV6_BITS = 128;
const IPV6_GROUPS = 8;
// The value before any bit is read, and a group that `::` stands for.
const NO_BITS = 0n;
const OCTET_BITS = 8n;
const GROUP_BITS = 16n;
const LOW_GROUP = 0xff_ffn;
const IPV4_MASK = 0xff_ff_ff_ffn;
// A 6to4 address holds its IPv4 address in the 32 bits after its 16-bit prefix.
const SIX_TO_FOUR_IPV4_SHIFT = 80n;

/** The value of a dotted-quad IPv4 address that `isIP` accepted. */
function ipv4Value(text: string): bigint {
  return text.split('.').reduce((value, octet) => (value << OCTET_BITS) | BigInt(octet), NO_BITS);
}

/** The 16-bit groups of one part of an IPv6 address; a dotted IPv4 tail gives two. */
function groupsOf(part: string): bigint[] {
  return part === ''
    ? []
    : part.split(':').flatMap((piece) => {
        if (!piece.includes('.')) {
          return BigInt(`0x${piece}`);
        }
        const ipv4 = ipv4Value(piece);
        return [ipv4 >> GROUP_BITS, ipv4 & LOW_GROUP];
      });
}

/** The value of an IPv6 address that `isIP` accepted, written in any of its forms. */
function ipv6Value(text: string): bigint {
  const [head = '', tail = ''] = text.split('::', 2);
  const before = groupsOf(head);
  const after = groupsOf(tail);
  const zeros = Array.from({ length: IPV6_GROUPS - before.length - after.length }, () => NO_BITS);
  return [...before, ...zeros, ...after].reduce(
    (value, group) => (value << GROUP_BITS) | group,
    NO_BITS,
  );
}

/** The block that `cidr` writes, for addresses of `bits` bits read by `valueOf`. */
function blockOf(cidr: string, bits: number, valueOf: (text: string) => bigint): Block {
  const [address = '', prefix = ''] = cidr.split('/', 2);
  const hostBits = BigInt(bits - Number(prefix));
  return { network: valueOf(address) >> hostBits, hostBits };
}

const ipv4Blocks = (kind: RefusedKind, cidrs: readonly string[]): RefusedBlock[] =>
  cidrs.map((cidr) => ({ ...blockOf(cidr, IPV4_BITS, ipv4Value), kind }));

const ipv6Blocks = (kind: RefusedKind, cidrs: readonly string[]): RefusedBlock[] =>
  cidrs.map((cidr) => ({ ...blockOf(cidr, IPV6_BITS, ipv6Value), kind }));

const isWithin = (address: bigint, block: Block): boolean =>
  address >> block.hostBits === block.network;

const REFUSED_IPV4: readonly RefusedBlock[] = [
  ...ipv4Blocks('this-network', ['0.0.0.0/8']),
  ...ipv4Blocks('private-use', ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']),
  ...ipv4Blocks('shared', ['100.64.0.0/10']),
  ...ipv4Blocks('loopback', ['127.0.0.0/8']),
  ...ipv4Blocks('link-local', ['169.254.0.0/16']),
  ...ipv4Blocks('protocol-assignments', ['192.0.0.0/24']),
  ...ipv4Blocks('documentation', ['192.0.2.0/24', '198.51.100.0/24', '203.0.113.0/24']),
  // The former 6to4 relay anycast (RFC 7526).
  ...ipv4Blocks('deprecated', ['192.88.99.0/24']),
  ...ipv4Blocks('benchmarking', ['198.18.0.0/15']),
  ...ipv4Blocks('multicast', ['224.0.0.0/4']),
  // The limited broadcast address, 255.255.255.255, is its last address.
  ...ipv4Blocks('reserved', ['240.0.0.0/4']),
];

const REFUSED_IPV6: readonly RefusedBlock[] = [
  ...ipv6Blocks('unspecified', ['::/128']),
  ...ipv6Blocks('loopback', ['::1/128']),
  ...ipv6Blocks('local-translation', ['64:ff9b:1::/48']),
  ...ipv6Blocks('discard-only', ['100::/64']),
  ...ipv6Blocks('dummy', ['100:0:0:1::/64']),
  // Teredo, 2001::/32, included.
  ...ipv6Blocks('protocol-assignments', ['2001::/23']),
  ...ipv6Blocks('documentation', ['2001:db8::/32', '3fff::/20']),
  ...ipv6Blocks('segment-routing', ['5f00::/16']),
  ...ipv6Blocks('unique-local', ['fc00::/7']),
  ...ipv6Blocks('link-local', ['fe80::/10']),
  // The former site-local block (RFC 3879).
  ...ipv6Blocks('deprecated', ['fec0::/10']),
  ...ipv6Blocks('multicast', ['ff00::/8']),
];

// The global unicast block (RFC 4291, section 2.5.4): outside it, an IPv6 address that
// holds no IPv4 address is reserved.
const GLOBAL_UNICAST: Block = blockOf('2000::/3', IPV6_BITS, ipv6Value);

const lastBits = (address: bigint): bigint => address & IPV4_MASK;

const embedding = (cidr: string, ipv4: (address: bigint) => bigint): Embedding => ({
  ...blockOf(cidr, IPV6_BITS, ipv6Value),
  ipv4,
});

const EMBEDDINGS: readonly Embedding[] = [
  // IPv4-compatible, deprecated (RFC 4291), which a system may still carry to the
  // IPv4 address it holds; :: and ::1 are refused before as themselves.
  embedding('::/96', lastBits),
  // IPv4-mapped (RFC 4291).
  embedding('::ffff:0:0/96', lastBits),
  // NAT64, its well-known prefix (RFC 6052).
  embedding('64:ff9b::/96', lastBits),
  // 6to4 (RFC 3056).
  embedding('2002::/16', (address) => (address >> SIX_TO_FOUR_IPV4_SHIFT) & IPV4_MASK),
];

const kindIn = (address: bigint, blocks: readonly RefusedBlock[]): AddressKind =>
  blocks.find((block) => isWithin(address, block))?.kind ?? 'public';

/**
 * The kind of an IPv6 address: that of its own refused block, else that of the IPv4
 * address it holds, else public inside the global unicast block and reserved outside it.
 */
function ipv6Kind(address: bigint): AddressKind {
  const own = kindIn(address, REFUSED_IPV6);
  if (own !== 'public') {
    return own;
  }
  const held = EMBEDDINGS.find((block) => isWithin(address, block));
  if (held !== undefined) {
    return kindIn(held.ipv4(address), REFUSED_IPV4);
  }
  return isWithin(address, GLOBAL_UNICAST) ? 'public' : 'reserved';
}

/**
 * Says whether `address`, an IPv4 or IPv6 address as text, is a public unicast
 * address that the link check may connect to, and if not, why (TRV-66, CL-IMP-25):
 * the kind of its block, or `unreadable` for a text that is not an address, or that
 * carries a zone. An IPv4 address is public in no refused block. An IPv6 address in a
 * refused block has that block's kind; any other is judged by the IPv4 address it holds
 * when it holds one (IPv4-compatible, IPv4-mapped, NAT64 or 6to4), wherever it lies; any
 * other is public inside the global unicast block 2000::/3 and `reserved` outside it.
 */
export function addressKind(address: string): AddressKind {
  const version = address.includes('%') ? 0 : isIP(address);
  if (version === IPV4) {
    return kindIn(ipv4Value(address), REFUSED_IPV4);
  }
  return version === IPV6 ? ipv6Kind(ipv6Value(address)) : 'unreadable';
}
