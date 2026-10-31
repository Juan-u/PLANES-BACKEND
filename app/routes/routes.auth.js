import { Router } from 'express';
import { login, verificarSesion } from '../controllers/controller.auth.js';
import { verificarToken } from '../middleware/auth.middleware.js';

const router = Router();

router.post('/login', login);
router.get('/session', verificarToken, verificarSesion);

export default router;
