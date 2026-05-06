import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pkg;

export const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT),
});

export const initDB = async () => {
    try {
        await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
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
        console.log("Tabla 'usuarios' verificada/creada correctamente.");
    } catch (err) {
        console.error("Error al inicializar la base de datos auth_db:", err.message);
    }
};

pool.query("SELECT NOW()", async (err, res) => {
    if (err) {
        console.error("Error conectando a PostgreSQL:", err);
    } else {
        console.log("PostgreSQL conectado correctamente:", res.rows[0]);
        await initDB();
    }
});
