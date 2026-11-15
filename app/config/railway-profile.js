import {readFile, access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {
  PRODUCTION_DEPLOYMENT_PROFILE,
  validateProductionApplicationDatabase
} from '../../deployment/railway/production-policy.js';

export function railwayConfiguration(env = process.env) {
  if (!env.DEPLOYMENT_PROFILE) return null;
  if (env.DEPLOYMENT_PROFILE === 'railway-private-test') {
    if (env.NODE_ENV !== 'staging') throw new Error('La prueba Railway requiere el perfil staging explícito.');
    if (!env.DB_HOST?.endsWith('.railway.internal') || env.DB_PORT !== '3306' || env.DB_NAME !== 'planes_accion_railway_test' || env.DB_USER !== 'planes_backend' || !env.DB_PASSWORD) throw new Error('Destino privado de pruebas no válido.');
    if (env.ENABLE_ROLE_PERMISSION_ROUTES !== 'true') throw new Error('Composición funcional de pruebas no habilitada.');
    if (env.EVIDENCE_STORAGE_DIR !== '/data/evidence' || env.RAILWAY_VOLUME_MOUNT_PATH !== '/data/evidence') throw new Error('Falta el volumen persistente privado de evidencias.');
    return Object.freeze({database: env.DB_NAME});
  }

  if (env.DEPLOYMENT_PROFILE !== PRODUCTION_DEPLOYMENT_PROFILE) {
    throw new Error('Perfil Railway desconocido.');
  }
  const target = validateProductionApplicationDatabase(env);
  if (env.ENABLE_ROLE_PERMISSION_ROUTES === 'true' ||
      env.EVIDENCE_STORAGE_DIR !== '/data/evidence' ||
      env.RAILWAY_VOLUME_MOUNT_PATH !== '/data/evidence') {
    throw new Error('Configuración del perfil Railway production no válida.');
  }
  return Object.freeze({database: target.database});
}
export async function verifyEvidenceVolume() {
  const mounts = await readFile('/proc/self/mountinfo', 'utf8');
  if (!mounts.split('\n').some(line => line.split(' ')[4] === '/data/evidence')) throw new Error('Evidencias requiere un volumen montado, no almacenamiento efímero.');
  await access('/data/evidence', constants.R_OK | constants.W_OK);
}
