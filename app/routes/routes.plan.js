import { Router } from 'express';
import { verificarToken } from '../middleware/auth.middleware.js';
import { crearControladorConsultaPlanes } from '../controllers/controller.plan.js';

/**
 * Construye rutas de consulta, pero exige que el llamador proporcione una
 * política de autorización. El router no se monta hasta que esa política sea
 * aprobada e implementada.
 */
export function crearRouterPlanes({ pool, autorizarConsultaPlanes, autorizarCrearPlan, autorizarActualizarPlan } = {}) {
  if (typeof autorizarConsultaPlanes !== 'function') {
    throw new TypeError('Se requiere una política de autorización para consultar planes.');
  }

  if (autorizarCrearPlan != null && typeof autorizarCrearPlan !== 'function') {
    throw new TypeError('La política para crear planes debe ser una función.');
  }
  if (autorizarActualizarPlan != null && typeof autorizarActualizarPlan !== 'function') {
    throw new TypeError('La política para actualizar planes debe ser una función.');
  }

  const { listarPlanes, obtenerPlan, crearPlan, actualizarPlan, catalogoInstitucional } = crearControladorConsultaPlanes(pool);
  const router = Router();

  router.get('/planes', verificarToken, autorizarConsultaPlanes, listarPlanes);
  router.get('/planes/catalogo-institucional', verificarToken, autorizarConsultaPlanes, catalogoInstitucional);
  router.get('/planes/:id', verificarToken, autorizarConsultaPlanes, obtenerPlan);
  if (autorizarCrearPlan) router.post('/planes', verificarToken, autorizarCrearPlan, crearPlan);
  if (autorizarActualizarPlan) router.put('/planes/:id', verificarToken, autorizarActualizarPlan, actualizarPlan);

  return router;
}
