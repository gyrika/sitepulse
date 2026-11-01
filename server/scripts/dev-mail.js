// A local mail server for development. It accepts every message and prints it here;
// nothing is ever delivered to a real inbox. It only listens on 127.0.0.1.
import { SMTPServer } from 'smtp-server';

const PORT = 1025;

const server = new SMTPServer({
  authOptional: true,
  disabledCommands: ['STARTTLS'],
  onData(stream, _session, callback) {
    let message = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      message += chunk;
    });
    stream.on('end', () => {
      console.log(`\n----- ${new Date().toISOString()} -----\n${message}`);
      callback();
    });
  },
});

server.on('error', (error) => console.error(error.message));
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Dev mail server ready on 127.0.0.1:${PORT}  (press Ctrl+C to stop)`);
});

const stop = () => server.close(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
