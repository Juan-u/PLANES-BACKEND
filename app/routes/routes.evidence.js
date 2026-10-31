import { Router } from 'express';
import { verificarToken } from '../middleware/auth.middleware.js';
import { createEvidenceController } from '../controllers/controller.evidence.js';

export function createEvidenceRouter({ pool, authorizeRead, authorizeUpload, storage } = {}) {
  for (const [name, guard] of Object.entries({ authorizeRead, authorizeUpload })) {
    if (typeof guard !== 'function') throw new TypeError(`${name} authorization middleware is required.`);
  }
  const controller = createEvidenceController({ pool, storage });
  const router = Router();
  router.get('/evidencias/actividad/:id', verificarToken, authorizeRead, controller.listByActivity);
  router.get('/evidencias/:id/descarga', verificarToken, authorizeRead, controller.download);
  router.post('/evidencias', verificarToken, authorizeUpload, controller.upload);
  return router;
}
