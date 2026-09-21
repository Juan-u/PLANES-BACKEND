import {Router} from "express";
import verificarToken from "../middleware/auth.middleware.js";
import {
    getPeriodos,
    getPeriodoById,
    crearPeriodo,
    actualizarPeriodo,
} from "../controllers/controller.periodo.js";

const router = Router();

router.get   ('/periodos',     verificarToken, getPeriodos);
router.get   ('/periodos/:id', verificarToken, getPeriodoById);
router.post  ('/periodos',     verificarToken, crearPeriodo);
router.put   ('/periodos/:id', verificarToken, actualizarPeriodo);

export default router;