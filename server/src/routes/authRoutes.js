import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import * as auth from '../controllers/authController.js';
import { validate } from '../middleware/validate.js';

const loginBody = z.strictObject({ password: z.string().min(1, 'Password is required.').max(200) });

// A function so each app instance gets its own limiter state.
export function createAuthRoutes() {
  // Failed attempts only, so normal use never hits it, while guessing stays impractical.
  const loginLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 10,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many failed attempts. Try again in 15 minutes.' } },
  });

  const routes = Router();
  routes.post('/login', loginLimiter, validate({ body: loginBody }), auth.login);
  routes.post('/logout', auth.logout);
  routes.get('/session', auth.getSession);
  return routes;
}
