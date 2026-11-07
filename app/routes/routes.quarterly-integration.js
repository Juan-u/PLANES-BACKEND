import {Router} from 'express';
import {verificarToken} from '../middleware/auth.middleware.js';
import {createQuarterlyIntegrationService} from '../services/quarterly-integration.service.js';
import {createQuarterlyIntegrationController} from '../controllers/controller.quarterly-integration.js';
export function createQuarterlyIntegrationRouter({pool}={}){
  const c=createQuarterlyIntegrationController(createQuarterlyIntegrationService({pool}));
  const router=Router();
  router.get('/seguimiento/integrado',verificarToken,c.overview);
  router.get('/evidencias/opciones',verificarToken,c.options);
  router.post('/periodos/:id/solicitudes-reapertura',verificarToken,c.requestReopen);
  router.post('/seguimiento/institucional/:action',verificarToken,c.act);
  return router;
}
