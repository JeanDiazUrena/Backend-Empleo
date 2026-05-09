import pkg from "pg";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { Pool } = pkg;

const poolConfig = {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: String(process.env.DB_PASSWORD),
    ssl: { rejectUnauthorized: false },
};

const pool = new Pool(poolConfig);

const migrate = async () => {
    try {
        console.log("🚀 Agregando columna metadata a la tabla de notificaciones...");
        
        await pool.query(`
            ALTER TABLE notificaciones ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
        `);

        console.log("✅ Columna agregada.");
        process.exit(0);
    } catch (err) {
        console.error("❌ Error en migración:", err.message);
        process.exit(1);
    }
};

migrate();
