import { Router } from 'express';
import * as monitors from '../controllers/monitorController.js';
import { validate } from '../middleware/validate.js';
import {
  createMonitorBody,
  listChecksQuery,
  listIncidentsQuery,
  monitorIdParams,
  updateMonitorBody,
} from '../validators/monitorValidators.js';

export const monitorRoutes = Router();

monitorRoutes.get('/', monitors.listMonitors);
monitorRoutes.post('/', validate({ body: createMonitorBody }), monitors.createMonitor);

monitorRoutes.get('/:id', validate({ params: monitorIdParams }), monitors.getMonitor);
monitorRoutes.patch('/:id', validate({ params: monitorIdParams, body: updateMonitorBody }), monitors.updateMonitor);
monitorRoutes.delete('/:id', validate({ params: monitorIdParams }), monitors.deleteMonitor);

monitorRoutes.get('/:id/checks', validate({ params: monitorIdParams, query: listChecksQuery }), monitors.listChecks);
monitorRoutes.post('/:id/check', validate({ params: monitorIdParams }), monitors.runManualCheck);
monitorRoutes.get('/:id/incidents', validate({ params: monitorIdParams, query: listIncidentsQuery }), monitors.listIncidents);
