import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();
const { Pool } = pg;

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

pool.on('connect', () => {
    console.log(' Conexión exitosa a la base de datos: trabajos_db');
});

pool.on('error', (err) => {
    console.error(' Error inesperado en la base de datos:', err);
    process.exit(-1);
});

export default pool;