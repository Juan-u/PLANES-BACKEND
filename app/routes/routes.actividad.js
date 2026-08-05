import { Router } from 'express';
import verificarToken from '../middleware/auth.middleware.js';
import {
    getActividades,
    getActividadById,
    crearActividad,
    actualizarActividad,
    eliminarActividad
} from '../controllers/controller.actividad.js';

const router = Router();

router.get   ('/actividades',     verificarToken, getActividades);
router.get   ('/actividades/:id', verificarToken, getActividadById);
router.post  ('/actividades',     verificarToken, crearActividad);
router.put   ('/actividades/:id', verificarToken, actualizarActividad);
router.delete('/actividades/:id', verificarToken, eliminarActividad);

export default router;
