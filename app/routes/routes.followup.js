import { Router } from 'express';
import { verificarToken } from '../middleware/auth.middleware.js';
import { createFollowupController } from '../controllers/controller.followup.js';

export function createFollowupRouter({ pool, authorizeRead, authorizeCreate, authorizeUpdate, authorizeApprove, authorizeReportRead } = {}) {
  for (const [name, guard] of Object.entries({ authorizeRead, authorizeCreate, authorizeUpdate, authorizeApprove, authorizeReportRead })) {
    if (typeof guard !== 'function') throw new TypeError(`${name} authorization middleware is required.`);
  }
  const c = createFollowupController(pool);
  const router = Router();
  router.get('/periodos', verificarToken, authorizeRead, c.listPeriods);
  router.post('/periodos', verificarToken, authorizeUpdate, c.createPeriod);
  router.post('/periodos/:id/cierre', verificarToken, authorizeUpdate, c.closePeriod);
  router.get('/periodos/:id/actividades', verificarToken, authorizeRead, c.listActivities);
  router.get('/periodos/:id/historial', verificarToken, authorizeRead, c.listPeriodHistory);
  router.get('/periodos/:id/resumen', verificarToken, authorizeRead, c.summary);
  router.get('/actividades/:id/seguimientos', verificarToken, authorizeRead, c.getActivityHistory);
  router.post('/actividades/:id/seguimientos', verificarToken, authorizeCreate, c.createFollowup);
  router.post('/seguimientos/:id/decision', verificarToken, authorizeApprove, c.decideFollowup);
  router.get('/informes/seguimiento', verificarToken, authorizeReportRead, c.summary);
  return router;
}
