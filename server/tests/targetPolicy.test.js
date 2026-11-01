import { describe, expect, it, vi } from 'vitest';
import { parseTargetUrl, resolveTarget, TARGET_ERROR } from '../src/security/targetPolicy.js';

const expectCode = (fn, code) => {
  expect(fn).toThrow(expect.objectContaining({ code }));
};

describe('parseTargetUrl', () => {
  it.each([
    ['ftp://example.com/'],
    ['file:///etc/passwd'],
    ['gopher://example.com/'],
    ['javascript:alert(1)'],
    ['not a url'],
  ])('rejects %s as invalid', (url) => {
    expectCode(() => parseTargetUrl(url), TARGET_ERROR.INVALID_URL);
  });

  it.each([['http://user:pass@example.com/'], ['https://user@example.com/'], ['https://:secret@example.com/']])(
    'rejects credential-bearing URL %s',
    (url) => {
      expectCode(() => parseTargetUrl(url), TARGET_ERROR.INVALID_URL);
    },
  );

  it.each([
    ['http://localhost/'],
    ['http://LOCALHOST:3000/'],
    ['http://localhost./'],
    ['http://foo.localhost/'],
    ['http://printer.local/'],
    ['http://metadata.google.internal/'],
    ['http://intranet/'],
    ['http://127.0.0.1/'],
    ['http://[::1]/'],
    ['http://[::ffff:127.0.0.1]/'],
    ['http://[fe80::1]/'],
    ['http://169.254.169.254/latest/meta-data/'],
    // Alternate spellings that the URL parser normalises to loopback or private addresses.
    ['http://2130706433/'],
    ['http://0x7f.1/'],
    ['http://0177.0.0.1/'],
    ['http://127.1/'],
    ['http://0/'],
    ['http://0xa9fea9fe/'],
    ['http://①②⑦.⓪.⓪.①/'],
  ])('blocks %s', (url) => {
    expectCode(() => parseTargetUrl(url), TARGET_ERROR.BLOCKED_TARGET);
  });

  it('normalises the URL and strips the fragment', () => {
    expect(parseTargetUrl('HTTPS://Example.COM/path?a=1#section').href).toBe('https://example.com/path?a=1');
  });
});

describe('resolveTarget', () => {
  const lookupReturning = (...addresses) =>
    vi.fn().mockResolvedValue(addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })));

  it('returns every approved address', async () => {
    const lookup = lookupReturning('93.184.216.34', '2606:4700:4700::1111');
    const { addresses } = await resolveTarget('https://example.com/', { lookup });
    expect(addresses).toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ]);
  });

  it.each([
    ['A record pointing at loopback', ['127.0.0.1']],
    ['AAAA record pointing at loopback', ['::1']],
    ['A record pointing at cloud metadata', ['169.254.169.254']],
    ['AAAA record with an IPv4-mapped private address', ['::ffff:10.0.0.1']],
    ['private address listed after a public one', ['93.184.216.34', '10.0.0.5']],
    ['private IPv6 listed after a public IPv4', ['93.184.216.34', 'fd00::1']],
  ])('blocks a public-looking host with %s', async (_label, addresses) => {
    await expect(
      resolveTarget('https://attacker.example.com/', { lookup: lookupReturning(...addresses) }),
    ).rejects.toMatchObject({ code: TARGET_ERROR.BLOCKED_TARGET });
  });

  it('reports a DNS failure', async () => {
    const lookup = vi.fn().mockRejectedValue(Object.assign(new Error('nope'), { code: 'ENOTFOUND' }));
    await expect(resolveTarget('https://missing.example.com/', { lookup })).rejects.toMatchObject({
      code: TARGET_ERROR.DNS_ERROR,
    });
  });

  it('reports an empty DNS answer as a DNS failure', async () => {
    await expect(resolveTarget('https://empty.example.com/', { lookup: lookupReturning() })).rejects.toMatchObject({
      code: TARGET_ERROR.DNS_ERROR,
    });
  });

  it('does not use DNS for a public IP literal', async () => {
    const lookup = vi.fn();
    const { addresses } = await resolveTarget('http://[2606:4700:4700::1111]/', { lookup });
    expect(lookup).not.toHaveBeenCalled();
    expect(addresses).toEqual([{ address: '2606:4700:4700::1111', family: 6 }]);
  });

  it('never calls DNS for a blocked host name', async () => {
    const lookup = vi.fn();
    await expect(resolveTarget('http://localhost/', { lookup })).rejects.toMatchObject({
      code: TARGET_ERROR.BLOCKED_TARGET,
    });
    expect(lookup).not.toHaveBeenCalled();
  });
});
