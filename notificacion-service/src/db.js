import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

export const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: String(process.env.DB_PASSWORD),

    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

export const testDB = async () => {
    try {
        await pool.query("SELECT NOW()");
        console.log("✅ Conexión a la base de datos exitosa (Notificaciones)");
    } catch (err) {
        console.error("❌ Error conectando a la base de datos (Notificaciones):", err.message);
    }
};