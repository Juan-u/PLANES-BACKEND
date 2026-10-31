import 'dotenv/config';
import mysql from 'mysql2/promise';

const requiredDatabaseVariables = ['DB_HOST', 'DB_USER', 'DB_NAME'];
const missingVariables = requiredDatabaseVariables.filter(
  (name) => !Object.hasOwn(process.env, name)
);

const hasDatabasePassword = Object.hasOwn(process.env, 'DB_PASSWORD');
const isLocalDevelopment =
  process.env.NODE_ENV === 'development' &&
  ['localhost', '127.0.0.1', '::1'].includes(process.env.DB_HOST) &&
  process.env.DB_ALLOW_EMPTY_PASSWORD === 'true';

if (!hasDatabasePassword && !isLocalDevelopment) {
  missingVariables.push('DB_PASSWORD');
}

if (missingVariables.length > 0) {
  throw new Error(
    `Falta configuración de base de datos: ${missingVariables.join(', ')}`
  );
}

const databasePassword = hasDatabasePassword ? process.env.DB_PASSWORD : '';

if (databasePassword === '' && !isLocalDevelopment) {
  throw new Error('Falta configuración de base de datos.');
}

const port = Number(process.env.DB_PORT ?? 3306);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('DB_PORT debe ser un puerto válido.');
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port,
  user: process.env.DB_USER,
  password: databasePassword,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

export default pool;
