import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, inject } from 'vitest';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';

// Gives a test file a real MongoDB connection and empty collections for each test.
export function useTestDatabase() {
  beforeAll(() => connectDatabase(inject('mongoUri')));
  beforeEach(async () => {
    await Promise.all(Object.values(mongoose.models).map((model) => model.deleteMany({})));
  });
  afterAll(() => disconnectDatabase());
}
