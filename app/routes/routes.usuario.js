import { Router } from 'express';
import {
  listarUsuarios,
  obtenerUsuario,
  crearUsuario,
  actualizarUsuario,
  eliminarUsuario,
  reactivarUsuario
} from '../controllers/controller.usuario.js';
import { verificarToken } from '../middleware/auth.middleware.js';

export function createUsuarioRouter({ requirePermission } = {}) {
  if (typeof requirePermission !== 'function') {
    throw new TypeError('The users router requires a backend permission gate.');
  }
  const router = Router();
  router.get('/usuarios', verificarToken, requirePermission('M01.users.read'), listarUsuarios);
  router.get('/usuarios/:id', verificarToken, requirePermission('M01.users.read'), obtenerUsuario);
  // Write handlers authorize and audit inside the same mutex transaction as the write.
  router.post('/usuarios', verificarToken, crearUsuario);
  router.put('/usuarios/:id', verificarToken, actualizarUsuario);
  router.delete('/usuarios/:id', verificarToken, eliminarUsuario);
  router.post('/usuarios/:id/reactivacion', verificarToken, reactivarUsuario);
  return router;
}
