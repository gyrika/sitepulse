import { z } from 'zod';
import { SMTP_SECURITY } from './monitoring.js';

// A line like `SMTP_HOST=` in .env means "not set", not an empty value.
const blankAsUnset = (schema) => z.preprocess((value) => (value === '' ? undefined : value), schema);

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

const parseAddressList = (value = '') => value.split(',').map((address) => address.trim()).filter(Boolean);

function validateAlertSettings(values, context) {
  const problem = (path, message) => context.addIssue({ code: 'custom', path: [path], message });

  if (!values.SMTP_HOST) return;

  if (!values.ALERT_EMAIL_FROM) problem('ALERT_EMAIL_FROM', 'is required when SMTP_HOST is set');

  const recipients = parseAddressList(values.ALERT_EMAIL_TO);
  if (recipients.length === 0) problem('ALERT_EMAIL_TO', 'is required when SMTP_HOST is set');
  if (recipients.some((address) => !z.email().safeParse(address).success)) {
    problem('ALERT_EMAIL_TO', 'must be a comma-separated list of email addresses');
  }

  if (Boolean(values.SMTP_USER) !== Boolean(values.SMTP_PASSWORD)) {
    problem('SMTP_PASSWORD', 'SMTP_USER and SMTP_PASSWORD must be set together');
  }

  // Alerts and the SMTP password must not cross a network unencrypted.
  if (values.SMTP_SECURITY === SMTP_SECURITY.NONE && !LOOPBACK_HOSTS.has(values.SMTP_HOST)) {
    problem('SMTP_SECURITY', 'can only be "none" for a mail server on this machine');
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  MONGODB_URI: z.string().min(1, 'is required'),
  ADMIN_API_TOKEN: z.string().min(32, 'must be at least 32 characters (run: npm run token)'),
  ADMIN_PASSWORD: z.string().min(12, 'must be at least 12 characters'),
  SESSION_SECRET: z.string().min(32, 'must be at least 32 characters (run: npm run token)'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean)),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(300),
  CHECK_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(10000),
  CHECK_MAX_RESPONSE_BYTES: z.coerce.number().int().min(1024).max(10485760).default(1048576),
  CHECK_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(200).default(20),
  SMTP_HOST: blankAsUnset(z.string().optional()),
  SMTP_PORT: blankAsUnset(z.coerce.number().int().min(1).max(65535).optional()),
  SMTP_SECURITY: blankAsUnset(z.enum(Object.values(SMTP_SECURITY)).default(SMTP_SECURITY.STARTTLS)),
  SMTP_USER: blankAsUnset(z.string().optional()),
  SMTP_PASSWORD: blankAsUnset(z.string().optional()),
  ALERT_EMAIL_FROM: blankAsUnset(z.string().optional()),
  ALERT_EMAIL_TO: blankAsUnset(z.string().optional()),
  DASHBOARD_URL: blankAsUnset(z.url().optional()),
}).superRefine(validateAlertSettings);

export function loadConfig(env) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    // Name the variables but never print their values: they may be secrets.
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }

  const values = parsed.data;
  return {
    nodeEnv: values.NODE_ENV,
    host: values.HOST,
    port: values.PORT,
    mongodbUri: values.MONGODB_URI,
    adminApiToken: values.ADMIN_API_TOKEN,
    adminPassword: values.ADMIN_PASSWORD,
    sessionSecret: values.SESSION_SECRET,
    corsOrigins: values.CORS_ORIGINS,
    trustProxyHops: values.TRUST_PROXY_HOPS,
    rateLimitPerMinute: values.RATE_LIMIT_PER_MINUTE,
    checkTimeoutMs: values.CHECK_TIMEOUT_MS,
    checkMaxResponseBytes: values.CHECK_MAX_RESPONSE_BYTES,
    checkMaxConcurrency: values.CHECK_MAX_CONCURRENCY,
    alerts: {
      enabled: Boolean(values.SMTP_HOST),
      smtpHost: values.SMTP_HOST,
      smtpPort: values.SMTP_PORT ?? (values.SMTP_SECURITY === SMTP_SECURITY.TLS ? 465 : 587),
      smtpSecurity: values.SMTP_SECURITY,
      smtpUser: values.SMTP_USER,
      smtpPassword: values.SMTP_PASSWORD,
      from: values.ALERT_EMAIL_FROM,
      to: parseAddressList(values.ALERT_EMAIL_TO),
      dashboardUrl: values.DASHBOARD_URL,
    },
  };
}

// Failing here stops the process at startup instead of at the first request.
export const config = loadConfig(process.env);
