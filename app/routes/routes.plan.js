import { Router } from 'express';
import verificarToken from '../middleware/auth.middleware.js';
import {
    getPlanes,
    getPlanById,
    crearPlan,
    actualizarPlan,
    eliminarPlan
} from '../controllers/controller.plan.js';

const router = Router();

router.get   ('/planes',     verificarToken, getPlanes);
router.get   ('/planes/:id', verificarToken, getPlanById);
router.post  ('/planes',     verificarToken, crearPlan);
router.put   ('/planes/:id', verificarToken, actualizarPlan);
router.delete('/planes/:id', verificarToken, eliminarPlan);

export default router;
