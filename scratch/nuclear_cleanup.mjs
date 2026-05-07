import pkg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', 'auth-service', '.env') });

const { Pool } = pkg;
const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  ssl: { rejectUnauthorized: false }
});

const SCHEMAS_TO_DROP = [
  'analytics', 'auth', 'chat', 'documentos', 'geolocalizacion', 
  'logs', 'pagos', 'resenas', 'solicitudes', 'trabajo', 'perfiles'
];

async function cleanup() {
  try {
    console.log("🧹 Iniciando limpieza nuclear de la base de datos...");
    
    // 1. Eliminar esquemas extra
    for (const schema of SCHEMAS_TO_DROP) {
      console.log(`🗑️ Eliminando esquema: ${schema}...`);
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    }

    // 2. Eliminar todas las tablas del esquema public para empezar de cero
    console.log("🗑️ Limpiando esquema public...");
    const tables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);

    for (const row of tables.rows) {
      await pool.query(`DROP TABLE IF EXISTS "${row.table_name}" CASCADE`);
    }

    console.log("✨ Base de datos limpia.");
    
  } catch (err) {
    console.error("❌ Error durante la limpieza:", err);
  } finally {
    await pool.end();
  }
}

cleanup();
