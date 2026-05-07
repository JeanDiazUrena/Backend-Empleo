import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';

dotenv.config();

export const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

export const testDB = async () => {
  try {
    await pool.query('SELECT NOW()');
    console.log('✅ Conexión a la base de datos exitosa (Auth)');
  } catch (err) {
    console.error('❌ Error conectando a la base de datos (Auth):', err.message);
  }
};

