import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

export const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
});

export const initDB = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS notificaciones (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(255) NOT NULL,
                title VARCHAR(255) NOT NULL,
                message TEXT NOT NULL,
                type VARCHAR(50) DEFAULT 'info',
                is_read BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log("Tabla de notificaciones verificada/creada exitosamente.");
    } catch (err) {
        console.error("Error al crear tabla:", err.message);
    }
};

export const testDB = async () => {
    try {
        const res = await pool.query("SELECT NOW()");
        console.log("DB notificaciones conectada:", res.rows[0]);
        await initDB();
    } catch (err) {
        console.error("Error conectando a DB notificaciones:", err.message);
    }
};
