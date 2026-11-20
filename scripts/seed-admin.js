import 'dotenv/config';
import bcrypt from 'bcryptjs';
import db from '../app/config/db.js';

const correo = (process.env.ADMIN_EMAIL || 'admin@institutohuila.local').trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || 'Admin123*';

try {
  const [roles] = await db.execute('SELECT id FROM roles WHERE id = 1 LIMIT 1');
  if (!roles.length) {
    await db.execute("INSERT INTO roles (id, nombre) VALUES (1, 'Administrador')");
  }

  const [existing] = await db.execute('SELECT id FROM usuarios WHERE correo = ? LIMIT 1', [correo]);
  if (existing.length) {
    console.log(`El usuario administrador ${correo} ya existe; no se modificó.`);
  } else {
    const hash = await bcrypt.hash(password, 10);
    await db.execute(
      "INSERT INTO usuarios (nombre, correo, password, estado, area_id, rol_id) VALUES (?, ?, ?, 'Activo', NULL, 1)",
      ['Administrador', correo, hash]
    );
    console.log('Usuario administrador local creado.');
    console.log(`Correo: ${correo}`);
    console.log(`Contraseña inicial: ${password}`);
    console.log('Cambia la contraseña después de ingresar.');
  }
} catch (error) {
  console.error('No se pudo crear el administrador:', error.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
