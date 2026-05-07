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
    rejectUnauthorized: false,
  },
});

const initDB = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pagos (
        id SERIAL PRIMARY KEY,
        trabajo_id INTEGER UNIQUE NOT NULL,
        monto DECIMAL(12,2) NOT NULL,
        estado VARCHAR(50) DEFAULT 'PENDIENTE',
        metodo_pago VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS metodos_pago (
        id SERIAL PRIMARY KEY,
        usuario_id UUID NOT NULL,
        brand VARCHAR(50),
        last4 VARCHAR(4),
        exp VARCHAR(10),
        token VARCHAR(255),
        proveedor VARCHAR(50),
        is_default BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `).catch(() => {});

    await pool.query("ALTER TABLE metodos_pago ADD COLUMN IF NOT EXISTS holder_name VARCHAR(255)").catch(() => {});
    await pool.query("ALTER TABLE metodos_pago ADD COLUMN IF NOT EXISTS proveedor VARCHAR(50)").catch(() => {});
    
    console.log("✅ Tablas de 'pago-service' verificadas/creadas.");
  } catch (err) {
    console.error("❌ Error inicializando tablas de pago:", err.message);
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