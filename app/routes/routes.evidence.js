import { raw, Router } from 'express';
import { verificarToken } from '../middleware/auth.middleware.js';
import { createEvidenceController } from '../controllers/controller.evidence.js';

export function createEvidenceRouter({ pool, authorizeRead, authorizeDownload = authorizeRead,
  authorizeUpload, authorizeUploadBytes = authorizeUpload, authorizeLink = authorizeUpload, storage } = {}) {
  for (const [name, guard] of Object.entries({ authorizeRead, authorizeDownload, authorizeUpload, authorizeUploadBytes, authorizeLink })) {
    if (typeof guard !== 'function') throw new TypeError(`${name} authorization middleware is required.`);
  }
  const controller = createEvidenceController({ pool, storage });
  const router = Router();
  router.get('/evidencias/actividad/:id', verificarToken, authorizeRead, controller.listByActivity);
  router.get('/evidencias/:id/descarga', verificarToken, authorizeDownload, controller.download);
  router.post('/evidencias', verificarToken, authorizeUpload, controller.upload);
  router.post('/actividades/:id/evidencias',verificarToken,authorizeUploadBytes,controller.checkIntegration,raw({type:'application/octet-stream',limit:10*1024*1024}),controller.uploadBytes);
  router.post('/evidencias/:id/vinculo',verificarToken,authorizeLink,controller.link);
  return router;
}
