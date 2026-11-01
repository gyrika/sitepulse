import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config/env.js';

const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;

export const SESSION_COOKIE = 'sitepulse_session';

// Hashing gives both sides the same length, which timingSafeEqual requires. The
// constant-time compare stops an attacker learning a secret from response timing.
export function secretsMatch(candidate, expected) {
  const hash = (value) => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(candidate), hash(expected));
}

// The password is part of the key, so changing it signs every existing session out.
function sign(payload) {
  return createHmac('sha256', `${config.sessionSecret}:${config.adminPassword}`)
    .update(payload)
    .digest('base64url');
}

/**
 * A session is "expiry.signature". Only the server knows the key, so a browser cannot
 * forge one or extend its expiry, and no session storage is needed. The trade-off is
 * that logging out clears the cookie in that browser but cannot revoke a stolen copy
 * before it expires; only changing the password or SESSION_SECRET does that.
 */
export function createSessionValue(now = Date.now()) {
  const expiresAt = String(now + SESSION_DURATION_MS);
  return { value: `${expiresAt}.${sign(expiresAt)}`, maxAgeMs: SESSION_DURATION_MS };
}

export function isValidSessionValue(value, now = Date.now()) {
  if (typeof value !== 'string') return false;
  const [expiresAt, signature, ...rest] = value.split('.');
  if (!expiresAt || !signature || rest.length > 0) return false;
  return secretsMatch(signature, sign(expiresAt)) && Number(expiresAt) > now;
}
