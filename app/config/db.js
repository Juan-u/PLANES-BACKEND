import mysql from 'mysql2/promise';

const db = await mysql.createConnection({
    host    : process.env.DB_HOST     || 'localhost',
    user    : process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME     || 'sistema_planes_accion',
    port    : process.env.DB_PORT     || 3306
});

console.log('Conectado a MySQL - sistema_planes_accion');

export default db;
