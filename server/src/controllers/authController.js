import { config } from '../config/env.js';
import {
  createSessionValue,
  isValidSessionValue,
  secretsMatch,
  SESSION_COOKIE,
} from '../services/sessionService.js';
import { AppError } from '../utils/AppError.js';

const cookieOptions = {
  // JavaScript cannot read it, so a script injected into the page cannot steal it.
  httpOnly: true,
  // Browsers do not send it on requests that start from other sites.
  sameSite: 'strict',
  // HTTPS only in production. Local development runs on plain http://localhost.
  secure: config.nodeEnv === 'production',
  path: '/',
};

export function login(req, res) {
  if (!secretsMatch(req.validated.body.password, config.adminPassword)) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'That password is not correct.');
  }
  const { value, maxAgeMs } = createSessionValue();
  res.cookie(SESSION_COOKIE, value, { ...cookieOptions, maxAge: maxAgeMs });
  res.json({ data: { authenticated: true } });
}

export function logout(_req, res) {
  res.clearCookie(SESSION_COOKIE, cookieOptions);
  res.status(204).end();
}

// Tells the frontend whether to show the login page. Always 200, as "signed out" is
// a normal answer here and not an error.
export function getSession(req, res) {
  res.json({ data: { authenticated: isValidSessionValue(req.cookies?.[SESSION_COOKIE]) } });
}
