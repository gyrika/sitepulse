// Runs a real local MongoDB for development without installing one system-wide.
// Data persists in server/.dev-db. It only listens on 127.0.0.1.
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';

const dbPath = fileURLToPath(new URL('../.dev-db', import.meta.url));
await mkdir(dbPath, { recursive: true });

const server = await MongoMemoryServer.create({
  instance: { port: 27017, ip: '127.0.0.1', dbName: 'sitepulse', dbPath, storageEngine: 'wiredTiger' },
});
console.log(`MongoDB ready: ${server.getUri()}  (press Ctrl+C to stop)`);

const stop = async () => {
  await server.stop({ doCleanup: false });
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
