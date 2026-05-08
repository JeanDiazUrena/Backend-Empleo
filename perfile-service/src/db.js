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
    await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"').catch(() => {});

    // Profesionales
    await pool.query(`
      CREATE TABLE IF NOT EXISTS profesionales (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        usuario_id UUID UNIQUE NOT NULL,
        nombre VARCHAR(255),
        profesion VARCHAR(255),
        biografia TEXT,
        anios_experiencia INTEGER DEFAULT 0,
        telefono VARCHAR(50),
        email_publico VARCHAR(255),
        sitio_web VARCHAR(255),
        ciudad VARCHAR(255),
        sector VARCHAR(255),
        horario_texto TEXT,
        avatar_url TEXT,
        cover_url TEXT,
        activo BOOLEAN DEFAULT true,
        stripe_card_token TEXT,
        cuenta_bancaria VARCHAR(255),
        banco VARCHAR(255),
        estado_financiero VARCHAR(50) DEFAULT 'activo',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Clientes
    await pool.query(`
      CREATE TABLE IF NOT EXISTS clientes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        usuario_id UUID UNIQUE NOT NULL,
        nombre VARCHAR(255),
        email VARCHAR(255),
        telefono VARCHAR(50),
        direccion TEXT,
        avatar TEXT,
        banner TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Categorías y Habilidades
    await pool.query(`
      CREATE TABLE IF NOT EXISTS categorias (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(255) UNIQUE NOT NULL
      );
      CREATE TABLE IF NOT EXISTS habilidades (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(255) UNIQUE NOT NULL
      );
    `).catch(() => {});

    // Relaciones
    await pool.query(`
      CREATE TABLE IF NOT EXISTS profesional_categorias (
        profesional_id UUID REFERENCES profesionales(id) ON DELETE CASCADE,
        categoria_id INTEGER REFERENCES categorias(id) ON DELETE CASCADE,
        PRIMARY KEY (profesional_id, categoria_id)
      );
      CREATE TABLE IF NOT EXISTS profesional_habilidades (
        profesional_id UUID REFERENCES profesionales(id) ON DELETE CASCADE,
        habilidad_id INTEGER REFERENCES habilidades(id) ON DELETE CASCADE,
        PRIMARY KEY (profesional_id, habilidad_id)
      );
    `).catch(() => {});

    // Portafolio
    await pool.query(`
      CREATE TABLE IF NOT EXISTS trabajos_portafolio (
        id SERIAL PRIMARY KEY,
        profesional_id UUID REFERENCES profesionales(id) ON DELETE CASCADE,
        titulo VARCHAR(255),
        descripcion TEXT,
        imagen_url TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Chat
    await pool.query(`
      CREATE TABLE IF NOT EXISTS conversaciones (
        id SERIAL PRIMARY KEY,
        cliente_id UUID NOT NULL,
        profesional_usuario_id UUID NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(cliente_id, profesional_usuario_id)
      );
      CREATE TABLE IF NOT EXISTS mensajes (
        id SERIAL PRIMARY KEY,
        conversacion_id INTEGER REFERENCES conversaciones(id) ON DELETE CASCADE,
        remitente_id UUID NOT NULL,
        contenido TEXT NOT NULL,
        tipo VARCHAR(20) DEFAULT 'texto',
        leido BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `).catch(() => {});
    
    await pool.query(`ALTER TABLE mensajes ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) DEFAULT 'texto'`).catch(() => {});

    // Solicitudes
    await pool.query(`
      CREATE TABLE IF NOT EXISTS solicitudes (
        id SERIAL PRIMARY KEY,
        cliente_id UUID NOT NULL,
        profesional_id UUID,
        titulo VARCHAR(255) NOT NULL,
        categoria VARCHAR(255) NOT NULL,
        descripcion TEXT NOT NULL,
        urgencia VARCHAR(50),
        ubicacion VARCHAR(255),
        disponibilidad VARCHAR(100),
        presupuesto_min DECIMAL(12,2),
        presupuesto_max DECIMAL(12,2),
        monto_acordado NUMERIC(12,2),
        imagen_url TEXT,
        estado VARCHAR(50) DEFAULT 'pendiente',
        metodo_pago VARCHAR(50) DEFAULT 'EFECTIVO',
        estado_pago VARCHAR(50) DEFAULT 'PENDIENTE',
        fecha_creacion TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT fk_profesional FOREIGN KEY (profesional_id) REFERENCES profesionales(id) ON DELETE SET NULL
      )
    `).catch(() => {});
    
    await pool.query(`ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS monto_acordado NUMERIC(12,2)`).catch(() => {});
    await pool.query(`ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS metodo_pago VARCHAR(50) DEFAULT 'EFECTIVO'`).catch(() => {});
    await pool.query(`ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS estado_pago VARCHAR(50) DEFAULT 'PENDIENTE'`).catch(() => {});

    await pool.query(`
      CREATE TABLE IF NOT EXISTS solicitud_rechazos (
        id SERIAL PRIMARY KEY,
        solicitud_id INTEGER NOT NULL REFERENCES solicitudes(id) ON DELETE CASCADE,
        profesional_id UUID NOT NULL REFERENCES profesionales(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (solicitud_id, profesional_id)
      )
    `).catch(() => {});

    // MIGRACIONES DE ZONA HORARIA
    const tablesToMigrate = [
      ['profesionales', ['created_at', 'updated_at']],
      ['clientes', ['created_at', 'updated_at']],
      ['trabajos_portafolio', ['created_at']],
      ['conversaciones', ['created_at']],
      ['mensajes', ['created_at']],
      ['solicitudes', ['fecha_creacion']],
      ['solicitud_rechazos', ['created_at']]
    ];

    for (const [table, columns] of tablesToMigrate) {
      for (const col of columns) {
        await pool.query(`ALTER TABLE ${table} ALTER COLUMN ${col} TYPE TIMESTAMPTZ`).catch(() => {});
      }
    }

    console.log("✅ Tablas de 'perfile-service' verificadas/creadas.");
  } catch (err) {
    console.error("❌ Error inicializando tablas de perfiles:", err.message);
  }
};

export const testDB = async () => {
  try {
    const res = await pool.query("SELECT NOW()");
    console.log("✅ DB conectada (perfiles):", res.rows[0]);
    await initDB();
  } catch (err) {
    console.error("❌ Error DB perfiles:", err.message);
  }
};
