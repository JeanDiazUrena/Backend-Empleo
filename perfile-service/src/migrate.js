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
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
      port: process.env.DB_PORT,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    };

const pool = new Pool(poolConfig);

const migrate = async () => {
  try {
    console.log("🚀 Iniciando migraciones de perfile-service...");
    
    await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    await pool.query('CREATE EXTENSION IF NOT EXISTS unaccent').catch(() => {});

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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    `);

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
    `);

    // Portafolio
    await pool.query(`
      CREATE TABLE IF NOT EXISTS trabajos_portafolio (
        id SERIAL PRIMARY KEY,
        profesional_id UUID REFERENCES profesionales(id) ON DELETE CASCADE,
        titulo VARCHAR(255),
        descripcion TEXT,
        imagen_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Chat
    await pool.query(`
      CREATE TABLE IF NOT EXISTS conversaciones (
        id SERIAL PRIMARY KEY,
        cliente_id UUID NOT NULL,
        profesional_usuario_id UUID NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(cliente_id, profesional_usuario_id)
      );
      CREATE TABLE IF NOT EXISTS mensajes (
        id SERIAL PRIMARY KEY,
        conversacion_id INTEGER REFERENCES conversaciones(id) ON DELETE CASCADE,
        remitente_id UUID NOT NULL,
        contenido TEXT NOT NULL,
        tipo VARCHAR(20) DEFAULT 'texto',
        nombre_archivo TEXT,
        metadata JSONB,
        leido BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(`ALTER TABLE mensajes ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) DEFAULT 'texto'`);
    await pool.query(`ALTER TABLE mensajes ADD COLUMN IF NOT EXISTS nombre_archivo TEXT`);
    await pool.query(`ALTER TABLE mensajes ADD COLUMN IF NOT EXISTS metadata JSONB`);

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
        fecha_creacion TIMESTAMP DEFAULT NOW(),
        CONSTRAINT fk_profesional FOREIGN KEY (profesional_id) REFERENCES profesionales(id) ON DELETE SET NULL
      )
    `);
    await pool.query(`ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS monto_acordado NUMERIC(12,2)`);
    await pool.query(`ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS metodo_pago VARCHAR(50) DEFAULT 'EFECTIVO'`);
    await pool.query(`ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS estado_pago VARCHAR(50) DEFAULT 'PENDIENTE'`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS solicitud_rechazos (
        id SERIAL PRIMARY KEY,
        solicitud_id INTEGER NOT NULL REFERENCES solicitudes(id) ON DELETE CASCADE,
        profesional_id UUID NOT NULL REFERENCES profesionales(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (solicitud_id, profesional_id)
      )
    `);

    console.log("✅ Migraciones completadas.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error en migraciones:", err.message);
    process.exit(1);
  }
};

migrate();
