import { Router } from "express";
import verificarToken from "../middleware/auth.middleware.js";
import verificarRol from "../middleware/rol.middleware.js";

import {
    getRoles,
    getRolById,
    crearRol,
    actualizarRol
} from "../controllers/controller.rol.js";

const router = Router();

router.get("/roles", verificarToken, getRoles);
router.get("/roles/:id", verificarToken, getRolById);
router.post("/roles",  verificarToken, verificarRol(1),  crearRol );
router.put( "/roles/:id",    verificarToken,    verificarRol(1), actualizarRol);

export default router;
