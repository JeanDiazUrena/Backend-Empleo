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
  ssl: {
    rejectUnauthorized: false,
  },
});

export const initDB = async () => {
  try {
    // Intentar crear la extensión pgcrypto, pero no detenerse si falla (puede que ya esté o no haya permisos)
    await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"').catch(e => {
      console.log("ℹ️ Nota: No se pudo crear/verificar la extensión pgcrypto (probablemente ya existe o falta de permisos).");
    });

    await pool.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nombre VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password TEXT NOT NULL,
        rol VARCHAR(50) NOT NULL CHECK (rol IN ('cliente', 'profesional')),
        activo BOOLEAN DEFAULT true,
        google_id VARCHAR(255),
        avatar_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sesiones (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        dispositivo TEXT,
        ip_address VARCHAR(50),
        last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("✅ Tablas 'usuarios' y 'sesiones' verificadas/creadas correctamente.");
  } catch (err) {
    console.error("❌ Error al inicializar la base de datos auth_db:", err.message);
  }
};

export const testDB = async () => {
  try {
    await pool.query('SELECT NOW()');
    console.log('✅ Conexión a la base de datos exitosa (Auth)');
    await initDB();
  } catch (err) {
    console.error('❌ Error conectando a la base de datos (Auth):', err.message);
  }
};
