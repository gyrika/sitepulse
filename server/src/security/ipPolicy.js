import ipaddr from 'ipaddr.js';

const IPV6_GLOBAL_UNICAST = ipaddr.parseCIDR('2000::/3');
const IPV6_IETF_SPECIAL = ipaddr.parseCIDR('2001::/23');

/**
 * Returns true only for addresses on the public internet.
 *
 * This is an allowlist: anything not recognised as public is refused. ipaddr.js
 * labels private, loopback, link-local, multicast, reserved, NAT64, 6to4 and so on
 * with their own range names, so requiring "unicast" excludes all of them.
 *
 * IPv6 needs a second rule because the library also labels some dangerous addresses
 * "unicast". For example ::7f00:1 is the old IPv4-compatible form of 127.0.0.1.
 */
export function isPublicAddress(address) {
  if (typeof address !== 'string' || !ipaddr.isValid(address)) return false;

  const ip = ipaddr.parse(address);
  if (ip.range() !== 'unicast') return false;

  if (ip.kind() === 'ipv6') {
    return ip.match(IPV6_GLOBAL_UNICAST) && !ip.match(IPV6_IETF_SPECIAL);
  }
  return true;
}
