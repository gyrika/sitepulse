import { Agent, request } from 'undici';
import { CHECK_ERROR, MAX_SUCCESS_STATUS, MIN_SUCCESS_STATUS } from '../config/monitoring.js';
import { resolveTarget, TARGET_ERROR, TargetPolicyError } from '../security/targetPolicy.js';

const MAX_RESPONSE_HEADER_BYTES = 32 * 1024;

// Fixed messages on purpose. Raw network errors contain resolved IP addresses, and
// reporting those would help someone map the network the worker runs on.
const ERROR_MESSAGES = {
  [CHECK_ERROR.BLOCKED_TARGET]: 'The target resolves to an address that is not allowed.',
  [CHECK_ERROR.DNS_ERROR]: 'The host name could not be resolved.',
  [CHECK_ERROR.TIMEOUT]: 'The check timed out.',
  [CHECK_ERROR.CONNECTION_ERROR]: 'The connection could not be established.',
  [CHECK_ERROR.TLS_ERROR]: 'The TLS certificate or connection is not valid.',
  [CHECK_ERROR.NETWORK_ERROR]: 'The connection failed during the request.',
};

const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EADDRNOTAVAIL',
]);
const TIMEOUT_ERROR_CODES = new Set([
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);
const TLS_ERROR_PATTERN = /^(ERR_TLS_|ERR_SSL_|CERT_|DEPTH_ZERO_|SELF_SIGNED_|UNABLE_TO_|HOSTNAME_)/;

function errorCodesOf(error, seen = new Set()) {
  if (!error || seen.has(error)) return [];
  seen.add(error);
  const nested = [error.cause, ...(error.errors ?? [])];
  return [error.code, ...nested.flatMap((inner) => errorCodesOf(inner, seen))].filter(Boolean);
}

function classifyError(error, signal) {
  if (error instanceof TargetPolicyError) {
    return error.code === TARGET_ERROR.DNS_ERROR ? CHECK_ERROR.DNS_ERROR : CHECK_ERROR.BLOCKED_TARGET;
  }
  if (signal.aborted) return CHECK_ERROR.TIMEOUT;

  const codes = errorCodesOf(error).map(String);
  if (codes.some((code) => TIMEOUT_ERROR_CODES.has(code))) return CHECK_ERROR.TIMEOUT;
  if (codes.some((code) => TLS_ERROR_PATTERN.test(code))) return CHECK_ERROR.TLS_ERROR;
  if (codes.some((code) => CONNECTION_ERROR_CODES.has(code))) return CHECK_ERROR.CONNECTION_ERROR;
  return CHECK_ERROR.NETWORK_ERROR;
}

/**
 * An HTTP agent that can only reach the approved addresses. Node asks this function
 * where to connect instead of asking DNS, so a second DNS answer cannot redirect the
 * connection. TLS still verifies the certificate against the original host name.
 */
function createPinnedAgent(addresses, timeoutMs) {
  const lookup = (_hostname, options, callback) => {
    if (options.all) {
      callback(null, addresses);
    } else {
      callback(null, addresses[0].address, addresses[0].family);
    }
  };

  return new Agent({
    connect: { lookup, timeout: timeoutMs },
    connections: 1,
    maxHeaderSize: MAX_RESPONSE_HEADER_BYTES,
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
  });
}

// Reads and discards the body, stopping at the limit. Nothing is kept in memory.
async function drainBody(body, maxBytes) {
  let bytesRead = 0;
  for await (const chunk of body) {
    bytesRead += chunk.length;
    if (bytesRead >= maxBytes) return { truncated: true };
  }
  return { truncated: false };
}

function rejectOnAbort(promise, signal) {
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  ]);
}

/**
 * Performs one outbound check and always resolves with a result object. A website
 * failing is normal data for a monitor, not an exception.
 *
 * `resolve` exists so tests can target a local server. It is a code-level parameter
 * with no environment variable behind it, so a deployment cannot switch the policy off.
 */
export async function performHttpCheck(rawUrl, { timeoutMs, maxBytes, resolve = resolveTarget }) {
  // One deadline for the whole check: DNS, connect, TLS, headers and body together.
  const signal = AbortSignal.timeout(timeoutMs);
  const startedAt = performance.now();
  const elapsedMs = () => Math.round(performance.now() - startedAt);
  let agent;

  try {
    const { url, addresses } = await rejectOnAbort(resolve(rawUrl), signal);
    agent = createPinnedAgent(addresses, timeoutMs);

    // undici's request() never follows redirects, so a public URL cannot redirect the
    // worker to an internal one. It sends no Accept-Encoding and does not decompress,
    // which also rules out a small compressed response expanding in memory.
    const { statusCode, body } = await request(url, {
      method: 'GET',
      dispatcher: agent,
      signal,
      headers: { 'user-agent': 'SitePulse/1.0 (uptime monitor)', accept: '*/*' },
    });

    if (statusCode < MIN_SUCCESS_STATUS || statusCode > MAX_SUCCESS_STATUS) {
      const responseTimeMs = elapsedMs();
      // The status already decides the result. undici emits an "error" event when an
      // unread body is destroyed; without a listener that would crash the whole process.
      body.on('error', () => {});
      body.destroy();
      return {
        success: false,
        httpStatus: statusCode,
        responseTimeMs,
        errorCode: CHECK_ERROR.HTTP_STATUS,
        errorMessage: `The server responded with HTTP ${statusCode}.`,
        bodyTruncated: false,
      };
    }

    const { truncated } = await drainBody(body, maxBytes);
    return {
      success: true,
      httpStatus: statusCode,
      responseTimeMs: elapsedMs(),
      errorCode: null,
      errorMessage: null,
      bodyTruncated: truncated,
    };
  } catch (error) {
    const errorCode = classifyError(error, signal);
    return {
      success: false,
      httpStatus: null,
      responseTimeMs: null,
      errorCode,
      errorMessage: ERROR_MESSAGES[errorCode],
      bodyTruncated: false,
    };
  } finally {
    // One agent per check, always destroyed: no pooled socket outlives its validation.
    agent?.destroy().catch(() => {});
  }
}
