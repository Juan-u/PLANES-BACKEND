import { Router } from 'express';
import { verificarToken } from '../middleware/auth.middleware.js';
import { createReadModelsController } from '../controllers/controller.readmodels.js';

export function createReadModelsRouter({ pool, authorizeReportRead, authorizeReportExport } = {}) {
  for (const [name, guard] of Object.entries({ authorizeReportRead, authorizeReportExport })) {
    if (typeof guard !== 'function') throw new TypeError(`${name} authorization middleware is required.`);
  }
  const controller = createReadModelsController(pool);
  const router = Router();
  router.get('/informes/calificaciones', verificarToken, authorizeReportRead, controller.listAssessments);
  router.get('/informes/calificaciones/export.csv', verificarToken, authorizeReportExport, controller.exportAssessments);
  return router;
}
