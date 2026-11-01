import { getDashboardSummary } from '../services/dashboardService.js';

export async function getSummary(_req, res) {
  res.json({ data: await getDashboardSummary() });
}
