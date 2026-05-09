import pkg from "pg";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { Pool } = pkg;

const poolConfig = process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
    }
    : {
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: String(process.env.DB_PASSWORD),
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    };

const pool = new Pool(poolConfig);

const migrate = async () => {
    try {
        console.log("🚀 Iniciando migraciones de notificacion-service...");
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS notificaciones (
                id SERIAL PRIMARY KEY,
                user_id UUID NOT NULL,
                title VARCHAR(255) NOT NULL,
                message TEXT NOT NULL,
                type VARCHAR(50) DEFAULT 'info',
                metadata JSONB DEFAULT '{}',
                is_read BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log("✅ Migraciones completadas.");
        process.exit(0);
    } catch (err) {
        console.error("❌ Error en migraciones:", err.message);
        process.exit(1);
    }
};

migrate();
