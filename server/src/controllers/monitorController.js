import { checkRunner } from '../services/checkRunner.js';
import * as monitorService from '../services/monitorService.js';

// Controllers only translate between HTTP and services. Express 5 forwards rejected
// promises to the error handler, so no try/catch or asyncHandler wrapper is needed.

export async function listMonitors(_req, res) {
  res.json({ data: await monitorService.listMonitors() });
}

export async function createMonitor(req, res) {
  const monitor = await monitorService.createMonitor(req.validated.body);
  res.status(201).json({ data: monitor });
}

export async function getMonitor(req, res) {
  res.json({ data: await monitorService.getMonitor(req.validated.params.id) });
}

export async function updateMonitor(req, res) {
  const { params, body } = req.validated;
  res.json({ data: await monitorService.updateMonitor(params.id, body) });
}

export async function deleteMonitor(req, res) {
  await monitorService.deleteMonitor(req.validated.params.id);
  res.status(204).end();
}

export async function listChecks(req, res) {
  const { params, query } = req.validated;
  const { checks, nextBefore } = await monitorService.listChecks(params.id, query);
  res.json({ data: checks, meta: { limit: query.limit, nextBefore } });
}

export async function listIncidents(req, res) {
  const { params, query } = req.validated;
  res.json({ data: await monitorService.listIncidents(params.id, query) });
}

export async function runManualCheck(req, res) {
  const { monitor, check, transition } = await checkRunner.runManualCheck(req.validated.params.id);
  res.json({ data: { check: check.toJSON(), monitor: monitor.toJSON(), transition } });
}
