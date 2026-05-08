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
    console.log("🚀 Iniciando migraciones de pago-service...");
    
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
    `);

    await pool.query("ALTER TABLE metodos_pago ADD COLUMN IF NOT EXISTS holder_name VARCHAR(255)");
    await pool.query("ALTER TABLE metodos_pago ADD COLUMN IF NOT EXISTS proveedor VARCHAR(50)");
    
    // Eliminación de columnas sensibles si existían
    await pool.query("ALTER TABLE metodos_pago DROP COLUMN IF EXISTS card_number").catch(() => {});
    await pool.query("ALTER TABLE metodos_pago DROP COLUMN IF EXISTS cvv").catch(() => {});

    console.log("✅ Migraciones completadas.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error en migraciones:", err.message);
    process.exit(1);
  }
};

migrate();
