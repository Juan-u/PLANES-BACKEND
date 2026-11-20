import {Router} from "express";
import verificarRol from "../middleware/rol.middleware.js"
import verificarToken from "../middleware/auth.middleware.js";
import {
    getPeriodos,
    getPeriodoById,
    crearPeriodo,
    actualizarPeriodo,
    abrirPeriodo,
    cerrarPeriodo,
} from "../controllers/controller.periodo.js";

const router = Router();

router.get   ('/periodos',     verificarToken, getPeriodos);
router.get   ('/periodos/:id', verificarToken, getPeriodoById);
router.post  ('/periodos',     verificarToken,verificarRol(1,2),  crearPeriodo);
router.put   ('/periodos/:id', verificarToken, verificarRol(1,2), actualizarPeriodo);
router.put   ('/periodos/:id/abrir', verificarToken, verificarRol(1,2), abrirPeriodo);
router.put   ('/periodos/:id/cerrar', verificarToken, verificarRol(1,2), cerrarPeriodo);
export default router;