import http from 'node:http';
import https from 'node:https';
import selfsigned from 'selfsigned';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHECK_ERROR } from '../src/config/monitoring.js';
import { performHttpCheck } from '../src/services/httpCheck.js';
import { resolveTarget, TARGET_ERROR } from '../src/security/targetPolicy.js';

const openServers = new Set();

function listen(server, host = '127.0.0.1') {
  openServers.add(server);
  return new Promise((resolve) => {
    server.listen(0, host, () => resolve(server.address().port));
  });
}

afterEach(async () => {
  await Promise.all(
    [...openServers].map(
      (server) =>
        new Promise((resolve) => {
          server.closeAllConnections?.();
          server.close(resolve);
        }),
    ),
  );
  openServers.clear();
});

// Stands in for the policy so a local test server is reachable. Every address the
// check may connect to comes from here, exactly as it does in production.
const pinTo = (address = '127.0.0.1', family = 4) =>
  vi.fn(async (rawUrl) => ({ url: new URL(rawUrl), addresses: [{ address, family }] }));

const options = (overrides = {}) => ({
  timeoutMs: 1000,
  maxBytes: 1024 * 1024,
  resolve: pinTo(),
  ...overrides,
});

const localUrl = (port, path = '/') => `http://pinned.example.com:${port}${path}`;

describe('HTTP results', () => {
  it.each([[200], [204], [301], [302], [304], [399]])('treats HTTP %i as success', async (status) => {
    const port = await listen(
      http.createServer((_req, res) => {
        res.writeHead(status);
        res.end();
      }),
    );

    const result = await performHttpCheck(localUrl(port), options());

    expect(result).toMatchObject({ success: true, httpStatus: status, errorCode: null });
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
  });

  it.each([[400], [401], [404], [418], [500], [503]])('treats HTTP %i as failure', async (status) => {
    const port = await listen(
      http.createServer((_req, res) => {
        res.writeHead(status);
        res.end('error page');
      }),
    );

    const result = await performHttpCheck(localUrl(port), options());

    expect(result).toMatchObject({ success: false, httpStatus: status, errorCode: CHECK_ERROR.HTTP_STATUS });
  });

  it('reports a refused connection', async () => {
    const server = http.createServer();
    const port = await listen(server);
    await new Promise((resolve) => server.close(resolve));
    openServers.delete(server);

    const result = await performHttpCheck(localUrl(port), options());

    expect(result).toMatchObject({
      success: false,
      httpStatus: null,
      responseTimeMs: null,
      errorCode: CHECK_ERROR.CONNECTION_ERROR,
    });
    expect(result.errorMessage).not.toContain('127.0.0.1');
  });

  it('reports a connection dropped before any response', async () => {
    const port = await listen(http.createServer((req) => req.socket.destroy()));
    const result = await performHttpCheck(localUrl(port), options());
    expect(result).toMatchObject({ success: false, errorCode: CHECK_ERROR.NETWORK_ERROR });
  });

  it('fails when the body is cut off part-way through', async () => {
    const port = await listen(
      http.createServer((req, res) => {
        res.writeHead(200, { 'content-length': '1000' });
        res.write('partial', () => req.socket.destroy());
      }),
    );
    const result = await performHttpCheck(localUrl(port), options());
    expect(result).toMatchObject({ success: false, errorCode: CHECK_ERROR.NETWORK_ERROR });
  });
});

