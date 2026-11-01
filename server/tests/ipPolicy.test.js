import { describe, expect, it } from 'vitest';
import { isPublicAddress } from '../src/security/ipPolicy.js';

describe('isPublicAddress', () => {
  it.each([
    ['8.8.8.8'],
    ['1.1.1.1'],
    ['93.184.216.34'],
    ['2606:4700:4700::1111'],
    ['2001:4860:4860::8888'],
  ])('allows public address %s', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    ['0.0.0.0', 'IPv4 unspecified'],
    ['0.1.2.3', 'IPv4 "this network"'],
    ['10.0.0.1', 'IPv4 private'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['127.0.0.1', 'IPv4 loopback'],
    ['127.255.255.254', 'IPv4 loopback range'],
    ['169.254.169.254', 'cloud metadata / link-local'],
    ['172.16.0.1', 'IPv4 private'],
    ['172.31.255.255', 'IPv4 private'],
    ['192.0.0.1', 'IETF protocol assignments'],
    ['192.0.2.1', 'documentation'],
    ['192.31.196.1', 'AS112'],
    ['192.52.193.1', 'AMT'],
    ['192.88.99.1', '6to4 relay'],
    ['192.168.1.1', 'IPv4 private'],
    ['192.175.48.1', 'AS112'],
    ['198.18.0.1', 'benchmarking'],
    ['198.51.100.1', 'documentation'],
    ['203.0.113.1', 'documentation'],
    ['224.0.0.1', 'IPv4 multicast'],
    ['240.0.0.1', 'IPv4 reserved'],
    ['255.255.255.255', 'broadcast'],
    ['::', 'IPv6 unspecified'],
    ['::1', 'IPv6 loopback'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
    ['::ffff:169.254.169.254', 'IPv4-mapped metadata'],
    ['::ffff:8.8.8.8', 'IPv4-mapped, refused even when public'],
    ['::7f00:1', 'IPv4-compatible loopback (library calls it unicast)'],
    ['::a00:1', 'IPv4-compatible private'],
    ['64:ff9b::7f00:1', 'NAT64 embedding loopback'],
    ['100::1', 'discard prefix'],
    ['2001::1', 'Teredo'],
    ['2001:2::1', 'benchmarking'],
    ['2001:db8::1', 'documentation'],
    ['2002:7f00:1::', '6to4 embedding loopback'],
    ['3fff::1', 'documentation'],
    ['5f00::1', 'segment routing'],
    ['fc00::1', 'unique local'],
    ['fd12:3456::1', 'unique local'],
    ['fe80::1', 'IPv6 link-local'],
    ['fec0::1', 'deprecated site-local'],
    ['ff02::1', 'IPv6 multicast'],
  ])('blocks %s (%s)', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([['not-an-ip'], [''], [null], [undefined], ['999.1.1.1']])('blocks invalid input %s', (value) => {
    expect(isPublicAddress(value)).toBe(false);
  });
});
