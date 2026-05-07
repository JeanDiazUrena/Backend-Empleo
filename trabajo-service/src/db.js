import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';

dotenv.config();

export const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: String(process.env.DB_PASSWORD),
  port: Number(process.env.DB_PORT),

  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

export const testDB = async () => {
  try {
    const res = await pool.query('SELECT NOW()');
    console.log('✅ DB Trabajos conectada:', res.rows[0]);
  } catch (err) {
    console.error('❌ Error DB Trabajos:', err.message);
  }
};


export default pool;