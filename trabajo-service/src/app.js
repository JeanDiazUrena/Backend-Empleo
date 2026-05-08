import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();
const { Pool } = pg;

const poolConfig = process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
    }
    : {
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: process.env.DB_NAME,
        password: process.env.DB_PASSWORD,
        port: process.env.DB_PORT,
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    };

const pool = new Pool(poolConfig);

export const initDB = async () => {
    try {
        await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
        // 1. Trabajos
        await pool.query(`
      CREATE TABLE IF NOT EXISTS trabajos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        cliente_id UUID NOT NULL,
        profesional_id UUID,
        solicitud_id INTEGER,
        cotizacion_id INTEGER,
        titulo VARCHAR(255) NOT NULL,
        descripcion TEXT,
        horario TEXT,
        presupuesto TEXT,
        cliente_nombre TEXT,
        categoria TEXT,
        monto DECIMAL(12,2),
        monto_acordado NUMERIC(12, 2),
        monto_comision NUMERIC(12, 2) DEFAULT 0,
        metodo_pago VARCHAR(50) DEFAULT 'EFECTIVO',
        estado VARCHAR(50) DEFAULT 'pendiente',
        estado_pago VARCHAR(50) DEFAULT 'PENDIENTE',
        fecha_inicio TIMESTAMP,
        fecha_fin TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

        // 2. Cotizaciones
        await pool.query(`
      CREATE TABLE IF NOT EXISTS cotizaciones (
        id SERIAL PRIMARY KEY,
        trabajo_id UUID,
        solicitud_id INTEGER,
        conversacion_id INTEGER,
        cliente_id UUID NOT NULL,
        profesional_id UUID NOT NULL,
        titulo TEXT,
        descripcion TEXT,
        monto_total NUMERIC(12, 2) NOT NULL CHECK (monto_total >= 0),
        porcentaje_comision NUMERIC(5, 2) DEFAULT 10.00 CHECK (porcentaje_comision >= 0 AND porcentaje_comision <= 100),
        monto_comision NUMERIC(12, 2) GENERATED ALWAYS AS (monto_total * (porcentaje_comision / 100.0)) STORED,
        metodo_pago VARCHAR(50) DEFAULT 'EFECTIVO',
        estado VARCHAR(50) DEFAULT 'PENDIENTE',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

        // 3. Billetera Profesional
        await pool.query(`
      CREATE TABLE IF NOT EXISTS billetera_profesional (
        profesional_id UUID PRIMARY KEY,
        balance DECIMAL(12,2) DEFAULT 0.00,
        last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

        // 4. Movimientos Billetera
        await pool.query(`
      CREATE TABLE IF NOT EXISTS movimientos_billetera (
        id SERIAL PRIMARY KEY,
        profesional_id UUID REFERENCES billetera_profesional(profesional_id) ON DELETE CASCADE,
        trabajo_id UUID REFERENCES trabajos(id) ON DELETE SET NULL,
        tipo VARCHAR(50) NOT NULL, -- 'ingreso', 'egreso', 'comision'
        monto DECIMAL(12,2) NOT NULL,
        descripcion TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

        // 5. Acciones de Trabajo (Log)
        await pool.query(`
      CREATE TABLE IF NOT EXISTS acciones_trabajo (
        id SERIAL PRIMARY KEY,
        trabajo_id UUID REFERENCES trabajos(id) ON DELETE CASCADE,
        accion VARCHAR(100) NOT NULL,
        descripcion TEXT,
        realizado_por UUID,
        fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

        // 6. Confirmaciones
        await pool.query(`
      CREATE TABLE IF NOT EXISTS confirmaciones (
        id SERIAL PRIMARY KEY,
        trabajo_id UUID REFERENCES trabajos(id) ON DELETE CASCADE,
        cliente_id UUID NOT NULL,
        confirmado BOOLEAN DEFAULT FALSE,
        comentario TEXT,
        fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

        // 7. Reseñas
        await pool.query(`
      CREATE TABLE IF NOT EXISTS resenas (
        id SERIAL PRIMARY KEY,
        trabajo_id UUID REFERENCES trabajos(id) ON DELETE CASCADE,
        cliente_id UUID NOT NULL,
        profesional_id UUID NOT NULL,
        calificacion INTEGER CHECK (calificacion >= 1 AND calificacion <= 5),
        comentario TEXT,
        fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

        console.log("Tablas de trabajo_db verificadas/creadas correctamente.");
    } catch (err) {
        console.error("Error inicializando trabajo_db:", err.message);
    }
};

pool.on('connect', async () => {
    console.log('Conexión exitosa a la base de datos: trabajo_db');
    await initDB();
});

pool.on('error', (err) => {
    console.error('Error inesperado en la base de datos:', err);
});

export default pool;
