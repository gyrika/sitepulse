import mongoose from 'mongoose';
import { ALERT_STATUS, ALERT_TYPE } from '../config/monitoring.js';
import { toJsonOptions } from './schemaOptions.js';

const alertSchema = new mongoose.Schema(
  {
    incident: { type: mongoose.Schema.Types.ObjectId, ref: 'Incident', required: true },
    monitor: { type: mongoose.Schema.Types.ObjectId, ref: 'Monitor', required: true },
    type: { type: String, enum: Object.values(ALERT_TYPE), required: true },
    status: { type: String, enum: Object.values(ALERT_STATUS), default: ALERT_STATUS.PENDING },

    // When the outage began (DOWN) or ended (RECOVERED). Stored here because a RECOVERED
    // alert is created just before its incident is closed.
    occurredAt: { type: Date, required: true },

    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: () => new Date() },
    lockToken: { type: String, default: null },
    lockedUntil: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    lastError: { type: String, default: null },
  },
  { timestamps: true, toJSON: toJsonOptions(['lockToken', 'lockedUntil']) },
);

// The duplicate protection: the database allows one alert of each type per incident,
// however many workers, retries or repair passes try to create it.
alertSchema.index({ incident: 1, type: 1 }, { unique: true });
alertSchema.index({ status: 1, nextAttemptAt: 1 });
alertSchema.index({ monitor: 1, status: 1 });

export const Alert = mongoose.model('Alert', alertSchema);
