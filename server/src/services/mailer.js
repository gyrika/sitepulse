import nodemailer from 'nodemailer';
import { config } from '../config/env.js';
import { SMTP_SECURITY } from '../config/monitoring.js';

export function createMailer(alerts = config.alerts) {
  const transport = nodemailer.createTransport({
    host: alerts.smtpHost,
    port: alerts.smtpPort,
    secure: alerts.smtpSecurity === SMTP_SECURITY.TLS,
    // Fail rather than send the password in clear text if the server drops STARTTLS.
    requireTLS: alerts.smtpSecurity === SMTP_SECURITY.STARTTLS,
    ignoreTLS: alerts.smtpSecurity === SMTP_SECURITY.NONE,
    auth: alerts.smtpUser ? { user: alerts.smtpUser, pass: alerts.smtpPassword } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });

  return (message) => transport.sendMail({ from: alerts.from, to: alerts.to, ...message });
}

let mailer;

export function sendAlertEmail(message) {
  mailer ??= createMailer();
  return mailer(message);
}
