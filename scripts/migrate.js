import mysql from 'mysql2/promise';
import fs from 'fs/promises';
import dotenv from 'dotenv';

dotenv.config();

console.log('======================================');
console.log('Configuración de conexión');
console.log('======================================');
console.log(`MYSQLHOST: ${process.env.MYSQLHOST || '(vacío)'}`);
console.log(`MYSQLPORT: ${process.env.MYSQLPORT || '(vacío)'}`);
console.log(`MYSQLUSER: ${process.env.MYSQLUSER || '(vacío)'}`);
console.log(`MYSQLDATABASE: ${process.env.MYSQLDATABASE || '(vacío)'}`);
console.log('======================================');

if (!process.env.MYSQLHOST) {
    throw new Error('MYSQLHOST no está configurado');
}

if (!process.env.MYSQLUSER) {
    throw new Error('MYSQLUSER no está configurado');
}

// MYSQLPASSWORD puede estar vacío en una instalación local de XAMPP.
if (!process.env.MYSQLDATABASE) {
    throw new Error('MYSQLDATABASE no está configurado');
}

const connection = await mysql.createConnection({
    host: process.env.MYSQLHOST,
    port: Number(process.env.MYSQLPORT || 3306),
    user: process.env.MYSQLUSER,
    password: process.env.MYSQLPASSWORD,
    database: process.env.MYSQLDATABASE,
    multipleStatements: true
});

try {
    console.log('Iniciando migración...');

    for (const migration of ['001_initial.sql', '002_seguimiento.sql']) {
        const sql = await fs.readFile(new URL(`../migrations/${migration}`, import.meta.url), 'utf8');
        await connection.query(sql);
        console.log(`Migración aplicada/verificada: ${migration}`);
    }

    console.log('');
    console.log('======================================');
    console.log('MIGRACIÓN EJECUTADA CORRECTAMENTE');
    console.log('======================================');
    console.log('');
    console.log('Tablas creadas/verificadas:');
    console.log('- areas');
    console.log('- roles');
    console.log('- plan_accion');
    console.log('- actividad');
    console.log('- usuarios');
    console.log('- periodos');
    console.log('- planeacion');
    console.log('- calificacion');
    console.log('- evidencias, revisiones_calificacion, logs_auditoria y notificaciones');
    console.log('');

} catch (error) {

    console.error('');
    console.error('======================================');
    console.error('ERROR EJECUTANDO LA MIGRACIÓN');
    console.error('======================================');
    console.error(error);
    console.error('');

    process.exitCode = 1;

} finally {

    await connection.end();

    console.log('Conexión cerrada.');
}