import mongoose from 'mongoose';
import { CHECK_ERROR, CHECK_RETENTION_DAYS, CHECK_SOURCE } from '../config/monitoring.js';
import { toJsonOptions } from './schemaOptions.js';

const checkResultSchema = new mongoose.Schema(
  {
    monitor: { type: mongoose.Schema.Types.ObjectId, ref: 'Monitor', required: true },
    checkedAt: { type: Date, required: true },
    success: { type: Boolean, required: true },
    source: { type: String, enum: Object.values(CHECK_SOURCE), default: CHECK_SOURCE.SCHEDULED },

    // Null when no HTTP response arrived, so failed connections cannot distort
    // response-time averages and charts.
    responseTimeMs: { type: Number, default: null },
    httpStatus: { type: Number, default: null },

    errorCode: { type: String, enum: [...Object.values(CHECK_ERROR), null], default: null },
    errorMessage: { type: String, default: null },
    bodyTruncated: { type: Boolean, default: false },
  },
  { toJSON: toJsonOptions() },
);

checkResultSchema.index({ monitor: 1, checkedAt: -1 });
// MongoDB deletes old checks automatically so the collection cannot grow forever.
checkResultSchema.index({ checkedAt: 1 }, { expireAfterSeconds: CHECK_RETENTION_DAYS * 24 * 60 * 60 });

export const CheckResult = mongoose.model('CheckResult', checkResultSchema);
