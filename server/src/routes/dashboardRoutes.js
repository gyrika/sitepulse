import { Router } from 'express';
import { getSummary } from '../controllers/dashboardController.js';

export const dashboardRoutes = Router();

dashboardRoutes.get('/summary', getSummary);
