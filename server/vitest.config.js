import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    globalSetup: ['tests/helpers/globalSetup.js'],
    // Database tests share one MongoDB, so test files run one after another.
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 120000,
    env: {
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb://set-by-test-helper/unused',
      ADMIN_API_TOKEN: 'test-admin-token-that-is-long-enough-1234',
      ADMIN_PASSWORD: 'test-admin-password',
      SESSION_SECRET: 'test-session-secret-that-is-long-enough-1234',
      RATE_LIMIT_PER_MINUTE: '100000',
      CHECK_TIMEOUT_MS: '2000',
      // Turns on alert queueing. Nothing connects here: tests pass their own mail sender.
      SMTP_HOST: '127.0.0.1',
      SMTP_SECURITY: 'none',
      ALERT_EMAIL_FROM: 'sitepulse@example.test',
      ALERT_EMAIL_TO: 'admin@example.test',
    },
  },
});
