import { config } from '../config/env.js';
import { isValidSessionValue, secretsMatch, SESSION_COOKIE } from '../services/sessionService.js';
import { AppError } from '../utils/AppError.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Browsers attach cookies automatically, even to requests started by other websites
// (CSRF). SameSite=Strict blocks that in current browsers; this checks a second time
// by refusing writes that declare an origin we do not trust.
function assertTrustedOrigin(req) {
  const origin = req.get('origin');
  if (!SAFE_METHODS.has(req.method) && origin && !config.corsOrigins.includes(origin)) {
    throw new AppError(403, 'UNTRUSTED_ORIGIN', 'This request came from an untrusted origin.');
  }
}

// Two ways in: a bearer token for scripts and curl, a session cookie for the dashboard.
export function requireAdmin(req, res, next) {
  const [scheme, token] = (req.get('authorization') ?? '').split(' ');
  if (scheme === 'Bearer' && token && secretsMatch(token, config.adminApiToken)) {
    return next();
  }

  if (isValidSessionValue(req.cookies?.[SESSION_COOKIE])) {
    assertTrustedOrigin(req);
    return next();
  }

  res.set('WWW-Authenticate', 'Bearer');
  throw new AppError(401, 'UNAUTHORIZED', 'Please sign in.');
}
