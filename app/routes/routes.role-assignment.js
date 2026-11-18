import { Router } from 'express';
import { createRoleAssignmentController } from '../controllers/controller.role-assignment.js';
import { verificarToken } from '../middleware/auth.middleware.js';
import { isRoleAssignmentServiceFromProtectedComposition } from '../services/role-assignment.composition.js';

/**
 * Builds opt-in endpoints. This router is deliberately not mounted by index.js.
 * The host must inject its trusted JWT authenticator; service authorization remains
 * the authority for every write operation.
 */
export function createRoleAssignmentRouter({ service } = {}) {
  if (!isRoleAssignmentServiceFromProtectedComposition(service)) {
    throw new TypeError('The router requires a service from the protected role-assignment composition.');
  }
  const controller = createRoleAssignmentController(service);
  const router = Router();
  router.get('/roles/asignacion-recursos', verificarToken, controller.listAssignableResources);
  router.post('/roles/asignaciones', verificarToken, controller.assign);
  router.post('/roles/asignaciones/:assignmentId/revocacion', verificarToken, controller.revoke);
  router.post('/roles/solicitudes/:requestId/decision', verificarToken, controller.decide);
  return router;
}
