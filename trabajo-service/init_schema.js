import pool from "./db.js";

async function run() {
    try {
        console.log("Actualizando trabajos_db...");
        await pool.query(`
            -- Tipo de método de pago
            DO $$ BEGIN
                CREATE TYPE metodo_pago_enum AS ENUM ('efectivo', 'transferencia', 'tarjeta_credito');
            EXCEPTION
                WHEN duplicate_object THEN null;
            END $$;

            -- Crear cotizaciones primero (o actualizarla)
            CREATE TABLE IF NOT EXISTS cotizaciones (
                id SERIAL PRIMARY KEY,
                trabajo_id UUID,
                solicitud_id INTEGER,
                conversacion_id INTEGER,
                cliente_id UUID,
                profesional_id UUID,
                titulo TEXT,
                descripcion TEXT,
                monto_total NUMERIC(10, 2) NOT NULL CHECK (monto_total >= 0),
                porcentaje_comision NUMERIC(5, 2) DEFAULT 10.00 CHECK (porcentaje_comision >= 0 AND porcentaje_comision <= 100),
                monto_comision NUMERIC(10, 2) GENERATED ALWAYS AS (monto_total * (porcentaje_comision / 100.0)) STORED,
                metodo_pago VARCHAR(50) DEFAULT 'EFECTIVO',
                estado VARCHAR(50) DEFAULT 'PENDIENTE',
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT fk_cotizacion_trabajo
                  FOREIGN KEY (trabajo_id) 
                  REFERENCES trabajos(id)
                  ON DELETE CASCADE
            );

            -- Modificar trabajos
            ALTER TABLE trabajos 
            ADD COLUMN IF NOT EXISTS cotizacion_id INT,
            ADD COLUMN IF NOT EXISTS metodo_pago VARCHAR(50) DEFAULT 'EFECTIVO',
            ADD COLUMN IF NOT EXISTS comprobante_url TEXT,
            ADD COLUMN IF NOT EXISTS monto_acordado NUMERIC(12, 2),
            ADD COLUMN IF NOT EXISTS estado_pago VARCHAR(50) DEFAULT 'PENDIENTE',
            ADD COLUMN IF NOT EXISTS monto_comision NUMERIC(12, 2) DEFAULT 0;

            ALTER TABLE trabajos
            ALTER COLUMN metodo_pago TYPE VARCHAR(50) USING UPPER(metodo_pago::text),
            ALTER COLUMN metodo_pago SET DEFAULT 'EFECTIVO';

            CREATE TABLE IF NOT EXISTS billetera_profesional (
                profesional_id UUID PRIMARY KEY,
                balance NUMERIC(12, 2) NOT NULL DEFAULT 0,
                total_comisiones_debitadas NUMERIC(12, 2) NOT NULL DEFAULT 0,
                fecha_actualizacion TIMESTAMP DEFAULT NOW()
            );

            ALTER TABLE cotizaciones
            ALTER COLUMN trabajo_id DROP NOT NULL,
            ADD COLUMN IF NOT EXISTS conversacion_id INTEGER,
            ADD COLUMN IF NOT EXISTS solicitud_id INTEGER,
            ADD COLUMN IF NOT EXISTS cliente_id UUID,
            ADD COLUMN IF NOT EXISTS profesional_id UUID,
            ADD COLUMN IF NOT EXISTS titulo TEXT,
            ADD COLUMN IF NOT EXISTS descripcion TEXT,
            ADD COLUMN IF NOT EXISTS metodo_pago VARCHAR(50) DEFAULT 'EFECTIVO',
            ADD COLUMN IF NOT EXISTS estado VARCHAR(50) DEFAULT 'PENDIENTE';

            CREATE TABLE IF NOT EXISTS movimientos_billetera (
                id SERIAL PRIMARY KEY,
                profesional_id UUID NOT NULL,
                trabajo_id UUID REFERENCES trabajos(id) ON DELETE SET NULL,
                tipo VARCHAR(50) NOT NULL,
                monto NUMERIC(12, 2) NOT NULL,
                descripcion TEXT,
                fecha_creacion TIMESTAMP DEFAULT NOW()
            );

            -- Agregar foreign key (usamos DO $$ para evitar error si ya existe)
            DO $$ BEGIN
                ALTER TABLE trabajos
                ADD CONSTRAINT fk_trabajo_cotizacion
                FOREIGN KEY (cotizacion_id)
                REFERENCES cotizaciones(id)
                ON DELETE SET NULL;
            EXCEPTION
                WHEN duplicate_object THEN null;
            END $$;
        `);
        console.log("Esquema actualizado correctamente en trabajos_db.");
    } catch (e) {
        console.error("Error actualizando trabajos_db:", e);
    } finally {
        pool.end();
    }
}

run();
