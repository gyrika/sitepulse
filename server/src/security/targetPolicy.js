import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isPublicAddress } from './ipPolicy.js';

const BLOCKED_HOST_SUFFIXES = [
  'localhost',
  'local',
  'localdomain',
  'internal',
  'intranet',
  'lan',
  'home',
  'corp',
  'home.arpa',
  'arpa',
  'onion',
  'test',
  'invalid',
  'example',
];

export const TARGET_ERROR = Object.freeze({
  INVALID_URL: 'INVALID_URL',
  BLOCKED_TARGET: 'BLOCKED_TARGET',
  DNS_ERROR: 'DNS_ERROR',
});

export class TargetPolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TargetPolicyError';
    this.code = code;
  }
}

function isBlockedHostName(hostname) {
  const name = hostname.replace(/\.$/, '').toLowerCase();
  // A single-label name such as "db" can only be an internal host.
  if (!name.includes('.')) return true;
  return BLOCKED_HOST_SUFFIXES.some((suffix) => name === suffix || name.endsWith(`.${suffix}`));
}

/**
 * Checks everything that can be decided from the URL alone and returns it as a URL
 * object. The WHATWG parser also turns tricks such as http://2130706433/ and
 * http://0x7f.1/ into 127.0.0.1, so they cannot hide a loopback address.
 */
export function parseTargetUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new TargetPolicyError(TARGET_ERROR.INVALID_URL, 'The URL is not valid.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TargetPolicyError(TARGET_ERROR.INVALID_URL, 'Only HTTP and HTTPS URLs are allowed.');
  }
  if (url.username || url.password) {
    throw new TargetPolicyError(TARGET_ERROR.INVALID_URL, 'URLs must not contain credentials.');
  }

  const literalIp = url.hostname.replace(/^\[|\]$/g, '');
  const isBlocked = isIP(literalIp) ? !isPublicAddress(literalIp) : isBlockedHostName(url.hostname);
  if (isBlocked) {
    throw new TargetPolicyError(TARGET_ERROR.BLOCKED_TARGET, 'This address is not allowed.');
  }

  // Fragments are never sent to a server and would create false "different" URLs.
  url.hash = '';
  return url;
}

/**
 * Applies the full policy and returns the exact addresses it approved. The caller
 * must connect to those addresses and must not resolve the host name again:
 * a second lookup is what makes DNS rebinding possible.
 *
 * Runs before every check, not only when a monitor is saved, because a host name
 * that is public today can point at a private address tomorrow.
 */
export async function resolveTarget(rawUrl, { lookup = dnsLookup } = {}) {
  const url = parseTargetUrl(rawUrl);

  const literalIp = url.hostname.replace(/^\[|\]$/g, '');
  const family = isIP(literalIp);
  if (family) return { url, addresses: [{ address: literalIp, family }] };

  let records;
  try {
    records = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new TargetPolicyError(TARGET_ERROR.DNS_ERROR, 'The host name could not be resolved.');
  }
  if (records.length === 0) {
    throw new TargetPolicyError(TARGET_ERROR.DNS_ERROR, 'The host name could not be resolved.');
  }

  // One bad record blocks the whole host. Otherwise a host could publish one public
  // and one private address and rely on the private one being used.
  if (!records.every((record) => isPublicAddress(record.address))) {
    throw new TargetPolicyError(TARGET_ERROR.BLOCKED_TARGET, 'This address is not allowed.');
  }

  return { url, addresses: records.map(({ address, family: ipFamily }) => ({ address, family: ipFamily })) };
}
