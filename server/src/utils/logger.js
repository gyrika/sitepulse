// Monitored URLs can contain secrets in their query strings, so log monitor ids rather than URLs.
function write(level, message, meta) {
  if (process.env.NODE_ENV === 'test') return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...meta });
  if (level === 'error') console.error(line);
  else console.log(line);
}

export const logger = {
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),
};
