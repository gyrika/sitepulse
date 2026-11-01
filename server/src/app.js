import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { config } from './config/env.js';
import { isDatabaseConnected } from './config/db.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requireAdmin } from './middleware/requireAdmin.js';
import { createAuthRoutes } from './routes/authRoutes.js';
import { dashboardRoutes } from './routes/dashboardRoutes.js';
import { monitorRoutes } from './routes/monitorRoutes.js';

// Builds the app without opening a port, so tests can call it directly.
export function createApp() {
  const app = express();

  app.set('trust proxy', config.trustProxyHops);
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '16kb' }));
  app.use(cookieParser());

  // Public, for uptime checks and load balancers. It reveals nothing except health.
  app.get('/health', (_req, res) => {
    const healthy = isDatabaseConnected();
    res.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'unavailable' });
  });

  const api = express.Router();
  api.use(
    rateLimit({
      windowMs: 60_000,
      limit: config.rateLimitPerMinute,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again shortly.' } },
    }),
  );
  api.use('/auth', createAuthRoutes());
  // Every other API route requires the admin, including reads: monitored URLs can be private.
  api.use(requireAdmin);
  api.use('/monitors', monitorRoutes);
  api.use('/dashboard', dashboardRoutes);
  app.use('/api', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
