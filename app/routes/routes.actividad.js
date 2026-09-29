import { Router } from 'express';
import verificarRol from '../middleware/rol.middleware.js';
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
router.post  ('/actividades',     verificarToken,verificarRol, crearActividad);
router.put   ('/actividades/:id', verificarToken,verificarRol, actualizarActividad);
router.delete('/actividades/:id', verificarToken, verificarRol,eliminarActividad);


export default router;
