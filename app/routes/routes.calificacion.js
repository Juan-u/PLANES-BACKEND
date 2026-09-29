import { Router } from 'express';
import verificarRol from '../middleware/rol.middleware.js';
import verificarToken from '../middleware/auth.middleware.js';
import {
    getCalificaciones,
    getCalificacionById,
    crearCalificacion,
    actualizarCalificacion

} from '../controllers/controller.calificacion.js';

const router = Router();

router.get   ('/calificaciones',     verificarToken, getCalificaciones);
router.get   ('/calificacion/:id', verificarToken, getCalificacionById);
router.post  ('/calificacion',     verificarToken,verificarRol(1), crearCalificacion);
router.put   ('/calificacion/:id', verificarToken,verificarRol(1), actualizarCalificacion);


export default router;