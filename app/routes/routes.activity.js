import { Router } from 'express';
import { verificarToken } from '../middleware/auth.middleware.js';
import { createActivityController } from '../controllers/controller.activity.js';

export function createActivityRouter({ pool, authorizeRead, authorizeCreate, authorizeUpdate } = {}) {
  for (const [name, guard] of Object.entries({ authorizeRead, authorizeCreate, authorizeUpdate })) {
    if (typeof guard !== 'function') throw new TypeError(`${name} authorization middleware is required.`);
  }
  const controller = createActivityController(pool);
  const router = Router();
  router.get('/actividades', verificarToken, authorizeRead, controller.list);
  router.get('/actividades/:id', verificarToken, authorizeRead, controller.getById);
  router.post('/actividades', verificarToken, authorizeCreate, controller.create);
  router.put('/actividades/:id', verificarToken, authorizeUpdate, controller.update);
  return router;
}
