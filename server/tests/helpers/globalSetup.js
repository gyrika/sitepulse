import { MongoMemoryServer } from 'mongodb-memory-server';

export default async function globalSetup({ provide }) {
  const server = await MongoMemoryServer.create();
  provide('mongoUri', server.getUri('sitepulse-test'));
  return () => server.stop();
}
