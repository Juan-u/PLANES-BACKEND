import { Router } from 'express';
import verificarToken from '../middleware/auth.middleware.js';

import {
    getUsuarios,
    getUsuariosById,
    crearUsuarios,
    actualizarUsuarios,
    eliminarUsuarios
} from '../controllers/controller.usuario.js';

const router = Router();

router.get('/usuarios', verificarToken, getUsuarios);
router.get('/usuarios/:id', verificarToken, getUsuariosById);
router.post('/usuarios', verificarToken, crearUsuarios);
router.put('/usuarios/:id', verificarToken, actualizarUsuarios);
router.delete('/usuarios/:id', verificarToken, eliminarUsuarios);

export default router;
