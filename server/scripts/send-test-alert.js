// Sends one test email using the settings in .env, to prove they work before an outage does.
import { config } from '../src/config/env.js';
import { createMailer } from '../src/services/mailer.js';

if (!config.alerts.enabled) {
  console.error('Email alerts are off. Set SMTP_HOST, ALERT_EMAIL_FROM and ALERT_EMAIL_TO in .env.');
  process.exit(1);
}

try {
  await createMailer()({
    subject: '[SitePulse] Test alert',
    text: 'This is a test. If you can read it, SitePulse can send you alerts.',
  });
  console.log(`Sent to ${config.alerts.to.join(', ')}`);
} catch (error) {
  console.error(`Could not send: ${error.message}`);
  process.exit(1);
}
