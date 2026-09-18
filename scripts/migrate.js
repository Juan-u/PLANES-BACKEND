import mysql from 'mysql2/promise';
import fs from 'fs/promises';
import dotenv from 'dotenv';

dotenv.config();

const connection = await mysql.createConnection({
    host: process.env.MYSQLHOST,
    user: process.env.MYSQLUSER,
    password: process.env.MYSQLPASSWORD,
    database: process.env.MYSQLDATABASE,
    port: Number(process.env.MYSQLPORT || 3306),
    multipleStatements: true
});

try {
    console.log('======================================');
    console.log('Iniciando migración...');
    console.log('======================================');

    console.log(`Host: ${process.env.MYSQLHOST}`);
    console.log(`Database: ${process.env.MYSQLDATABASE}`);
    console.log(`User: ${process.env.MYSQLUSER}`);

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