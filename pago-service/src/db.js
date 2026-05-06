import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pkg;

export const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: String(process.env.DB_PASSWORD),

  ssl: {
    rejectUnauthorized: false
  }
});

export const initDB = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pagos (
        id SERIAL PRIMARY KEY,
        trabajo_id UUID UNIQUE NOT NULL,
        monto DECIMAL(12,2) NOT NULL,
        estado VARCHAR(50) DEFAULT 'PENDIENTE',
        metodo_pago VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("✅ Tabla 'pagos' verificada/creada.");
  } catch (err) {
    console.error("❌ Error inicializando tabla pagos:", err.message);
  }
};

export const testDB = async () => {
  try {
    await pool.query("SELECT NOW()");
    console.log("✅ DB conectada (Pago)");
    await initDB();
  } catch (err) {
    console.error("❌ Error DB (Pago):", err.message);
  }
};