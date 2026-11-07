import { Router } from 'express';
import { createRoleAdministrationController } from '../controllers/controller.role-administration.js';
import { verificarToken } from '../middleware/auth.middleware.js';
import { isProtectedRoleAdministrationService } from '../services/role-administration.composition.js';

/** Non-production router. Authorization is checked inside every service transaction under the mutex. */
export function createRoleAdministrationRouter({ service } = {}) {
  if (!isProtectedRoleAdministrationService(service)) {
    throw new TypeError('The router requires a service from the protected administration composition.');
  }
  const controller = createRoleAdministrationController(service);
  const router = Router();
  router.get('/roles/catalogo', verificarToken, controller.listCatalog);
  router.get('/roles/permisos', verificarToken, controller.listPermissions);
  router.get('/roles/solicitudes', verificarToken, controller.listRequests);
  router.get('/roles/usuarios/:userId/asignaciones', verificarToken, controller.listAssignments);
  router.post('/roles/catalogo', verificarToken, controller.createRole);
  router.put('/roles/catalogo/:roleId/configuracion', verificarToken, controller.updateRoleConfiguration);
  router.put('/roles/catalogo/:roleId/permisos', verificarToken, controller.setRolePermissions);
  router.put('/roles/permisos/:code/estado', verificarToken, controller.setPermissionActive);
  return router;
}

/** Self-only capability snapshot; it has no mutation surface. */
export function createRoleCapabilitiesRouter({ service } = {}) {
  if (!isProtectedRoleAdministrationService(service)) {
    throw new TypeError('The router requires a service from the protected administration composition.');
  }
  const controller = createRoleAdministrationController(service);
  const router = Router();
  router.get('/roles/capacidades', verificarToken, controller.getCapabilities);
  return router;
}
