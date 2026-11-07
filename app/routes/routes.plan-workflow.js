import { Router } from 'express';
import { verificarToken } from '../middleware/auth.middleware.js';
import { createPlanWorkflowService } from '../services/plan-workflow.service.js';
import { createPlanWorkflowController } from '../controllers/controller.plan-workflow.js';
export function createPlanWorkflowRouter({pool}={}) {
  // Closed institutional authority is intentional. No body/env flag can enable it.
  const controller=createPlanWorkflowController(createPlanWorkflowService({pool}));
  const router=Router();
  router.get('/planeacion',verificarToken,controller.list);
  router.get('/planes/:id/flujo',verificarToken,controller.get);
  router.get('/planes/:id/flujo/validacion',verificarToken,controller.validate);
  router.post('/planes/:id/flujo/ficha',verificarToken,controller.saveProfile);
  router.post('/planes/:id/flujo/acciones',verificarToken,controller.act);
  return router;
}
