import mysql from 'mysql2/promise';
import fs from 'fs/promises';
import dotenv from 'dotenv';

dotenv.config();

const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT || 3306),
    multipleStatements: true
});

try {
    console.log('======================================');
    console.log('Iniciando migración...');
    console.log('======================================');

    const sql = await fs.readFile(
        './migrations/001_initial.sql',
        'utf8'
    );

    await connection.query(sql);

    console.log('Migración ejecutada correctamente.');
    console.log('Tablas creadas:');
    console.log('- areas');
    console.log('- usuarios');
    console.log('- periodos');
    console.log('- planeacion');
    console.log('- calificacion');

} catch (error) {

    console.error('Error ejecutando la migración:');
    console.error(error);

    process.exitCode = 1;

} finally {

    await connection.end();

    console.log('Conexión cerrada.');
}
