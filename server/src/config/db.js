import mongoose from 'mongoose';
import { CheckResult } from '../models/CheckResult.js';
import { Incident } from '../models/Incident.js';
import { Monitor } from '../models/Monitor.js';

export async function connectDatabase(uri) {
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000,
    // Fail fast during an outage instead of queueing queries in memory.
    bufferCommands: false,
  });

  // Wait for indexes: the "one open incident per monitor" and "unique URL" rules
  // are enforced by them, so they must exist before any work starts.
  await Promise.all([Monitor.init(), CheckResult.init(), Incident.init()]);
}

export function isDatabaseConnected() {
  return mongoose.connection.readyState === mongoose.ConnectionStates.connected;
}

export function disconnectDatabase() {
  return mongoose.disconnect();
}
