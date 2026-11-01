import mongoose from 'mongoose';
import { INCIDENT_RESOLUTION, INCIDENT_STATUS } from '../config/monitoring.js';
import { toJsonOptions } from './schemaOptions.js';

const incidentSchema = new mongoose.Schema(
  {
    monitor: { type: mongoose.Schema.Types.ObjectId, ref: 'Monitor', required: true },
    status: { type: String, enum: Object.values(INCIDENT_STATUS), default: INCIDENT_STATUS.OPEN },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },
    resolution: { type: String, enum: [...Object.values(INCIDENT_RESOLUTION), null], default: null },

    // What the check that opened this incident saw.
    errorCode: { type: String, default: null },
    httpStatus: { type: Number, default: null },
  },
  { timestamps: true, toJSON: toJsonOptions() },
);

incidentSchema.index({ monitor: 1, startedAt: -1 });
incidentSchema.index({ startedAt: -1 });
// The database itself guarantees at most one open incident per monitor, even if two
// workers or a retry try to open one at the same moment.
incidentSchema.index(
  { monitor: 1 },
  { unique: true, partialFilterExpression: { status: INCIDENT_STATUS.OPEN } },
);

export const Incident = mongoose.model('Incident', incidentSchema);
