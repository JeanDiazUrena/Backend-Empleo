import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

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

export const pool = new Pool(poolConfig);

const initDB = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS notificaciones (
                id SERIAL PRIMARY KEY,
                user_id UUID NOT NULL,
                title VARCHAR(255) NOT NULL,
                message TEXT NOT NULL,
                type VARCHAR(50) DEFAULT 'info',
                is_read BOOLEAN DEFAULT false,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            )
        `);
        // Migración de zona horaria
        await pool.query(`ALTER TABLE notificaciones ALTER COLUMN created_at TYPE TIMESTAMPTZ`).catch(() => {});
        console.log("✅ Tablas de 'notificacion-service' verificadas/creadas.");
    } catch (err) {
        console.error("❌ Error inicializando tablas de notificaciones:", err.message);
    }
};

export const testDB = async () => {
    try {
        await pool.query("SELECT NOW()");
        console.log("✅ Conexión a la base de datos exitosa (Notificaciones)");
        await initDB();
    } catch (err) {
        console.error("❌ Error conectando a la base de datos (Notificaciones):", err.message);
    }
};
