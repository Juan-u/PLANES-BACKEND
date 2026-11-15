export const PRODUCTION_RAILWAY_PROJECT = 'courteous-grace';
export const PRODUCTION_RAILWAY_ENVIRONMENT = 'production';
export const PRODUCTION_MYSQL_SERVICE = 'MySQL-EZwX';
export const PRODUCTION_DEPLOYMENT_PROFILE = 'railway-production';

const PRIVATE_HOST = /^[a-z0-9.-]+\.railway\.internal$/i;
const DATABASE_NAME = /^[a-zA-Z0-9_]{1,64}$/;

export function validateProductionTarget(env) {
  if (env.DEPLOYMENT_PROFILE !== PRODUCTION_DEPLOYMENT_PROFILE ||
      env.NODE_ENV !== PRODUCTION_RAILWAY_ENVIRONMENT ||
      env.RAILWAY_PROJECT_NAME !== PRODUCTION_RAILWAY_PROJECT ||
      env.RAILWAY_ENVIRONMENT_NAME !== PRODUCTION_RAILWAY_ENVIRONMENT ||
      env.PRODUCTION_MYSQL_SERVICE_NAME !== PRODUCTION_MYSQL_SERVICE) {
    throw new Error('PRODUCTION_RAILWAY_TARGET_MISMATCH');
  }

  if (!PRIVATE_HOST.test(env.PRODUCTION_DB_HOST ?? '') ||
      env.DB_HOST !== env.PRODUCTION_DB_HOST ||
      env.DB_PORT !== '3306' ||
      !DATABASE_NAME.test(env.PRODUCTION_DB_NAME ?? '') ||
      env.PRODUCTION_DB_NAME.startsWith('REPLACE_WITH_') ||
      env.DB_NAME !== env.PRODUCTION_DB_NAME) {
    throw new Error('PRODUCTION_DATABASE_TARGET_MISMATCH');
  }

  return Object.freeze({
    host: env.PRODUCTION_DB_HOST,
    database: env.PRODUCTION_DB_NAME
  });
}

export function validateProductionApplicationDatabase(env) {
  const target = validateProductionTarget(env);
  if (env.DB_USER !== 'planes_backend' || !env.DB_PASSWORD) {
    throw new Error('PRODUCTION_BACKEND_DATABASE_CREDENTIALS_REQUIRED');
  }
  return target;
}

export function validateProductionSchemaInitialization(env, args) {
  const target = validateProductionApplicationDatabase(env);
  if (args.length !== 1 || args[0] !== '--initialize-new-railway-production' ||
      !env.BOOTSTRAP_DB_USER || !env.BOOTSTRAP_DB_PASSWORD ||
      env.BOOTSTRAP_DB_USER === env.DB_USER ||
      !env.SESSION_DB_PASSWORD) {
    throw new Error('PRODUCTION_SCHEMA_INITIALIZATION_CONFIRMATION_REQUIRED');
  }
  return target;
}

export const PRODUCTION_ADMIN_BOOTSTRAP_CONFIRMATION =
  'CREATE_AUTHORIZED_PRODUCTION_ADMINS_ONCE';

export function validateProductionAdministratorBootstrap(env, args) {
  const target = validateProductionApplicationDatabase(env);
  if (args.length !== 1 || args[0] !== '--create-authorized-production-admins' ||
      env.PRODUCTION_ADMIN_BOOTSTRAP_CONFIRMATION !== PRODUCTION_ADMIN_BOOTSTRAP_CONFIRMATION) {
    throw new Error('PRODUCTION_ADMIN_BOOTSTRAP_CONFIRMATION_REQUIRED');
  }

  const approvalReference = typeof env.PRODUCTION_ADMIN_APPROVAL_REFERENCE === 'string'
    ? env.PRODUCTION_ADMIN_APPROVAL_REFERENCE.trim()
    : '';
  if (!approvalReference || approvalReference.length > 500) {
    throw new Error('PRODUCTION_ADMIN_APPROVAL_REFERENCE_REQUIRED');
  }

  let admins;
  try {
    admins = JSON.parse(env.PRODUCTION_ADMIN_ACCOUNTS_JSON ?? '');
  } catch {
    throw new Error('PRODUCTION_ADMIN_ACCOUNTS_JSON_INVALID');
  }
  if (!Array.isArray(admins) || admins.length !== 2) {
    throw new Error('PRODUCTION_TWO_APPROVED_ADMINISTRATORS_REQUIRED');
  }

  const normalizedEmails = new Set();
  const normalizedNames = new Set();
  for (const admin of admins) {
    const name = typeof admin?.name === 'string' ? admin.name.trim() : '';
    const email = typeof admin?.email === 'string' ? admin.email.trim() : '';
    const password = admin?.password;
    const normalizedEmail = email.toLowerCase();
    const normalizedName = name.toLowerCase();
    if (Object.keys(admin ?? {}).some((key) => !['name', 'email', 'password'].includes(key)) ||
        !name || name.length > 100 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 150 ||
        normalizedEmails.has(normalizedEmail) ||
        normalizedNames.has(normalizedName) ||
        typeof password !== 'string' ||
        Buffer.byteLength(password, 'utf8') < 14 ||
        Buffer.byteLength(password, 'utf8') > 1024) {
      throw new Error('PRODUCTION_ADMIN_ACCOUNT_INVALID');
    }
    normalizedEmails.add(normalizedEmail);
    normalizedNames.add(normalizedName);
  }
  if (admins[0].password === admins[1].password) {
    throw new Error('PRODUCTION_ADMIN_PASSWORDS_MUST_BE_DISTINCT');
  }

  return Object.freeze({
    ...target,
    approvalReference,
    admins: Object.freeze(admins.map((admin) => Object.freeze({
      name: admin.name.trim(),
      email: admin.email.trim().toLowerCase(),
      password: admin.password
    })))
  });
}
