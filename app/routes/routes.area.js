import {Router} from "express";
import verificarToken from "../middleware/auth.middleware.js";
import {
    getAreas,
    getAreaById,
    crearArea,
    actualizarArea,
} from "../controllers/controller.periodo.js";

const router = Router();

router.get   ('/areas',     verificarToken, getAreas);
router.get   ('/areas/:id', verificarToken, getAreaById);
router.post  ('/areas',     verificarToken, crearArea);
router.put   ('/areas/:id', verificarToken, actualizarArea);

export default router;