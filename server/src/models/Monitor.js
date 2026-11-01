import mongoose from 'mongoose';
import { MONITOR_STATUS } from '../config/monitoring.js';
import { toJsonOptions } from './schemaOptions.js';

const monitorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    url: { type: String, required: true, unique: true, maxlength: 2048 },
    paused: { type: Boolean, default: false },

    status: { type: String, enum: Object.values(MONITOR_STATUS), default: MONITOR_STATUS.PENDING },
    lastStatusChangeAt: { type: Date, default: null },

    // Streaks drive the DOWN-after-3 and UP-after-2 rules. Their start times become
    // the incident's timestamps: the outage began at the first failure, not the third.
    consecutiveFailures: { type: Number, default: 0 },
    consecutiveSuccesses: { type: Number, default: 0 },
    failureStreakStartedAt: { type: Date, default: null },
    successStreakStartedAt: { type: Date, default: null },

    // Copied from the latest check so the dashboard needs no extra query.
    lastCheckedAt: { type: Date, default: null },
    lastResponseTimeMs: { type: Number, default: null },
    lastHttpStatus: { type: Number, default: null },
    lastErrorCode: { type: String, default: null },

    // Scheduling and locking state. MongoDB is the single source of truth, so any
    // number of workers can share this collection without a separate lock service.
    nextCheckAt: { type: Date, default: () => new Date() },
    lockToken: { type: String, default: null },
    lockedUntil: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: toJsonOptions(['nextCheckAt', 'lockToken', 'lockedUntil']),
  },
);

monitorSchema.index({ paused: 1, nextCheckAt: 1 });

export const Monitor = mongoose.model('Monitor', monitorSchema);