describe('timeouts', () => {
  it('times out when the server never sends headers', async () => {
    const port = await listen(http.createServer(() => {}));
    const startedAt = Date.now();

    const result = await performHttpCheck(localUrl(port), options({ timeoutMs: 200 }));

    expect(result).toMatchObject({ success: false, errorCode: CHECK_ERROR.TIMEOUT });
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it('times out when the body stalls after a 200', async () => {
    const port = await listen(
      http.createServer((_req, res) => {
        res.writeHead(200);
        res.write('some data, then silence');
      }),
    );
    const result = await performHttpCheck(localUrl(port), options({ timeoutMs: 200 }));
    expect(result).toMatchObject({ success: false, errorCode: CHECK_ERROR.TIMEOUT });
  });

  it('applies one deadline to the whole slow-drip response', async () => {
    const port = await listen(
      http.createServer((_req, res) => {
        res.writeHead(200);
        const timer = setInterval(() => res.write('x'), 20);
        res.on('close', () => clearInterval(timer));
      }),
    );
    const startedAt = Date.now();

    const result = await performHttpCheck(localUrl(port), options({ timeoutMs: 200 }));

    expect(result.errorCode).toBe(CHECK_ERROR.TIMEOUT);
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it('covers a DNS lookup that hangs', async () => {
    const resolve = vi.fn(() => new Promise(() => {}));
    const result = await performHttpCheck('https://slow-dns.example.com/', options({ timeoutMs: 100, resolve }));
    expect(result).toMatchObject({ success: false, errorCode: CHECK_ERROR.TIMEOUT });
  });
});

describe('response limits', () => {
  it('stops reading at the size limit and still reports the status', async () => {
    let bytesSent = 0;
    let closedEarly = false;
    const port = await listen(
      http.createServer((_req, res) => {
        res.writeHead(200);
        const chunk = Buffer.alloc(64 * 1024);
        const timer = setInterval(() => {
          bytesSent += chunk.length;
          res.write(chunk);
        }, 1);
        res.on('close', () => {
          closedEarly = true;
          clearInterval(timer);
        });
      }),
    );

    const result = await performHttpCheck(localUrl(port), options({ maxBytes: 256 * 1024, timeoutMs: 1500 }));

    expect(result).toMatchObject({ success: true, httpStatus: 200, bodyTruncated: true });
    await vi.waitFor(() => expect(closedEarly).toBe(true));
    expect(bytesSent).toBeLessThan(32 * 1024 * 1024);
  });

  it('does not flag a body within the limit as truncated', async () => {
    const port = await listen(http.createServer((_req, res) => res.end('small')));
    const result = await performHttpCheck(localUrl(port), options());
    expect(result).toMatchObject({ success: true, bodyTruncated: false });
  });

  it('rejects oversized response headers', async () => {
    const port = await listen(
      http.createServer({ maxHeaderSize: 1024 * 1024 }, (_req, res) => {
        res.setHeader('x-big', 'a'.repeat(64 * 1024));
        res.end();
      }),
    );
    const result = await performHttpCheck(localUrl(port), options());
    expect(result).toMatchObject({ success: false, errorCode: CHECK_ERROR.NETWORK_ERROR });
  });
});

describe('redirects', () => {
  it('reports a redirect without following it', async () => {
    let internalHits = 0;
    const internalPort = await listen(
      http.createServer((_req, res) => {
        internalHits += 1;
        res.end('internal secret');
      }),
    );
    const port = await listen(
      http.createServer((_req, res) => {
        res.writeHead(302, { location: `http://127.0.0.1:${internalPort}/` });
        res.end();
      }),
    );

    const result = await performHttpCheck(localUrl(port), options());

    expect(result).toMatchObject({ success: true, httpStatus: 302 });
    expect(internalHits).toBe(0);
  });
});

describe('SSRF protections', () => {
  it('connects to the pinned address, not whatever the host name resolves to', async () => {
    let seenHost;
    const port = await listen(
      http.createServer((req, res) => {
        seenHost = req.headers.host;
        res.end();
      }),
    );
    const resolve = pinTo();

    const result = await performHttpCheck(localUrl(port), options({ resolve }));

    // example.com does not resolve to loopback, so reaching this server proves the pin.
    expect(result.success).toBe(true);
    expect(seenHost).toBe(`pinned.example.com:${port}`);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('pins IPv6 addresses too', async () => {
    const port = await listen(http.createServer((_req, res) => res.end()), '::1');
    const result = await performHttpCheck(localUrl(port), options({ resolve: pinTo('::1', 6) }));
    expect(result).toMatchObject({ success: true, httpStatus: 200 });
  });

  it('never connects when DNS returns a private address (rebinding)', async () => {
    let hits = 0;
    const port = await listen(
      http.createServer((_req, res) => {
        hits += 1;
        res.end();
      }),
    );
    const lookup = vi.fn().mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);

    const result = await performHttpCheck(
      localUrl(port),
      options({ resolve: (url) => resolveTarget(url, { lookup }) }),
    );

    expect(result).toMatchObject({ success: false, errorCode: CHECK_ERROR.BLOCKED_TARGET });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(hits).toBe(0);
  });

  it('never connects when one of several DNS answers is private', async () => {
    let hits = 0;
    const port = await listen(
      http.createServer((_req, res) => {
        hits += 1;
        res.end();
      }),
    );
    const lookup = vi.fn().mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);

    const result = await performHttpCheck(
      localUrl(port),
      options({ resolve: (url) => resolveTarget(url, { lookup }) }),
    );

    expect(result.errorCode).toBe(CHECK_ERROR.BLOCKED_TARGET);
    expect(hits).toBe(0);
  });

  it.each([
    ['http://127.0.0.1/', CHECK_ERROR.BLOCKED_TARGET],
    ['http://[::1]/', CHECK_ERROR.BLOCKED_TARGET],
    ['http://localhost/', CHECK_ERROR.BLOCKED_TARGET],
    ['http://169.254.169.254/latest/meta-data/', CHECK_ERROR.BLOCKED_TARGET],
    ['http://user:pass@example.com/', CHECK_ERROR.BLOCKED_TARGET],
    ['ftp://example.com/', CHECK_ERROR.BLOCKED_TARGET],
  ])('the default policy refuses %s', async (url, errorCode) => {
    const result = await performHttpCheck(url, { timeoutMs: 1000, maxBytes: 1024 });
    expect(result).toMatchObject({ success: false, errorCode });
  });

  it('maps DNS failures from the policy', async () => {
    const lookup = vi.fn().mockRejectedValue(new Error('ENOTFOUND'));
    const result = await performHttpCheck(
      'https://missing.example.com/',
      options({ resolve: (url) => resolveTarget(url, { lookup }) }),
    );
    expect(result.errorCode).toBe(CHECK_ERROR.DNS_ERROR);
    expect(TARGET_ERROR.DNS_ERROR).toBe('DNS_ERROR');
  });
});

describe('TLS', () => {
  it('rejects an untrusted certificate even though the address is pinned', async () => {
    const { private: key, cert } = await selfsigned.generate([{ name: 'commonName', value: 'pinned.example.com' }], {
      keySize: 2048,
    });
    const port = await listen(https.createServer({ key, cert }, (_req, res) => res.end()));

    const result = await performHttpCheck(`https://pinned.example.com:${port}/`, options());

    expect(result).toMatchObject({ success: false, httpStatus: null, errorCode: CHECK_ERROR.TLS_ERROR });
  });
});
