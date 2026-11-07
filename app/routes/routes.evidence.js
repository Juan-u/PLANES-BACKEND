import { raw, Router } from 'express';
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
  router.post('/actividades/:id/evidencias',verificarToken,authorizeUpload,controller.checkIntegration,raw({type:'application/octet-stream',limit:10*1024*1024}),controller.uploadBytes);
  router.post('/evidencias/:id/vinculo',verificarToken,authorizeUpload,controller.link);
  return router;
}
