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
                trabajo_id UUID NOT NULL,
                monto_total NUMERIC(10, 2) NOT NULL CHECK (monto_total >= 0),
                porcentaje_comision NUMERIC(5, 2) DEFAULT 15.00 CHECK (porcentaje_comision >= 0 AND porcentaje_comision <= 100),
                monto_comision NUMERIC(10, 2) GENERATED ALWAYS AS (monto_total * (porcentaje_comision / 100.0)) STORED,
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT fk_cotizacion_trabajo
                  FOREIGN KEY (trabajo_id) 
                  REFERENCES trabajos(id)
                  ON DELETE CASCADE
            );

            -- Modificar trabajos
            ALTER TABLE trabajos 
            ADD COLUMN IF NOT EXISTS cotizacion_id INT,
            ADD COLUMN IF NOT EXISTS metodo_pago metodo_pago_enum,
            ADD COLUMN IF NOT EXISTS comprobante_url TEXT;

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
