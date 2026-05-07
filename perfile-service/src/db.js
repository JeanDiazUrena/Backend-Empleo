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

export const initDB = async () => {
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    
    // Crear esquema perfiles si no existe
    await pool.query('CREATE SCHEMA IF NOT EXISTS perfiles');

    // 1. Profesionales (dentro del esquema perfiles)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS perfiles.profesionales (
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Clientes
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3. Categorías
    await pool.query(`
      CREATE TABLE IF NOT EXISTS categorias (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(255) UNIQUE NOT NULL
      )
    `);

    // 4. Habilidades
    await pool.query(`
      CREATE TABLE IF NOT EXISTS habilidades (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(255) UNIQUE NOT NULL
      )
    `);

    // 5. Relación Profesional - Categoría
    await pool.query(`
      CREATE TABLE IF NOT EXISTS profesional_categorias (
        profesional_id UUID REFERENCES perfiles.profesionales(id) ON DELETE CASCADE,
        categoria_id INTEGER REFERENCES categorias(id) ON DELETE CASCADE,
        PRIMARY KEY (profesional_id, categoria_id)
      )
    `);

    // 6. Relación Profesional - Habilidad
    await pool.query(`
      CREATE TABLE IF NOT EXISTS profesional_habilidades (
        profesional_id UUID REFERENCES perfiles.profesionales(id) ON DELETE CASCADE,
        habilidad_id INTEGER REFERENCES habilidades(id) ON DELETE CASCADE,
        PRIMARY KEY (profesional_id, habilidad_id)
      )
    `);

    // 7. Trabajos Portafolio
    await pool.query(`
      CREATE TABLE IF NOT EXISTS trabajos_portafolio (
        id SERIAL PRIMARY KEY,
        profesional_id UUID REFERENCES perfiles.profesionales(id) ON DELETE CASCADE,
        titulo VARCHAR(255),
        descripcion TEXT,
        imagen_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 8. Conversaciones
    await pool.query(`
      CREATE TABLE IF NOT EXISTS conversaciones (
        id SERIAL PRIMARY KEY,
        cliente_id UUID NOT NULL,
        profesional_usuario_id UUID NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(cliente_id, profesional_usuario_id)
      )
    `);

    // 9. Mensajes
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mensajes (
        id SERIAL PRIMARY KEY,
        conversacion_id INTEGER REFERENCES conversaciones(id) ON DELETE CASCADE,
        remitente_id UUID NOT NULL,
        contenido TEXT NOT NULL,
        tipo VARCHAR(20) DEFAULT 'texto',
        leido BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`ALTER TABLE mensajes ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) DEFAULT 'texto'`);

    // 10. Solicitudes
    await pool.query(`
      CREATE TABLE IF NOT EXISTS solicitudes (
        id SERIAL PRIMARY KEY,
        cliente_id UUID NOT NULL,
        profesional_id UUID,
        titulo VARCHAR(255) NOT NULL,
        descripcion TEXT,
        presupuesto_min DECIMAL(12,2),
        presupuesto_max DECIMAL(12,2),
        disponibilidad VARCHAR(100),
        metodo_pago VARCHAR(50),
        urgencia VARCHAR(50),
        estado VARCHAR(50) DEFAULT 'PENDIENTE',
        imagen_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Asegurar que profesional_id existe (migración)
    await pool.query(`ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS profesional_id UUID`);

    console.log("✅ Esquema y todas las tablas de 'perfile-service' verificados.");
  } catch (err) {
    console.error("❌ Error inicializando DB de perfiles:", err.message);
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
