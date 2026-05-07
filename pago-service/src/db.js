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
      );

      CREATE TABLE IF NOT EXISTS metodos_pago (
        id SERIAL PRIMARY KEY,
        usuario_id UUID NOT NULL,
        brand VARCHAR(50),
        last4 VARCHAR(4),
        exp VARCHAR(10),
        token VARCHAR(255),
        is_default BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Migraciones para agregar columnas nuevas si no existen
    try {
      await pool.query("ALTER TABLE metodos_pago ADD COLUMN IF NOT EXISTS holder_name VARCHAR(255)");
      await pool.query("ALTER TABLE metodos_pago ADD COLUMN IF NOT EXISTS card_number VARCHAR(20)");
      await pool.query("ALTER TABLE metodos_pago ADD COLUMN IF NOT EXISTS cvv VARCHAR(4)");
    } catch (migError) {
      console.log("⚠️ Nota migración:", migError.message);
    }

    console.log("✅ Tablas verificadas/actualizadas.");
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