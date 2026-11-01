import { z } from 'zod';
import { INCIDENT_STATUS } from '../config/monitoring.js';

const name = z.string().trim().min(1, 'Name is required.').max(100);
const url = z.string().trim().min(1, 'URL is required.').max(2048);
const isoDate = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

// A string of exactly 24 hex characters, so query operators such as {"$ne":null}
// can never reach MongoDB through an id.
export const monitorIdParams = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid monitor id.'),
});

// strictObject rejects unknown keys, so a client cannot set status, lockToken and so on.
export const createMonitorBody = z.strictObject({
  name,
  url,
  paused: z.boolean().optional(),
});

export const updateMonitorBody = z
  .strictObject({
    name: name.optional(),
    url: url.optional(),
    paused: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update.');

export const listChecksQuery = z.strictObject({
  // 1,500 covers a full day of checks at one per minute, for the 24-hour chart.
  limit: z.coerce.number().int().min(1).max(1500).default(100),
  before: isoDate.optional(),
  since: isoDate.optional(),
});

export const listIncidentsQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  status: z.enum(Object.values(INCIDENT_STATUS)).optional(),
});
