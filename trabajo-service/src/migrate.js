import pkg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
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
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      password: String(process.env.DB_PASSWORD),
      port: Number(process.env.DB_PORT),
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    };

const pool = new Pool(poolConfig);

const migrate = async () => {
  try {
    console.log("🚀 Iniciando migraciones de trabajo-service...");

    // 1. Trabajos
    await pool.query(`
      CREATE TABLE IF NOT EXISTS trabajos (
        id SERIAL PRIMARY KEY,
        cliente_id UUID NOT NULL,
        profesional_id UUID NOT NULL,
        solicitud_id INTEGER,
        estado VARCHAR(50) DEFAULT 'EN_PROGRESO',
        titulo VARCHAR(255),
        descripcion TEXT,
        horario VARCHAR(255),
        presupuesto VARCHAR(255),
        cliente_nombre VARCHAR(255),
        categoria VARCHAR(255),
        monto_acordado DECIMAL(12,2),
        monto_comision DECIMAL(12,2),
        metodo_pago VARCHAR(50),
        estado_pago VARCHAR(50) DEFAULT 'PENDIENTE',
        cotizacion_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Cotizaciones
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cotizaciones (
        id SERIAL PRIMARY KEY,
        conversacion_id INTEGER,
        solicitud_id INTEGER,
        trabajo_id INTEGER,
        cliente_id UUID NOT NULL,
        profesional_id UUID NOT NULL,
        titulo VARCHAR(255),
        descripcion TEXT,
        monto_total DECIMAL(12,2),
        porcentaje_comision DECIMAL(5,2),
        metodo_pago VARCHAR(50),
        estado VARCHAR(50) DEFAULT 'PENDIENTE',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS trabajo_id INTEGER`).catch(() => {});

    // 3. Acciones Trabajo
    await pool.query(`
      CREATE TABLE IF NOT EXISTS acciones_trabajo (
        id SERIAL PRIMARY KEY,
        trabajo_id INTEGER NOT NULL,
        accion VARCHAR(100),
        descripcion TEXT,
        realizado_por UUID,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 4. Billetera Profesional
    await pool.query(`
      CREATE TABLE IF NOT EXISTS billetera_profesional (
        profesional_id UUID PRIMARY KEY,
        balance DECIMAL(12,2) DEFAULT 0,
        total_comisiones_debitadas DECIMAL(12,2) DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 5. Movimientos Billetera
    await pool.query(`
      CREATE TABLE IF NOT EXISTS movimientos_billetera (
        id SERIAL PRIMARY KEY,
        profesional_id UUID NOT NULL,
        trabajo_id INTEGER,
        tipo VARCHAR(50),
        monto DECIMAL(12,2),
        descripcion TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 6. Confirmaciones
    await pool.query(`
      CREATE TABLE IF NOT EXISTS confirmaciones (
        id SERIAL PRIMARY KEY,
        trabajo_id INTEGER NOT NULL,
        cliente_id UUID NOT NULL,
        confirmado BOOLEAN DEFAULT false,
        comentario TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 7. Reseñas
    await pool.query(`
      CREATE TABLE IF NOT EXISTS resenas (
        id SERIAL PRIMARY KEY,
        trabajo_id INTEGER NOT NULL,
        cliente_id UUID NOT NULL,
        profesional_id UUID NOT NULL,
        calificacion INTEGER CHECK (calificacion >= 1 AND calificacion <= 5),
        comentario TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 8. Tarjetas de crédito para clientes
    await pool.query(`
        CREATE TABLE IF NOT EXISTS tarjetas_clientes (
            id SERIAL PRIMARY KEY,
            cliente_id UUID NOT NULL,
            brand VARCHAR(50),
            last4 VARCHAR(4),
            token TEXT,
            expiry VARCHAR(7)
        );
    `);

    console.log("✅ Migraciones completadas.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error en migraciones:", err.message);
    process.exit(1);
  }
};

migrate();
