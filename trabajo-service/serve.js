import express from 'express';
import cors from 'cors';
import pool from './db.js'; // ¡Ojo! En ES Modules hay que poner el .js al final
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const COMMISSION_RATE = 0.10;

const normalizePaymentMethod = (method) => {
    const normalized = String(method || 'EFECTIVO').trim().toUpperCase();
    if (normalized === 'TARJETA') return 'TARJETA_CREDITO';
    if (['EFECTIVO', 'TRANSFERENCIA', 'TARJETA_CREDITO'].includes(normalized)) return normalized;
    return 'EFECTIVO';
};

const parseMoney = (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;

    const matches = String(value).match(/\d+(?:[.,]\d+)*/g);
    if (!matches) return null;

    const numbers = matches
        .map((part) => Number(part.replace(/,/g, '')))
        .filter((amount) => Number.isFinite(amount));

    return numbers.length > 0 ? Math.max(...numbers) : null;
};

// RUTA RAIZ DE PRUEBA
app.get('/', (req, res) => {
    res.json({ message: "Servicio de Trabajos (Trabajos-Perfil) está corriendo correctamente." });
});

// SCHEMA UPDATE
const initDB = async () => {
    try {
        await pool.query(`
            ALTER TABLE trabajos 
            ADD COLUMN IF NOT EXISTS horario TEXT,
            ADD COLUMN IF NOT EXISTS presupuesto TEXT,
            ADD COLUMN IF NOT EXISTS cliente_nombre TEXT,
            ADD COLUMN IF NOT EXISTS categoria TEXT,
            ADD COLUMN IF NOT EXISTS monto_acordado NUMERIC(12, 2),
            ADD COLUMN IF NOT EXISTS metodo_pago VARCHAR(50) DEFAULT 'EFECTIVO',
            ADD COLUMN IF NOT EXISTS estado_pago VARCHAR(50) DEFAULT 'PENDIENTE',
            ADD COLUMN IF NOT EXISTS monto_comision NUMERIC(12, 2) DEFAULT 0;
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS billetera_profesional (
                profesional_id UUID PRIMARY KEY,
                balance NUMERIC(12, 2) NOT NULL DEFAULT 0,
                total_comisiones_debitadas NUMERIC(12, 2) NOT NULL DEFAULT 0,
                fecha_actualizacion TIMESTAMP DEFAULT NOW()
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS movimientos_billetera (
                id SERIAL PRIMARY KEY,
                profesional_id UUID NOT NULL,
                trabajo_id UUID REFERENCES trabajos(id) ON DELETE SET NULL,
                tipo VARCHAR(50) NOT NULL,
                monto NUMERIC(12, 2) NOT NULL,
                descripcion TEXT,
                fecha_creacion TIMESTAMP DEFAULT NOW()
            );
        `);
        await pool.query(`
            ALTER TABLE trabajos
            ALTER COLUMN metodo_pago TYPE VARCHAR(50) USING UPPER(metodo_pago::text),
            ALTER COLUMN metodo_pago SET DEFAULT 'EFECTIVO';
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS cotizaciones (
                id SERIAL PRIMARY KEY,
                trabajo_id UUID REFERENCES trabajos(id) ON DELETE SET NULL,
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
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        await pool.query(`
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
        `);
        console.log("Tabla trabajos actualizada con columnas adicionales");
    } catch (err) {
        console.error("Error inicializando BD:", err.message);
    }
};
initDB();

// =========================================================================
// RUTA: CREAR TRABAJO (CONTRATAR)
// =========================================================================
app.post('/api/trabajos', async (req, res) => {
    const { cliente_id, profesional_id, solicitud_id, titulo, descripcion, horario, presupuesto, cliente_nombre, categoria } = req.body;

    if (!cliente_id || !profesional_id) {
        return res.status(400).json({ error: 'Faltan cliente_id o profesional_id' });
    }

    try {
        let metodoPago = normalizePaymentMethod(req.body.metodo_pago);
        let montoAcordado = parseMoney(req.body.monto_acordado ?? req.body.monto_total ?? presupuesto);

        if (solicitud_id) {
            try {
                const solicitudRes = await fetch(`http://localhost:3001/api/solicitudes/${solicitud_id}`);
                if (solicitudRes.ok) {
                    const solicitud = await solicitudRes.json();
                    metodoPago = normalizePaymentMethod(req.body.metodo_pago || solicitud.metodo_pago);
                    montoAcordado = montoAcordado ?? parseMoney(solicitud.monto_acordado ?? solicitud.presupuesto_max ?? solicitud.presupuesto_min);
                }
            } catch (err) {
                console.error("No se pudo leer la solicitud para copiar pago/monto:", err.message);
            }
        }

        const result = await pool.query(
            `INSERT INTO trabajos (
                cliente_id, profesional_id, solicitud_id, estado, titulo, descripcion, horario,
                presupuesto, cliente_nombre, categoria, monto_acordado, metodo_pago, estado_pago
             ) 
             VALUES ($1, $2, $3, 'EN_PROGRESO', $4, $5, $6, $7, $8, $9, $10, $11, 'PENDIENTE') RETURNING *`,
            [
                cliente_id,
                profesional_id,
                solicitud_id || null,
                titulo || null,
                descripcion || null,
                horario || null,
                presupuesto || null,
                cliente_nombre || null,
                categoria || null,
                montoAcordado,
                metodoPago
            ]
        );

        // Update the solicitud in perfiles-service so it disappears from the professional's feed
        if (solicitud_id) {
            try {
                await fetch(`http://localhost:3001/api/solicitudes/${solicitud_id}/progreso`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ profesional_id })
                });
            } catch (err) {
                console.error("Error setting solicitud to progreso:", err.message);
            }
        } else {
            // Si no hay solicitud_id, cerramos cualquier solicitud pendiente del cliente
            try {
                await fetch(`http://localhost:3001/api/solicitudes/cliente/${cliente_id}/aceptar`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ profesional_id })
                });
            } catch (err) {
                console.error("Error setting pending solicitudes to progreso:", err.message);
            }
        }

        res.json({ success: true, trabajo: result.rows[0] });
    } catch (error) {
        console.error('Error al crear el trabajo:', error.message);
        res.status(500).json({ error: 'Error interno del servidor al crear el trabajo' });
    }
});

// =========================================================================
// RUTA: CREAR COTIZACION DESDE CHAT
// =========================================================================
app.post('/api/cotizaciones', async (req, res) => {
    const {
        conversacion_id,
        solicitud_id,
        cliente_id,
        profesional_id,
        titulo,
        descripcion,
        monto_total,
        metodo_pago
    } = req.body;

    const montoTotal = Number(monto_total);
    if (!solicitud_id || !cliente_id || !profesional_id || !Number.isFinite(montoTotal) || montoTotal <= 0) {
        return res.status(400).json({ error: 'Faltan datos de cotizacion o el monto no es valido' });
    }

    try {
        const result = await pool.query(
            `INSERT INTO cotizaciones (
                conversacion_id, solicitud_id, cliente_id, profesional_id, titulo, descripcion,
                monto_total, porcentaje_comision, metodo_pago, estado
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDIENTE')
             RETURNING *`,
            [
                conversacion_id || null,
                solicitud_id || null,
                cliente_id,
                profesional_id,
                titulo || 'Cotizacion de servicio',
                descripcion || null,
                montoTotal,
                COMMISSION_RATE * 100,
                normalizePaymentMethod(metodo_pago)
            ]
        );

        res.status(201).json({ success: true, cotizacion: result.rows[0] });
    } catch (error) {
        console.error('Error creando cotizacion:', error.message);
        res.status(500).json({ error: 'Error interno al crear la cotizacion' });
    }
});

// =========================================================================
// RUTA: EDITAR COTIZACION ANTES DE QUE EL TRABAJO TERMINE
// =========================================================================
app.put('/api/cotizaciones/:id', async (req, res) => {
    const cotizacionId = req.params.id;
    const { profesional_id, solicitud_id, titulo, descripcion, monto_total, metodo_pago } = req.body;
    const montoTotal = Number(monto_total);

    if (!profesional_id || !Number.isFinite(montoTotal) || montoTotal <= 0) {
        return res.status(400).json({ error: 'Faltan datos o el monto no es valido' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const existing = await client.query(
            `SELECT c.*, t.estado AS trabajo_estado
             FROM cotizaciones c
             LEFT JOIN trabajos t ON t.id = c.trabajo_id
             WHERE c.id = $1 AND c.profesional_id = $2
             FOR UPDATE`,
            [cotizacionId, profesional_id]
        );

        if (existing.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Cotizacion no encontrada' });
        }

        const current = existing.rows[0];
        const editable =
            current.estado === 'PENDIENTE' ||
            (current.estado === 'ACEPTADA' && current.trabajo_id && current.trabajo_estado === 'EN_PROGRESO');

        if (!editable) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'La cotizacion ya no se puede editar porque el trabajo fue terminado o confirmado' });
        }

        const result = await client.query(
            `UPDATE cotizaciones
             SET solicitud_id = COALESCE($3, solicitud_id),
                 titulo = $4,
                 descripcion = $5,
                 monto_total = $6,
                 metodo_pago = $7
             WHERE id = $1
               AND profesional_id = $2
             RETURNING *`,
            [
                cotizacionId,
                profesional_id,
                solicitud_id || null,
                titulo || 'Cotizacion de servicio',
                descripcion || null,
                montoTotal,
                normalizePaymentMethod(metodo_pago)
            ]
        );

        const cotizacion = result.rows[0];
        if (cotizacion.trabajo_id) {
            const presupuesto = `RD$ ${montoTotal.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            await client.query(
                `UPDATE trabajos
                 SET titulo = $2,
                     descripcion = $3,
                     presupuesto = $4,
                     monto_acordado = $5,
                     metodo_pago = $6
                 WHERE id = $1 AND estado = 'EN_PROGRESO'`,
                [
                    cotizacion.trabajo_id,
                    cotizacion.titulo,
                    cotizacion.descripcion,
                    presupuesto,
                    cotizacion.monto_total,
                    normalizePaymentMethod(cotizacion.metodo_pago)
                ]
            );
        }

        await client.query('COMMIT');
        res.json({ success: true, cotizacion });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error editando cotizacion:', error.message);
        res.status(500).json({ error: 'Error interno al editar la cotizacion' });
    } finally {
        client.release();
    }
});

// =========================================================================
// RUTA: CLIENTE ACEPTA COTIZACION Y SE CREA TRABAJO
// =========================================================================
app.put('/api/cotizaciones/:id/aceptar', async (req, res) => {
    const cotizacionId = req.params.id;
    const { cliente_id } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const cotRes = await client.query(
            `SELECT * FROM cotizaciones WHERE id = $1 FOR UPDATE`,
            [cotizacionId]
        );

        if (cotRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Cotizacion no encontrada' });
        }

        const cotizacion = cotRes.rows[0];
        if (cliente_id && String(cotizacion.cliente_id) !== String(cliente_id)) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'Esta cotizacion no pertenece a este cliente' });
        }

        if (cotizacion.estado === 'ACEPTADA' && cotizacion.trabajo_id) {
            await client.query('COMMIT');
            return res.json({ success: true, trabajo_id: cotizacion.trabajo_id, cotizacion });
        }

        const presupuesto = `RD$ ${Number(cotizacion.monto_total).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        const trabajoRes = await client.query(
            `INSERT INTO trabajos (
                cliente_id, profesional_id, solicitud_id, estado, titulo, descripcion, presupuesto,
                monto_acordado, metodo_pago, estado_pago, cotizacion_id
             )
             VALUES ($1, $2, $3, 'EN_PROGRESO', $4, $5, $6, $7, $8, 'PENDIENTE', $9)
             RETURNING *`,
            [
                cotizacion.cliente_id,
                cotizacion.profesional_id,
                cotizacion.solicitud_id || null,
                cotizacion.titulo,
                cotizacion.descripcion,
                presupuesto,
                cotizacion.monto_total,
                normalizePaymentMethod(cotizacion.metodo_pago),
                cotizacion.id
            ]
        );

        const trabajo = trabajoRes.rows[0];
        await client.query(
            `UPDATE cotizaciones
             SET estado = 'ACEPTADA', trabajo_id = $2
             WHERE id = $1`,
            [cotizacion.id, trabajo.id]
        );

        if (cotizacion.solicitud_id) {
            try {
                await fetch(`http://localhost:3001/api/solicitudes/${cotizacion.solicitud_id}/progreso`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ profesional_id: cotizacion.profesional_id })
                });
            } catch (err) {
                console.error('Error actualizando solicitud a progreso:', err.message);
            }
        }

        await client.query(
            `INSERT INTO acciones_trabajo (trabajo_id, accion, descripcion, realizado_por)
             VALUES ($1, 'COTIZACION_ACEPTADA', 'El cliente acepto la cotizacion enviada por chat', $2)`,
            [trabajo.id, cotizacion.cliente_id]
        );

        await client.query('COMMIT');
        res.json({ success: true, trabajo, cotizacion: { ...cotizacion, estado: 'ACEPTADA', trabajo_id: trabajo.id } });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error aceptando cotizacion:', error.message);
        res.status(500).json({ error: 'Error interno al aceptar la cotizacion' });
    } finally {
        client.release();
    }
});

// =========================================================================
// RUTA: CONFIRMAR TRABAJO 
// =========================================================================
app.post('/api/trabajos/:id/confirmar', async (req, res) => {
    const trabajoId = req.params.id;
    const { cliente_id, comentario } = req.body;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const buscarTrabajo = await client.query(
            'SELECT * FROM trabajos WHERE id = $1 AND cliente_id = $2',
            [trabajoId, cliente_id]
        );

        if (buscarTrabajo.rows.length === 0) {
            throw new Error('Trabajo no encontrado o no le pertenece a este cliente.');
        }

        const trabajo = buscarTrabajo.rows[0];

        await client.query(
            `INSERT INTO confirmaciones (trabajo_id, cliente_id, confirmado, comentario) 
       VALUES ($1, $2, $3, $4)`,
            [trabajoId, cliente_id, true, comentario || 'Cliente confirmó sin dejar comentarios']
        );

        await client.query(
            `UPDATE trabajos SET estado = 'CONFIRMADO_CLIENTE' WHERE id = $1`,
            [trabajoId]
        );

        await client.query(
            `INSERT INTO acciones_trabajo (trabajo_id, accion, descripcion, realizado_por) 
       VALUES ($1, 'CONFIRMACION', 'El cliente marcó el trabajo como satisfactorio', $2)`,
            [trabajoId, cliente_id]
        );

        await client.query('COMMIT');

        // EFECTO DOMINÓ: CERRAR SOLICITUD EN PERFILES-SERVICE
        try {
            if (trabajo.solicitud_id) {
                await fetch(`http://localhost:3001/api/solicitudes/${trabajo.solicitud_id}/finalizar`, {
                    method: 'PUT'
                });
                console.log(`Solicitud ${trabajo.solicitud_id} finalizada en perfiles-service`);
            }
        } catch (err) {
            console.error('Error cerrando solicitud en perfiles-service:', err.message);
        }

        // EFECTO DOMINÓ: LIBERAR PAGO EN PAGO-SERVICE
        try {
            await fetch(`http://localhost:3002/api/pagos/${trabajoId}/liberar`, {
                method: 'PUT'
            });
            console.log(`Pago liberado para el trabajo ${trabajoId} en pago-service`);
        } catch (err) {
            console.error('Error liberando pago en pago-service:', err.message);
        }

        res.status(200).json({
            success: true,
            mensaje: '¡Trabajo confirmado con éxito! El pago será liberado al profesional.',
            trabajo_id: trabajoId,
            profesional_id: trabajo.profesional_id
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error(' Error al confirmar el trabajo:', error.message);
        res.status(500).json({ success: false, error: error.message || 'Error del servidor' });
    } finally {
        client.release();
    }
});

// =========================================================================
// RUTA: FINALIZAR TRABAJO Y COBRAR COMISIONES
// =========================================================================
app.post('/api/trabajos/:id/finalizar', async (req, res) => {
    const trabajo_id = req.params.id; 
    
    // 1. Iniciamos un cliente exclusivo para la transacción SQL
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // 2. OBTENER DATOS (JOIN trabajos y cotizaciones)
        const queryJob = `
            SELECT t.id, t.profesional_id, t.cliente_id, t.solicitud_id, t.estado,
                   t.metodo_pago, t.monto_acordado, t.presupuesto, t.estado_pago
            FROM trabajos t
            WHERE t.id = $1
            FOR UPDATE
        `;
        const resultJob = await client.query(queryJob, [trabajo_id]);

        if (resultJob.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Trabajo no encontrado' });
        }

        const trabajo = resultJob.rows[0];

        if (trabajo.estado === 'CONFIRMADO_CLIENTE' || trabajo.estado_pago === 'LIBERADO') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Este trabajo ya fue completado previamente' });
        }

        {
        const montoAcordado = Number(trabajo.monto_acordado ?? parseMoney(trabajo.presupuesto));
        if (!Number.isFinite(montoAcordado) || montoAcordado <= 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'El trabajo no tiene un monto acordado valido.' });
        }

        const metodoPago = normalizePaymentMethod(trabajo.metodo_pago);
        const montoComision = Number((montoAcordado * COMMISSION_RATE).toFixed(2));

        if (metodoPago === 'EFECTIVO' || metodoPago === 'TRANSFERENCIA') {
            await client.query(
                `INSERT INTO billetera_profesional (profesional_id, balance)
                 VALUES ($1, 0)
                 ON CONFLICT (profesional_id) DO NOTHING`,
                [trabajo.profesional_id]
            );

            await client.query(
                `UPDATE billetera_profesional
                 SET balance = balance - $2,
                     total_comisiones_debitadas = total_comisiones_debitadas + $2,
                     fecha_actualizacion = NOW()
                 WHERE profesional_id = $1`,
                [trabajo.profesional_id, montoComision]
            );

            await client.query(
                `INSERT INTO movimientos_billetera (profesional_id, trabajo_id, tipo, monto, descripcion)
                 VALUES ($1, $2, 'DEBITO_COMISION', $3, $4)`,
                [
                    trabajo.profesional_id,
                    trabajo_id,
                    montoComision,
                    `Comision ServiHub ${(COMMISSION_RATE * 100).toFixed(0)}% por pago ${metodoPago}`
                ]
            );
        } else if (metodoPago !== 'TARJETA_CREDITO') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Metodo de pago no reconocido o invalido' });
        }

        await client.query(
            `UPDATE trabajos
             SET estado = 'CONFIRMADO_CLIENTE',
                 estado_pago = 'LIBERADO',
                 monto_acordado = $2,
                 monto_comision = $3
             WHERE id = $1`,
            [trabajo_id, montoAcordado, montoComision]
        );

        await client.query(
            `INSERT INTO acciones_trabajo (trabajo_id, accion, descripcion, realizado_por)
             VALUES ($1, 'CONFIRMACION_PAGO', 'El cliente confirmo el trabajo y libero el pago', $2)`,
            [trabajo_id, trabajo.cliente_id]
        );

        await client.query('COMMIT');

        if (trabajo.solicitud_id) {
            try {
                await fetch(`http://localhost:3001/api/solicitudes/${trabajo.solicitud_id}/finalizar`, { method: 'PUT' });
            } catch (err) {
                console.error('Error cerrando solicitud en perfiles-service:', err.message);
            }
        }

        return res.status(200).json({
            success: true,
            mensaje: 'Trabajo finalizado y pagos/comisiones procesados exitosamente.',
            monto_acordado: montoAcordado,
            monto_comision: montoComision,
            metodo_pago: metodoPago
        });
        }

        if (!trabajo.monto_comision) {
            return res.status(400).json({ error: 'Falta información de la cotización' });
        }

        // 3. OBTENER DATOS FINANCIEROS (Microservicio Perfiles)
        let perfilData;
        try {
            const response = await fetch(`http://localhost:3001/api/profesionales/${trabajo.profesional_id}/financiero`);
            if (!response.ok) throw new Error('ERROR_RED_PERFILES');
            perfilData = await response.json();
        } catch (error) {
            throw new Error('ERROR_RED_PERFILES');
        }

        const { stripe_card_token, cuenta_bancaria } = perfilData;
        const metodoPago = (trabajo.metodo_pago || '').toUpperCase();

        // 4. LÓGICA DE PAGOS Y COMISIONES
        if (metodoPago === 'TARJETA_CREDITO') {
            // === ESCENARIO A: SPLIT PAYMENT ===
            console.log('Simulando Split Payment en Stripe...');
            
            // Simulación de Stripe transfer
            await client.query(`UPDATE trabajos SET estado = 'COMPLETADO' WHERE id = $1`, [trabajo_id]);
            
        } else if (metodoPago === 'EFECTIVO' || metodoPago === 'TRANSFERENCIA') {
            // === ESCENARIO B: COBRO DIRECTO DE COMISIÓN ===
            if (!stripe_card_token) {
                throw new Error('SIN_METODO_COBRO_PROFESIONAL');
            }

            console.log(`Intentando cobrar comisión de $${trabajo.monto_comision} al token: ${stripe_card_token}`);
            
            let cobroExitoso = true; // Simulamos estado del pago
            
            // Si el intento de cobro a la tarjeta falla
            if (!cobroExitoso) {
                try {
                    await fetch(`http://localhost:3001/api/profesionales/${trabajo.profesional_id}/bloquear`, { method: 'PUT' });
                } catch (err) {
                    console.error('Alerta crítica: No se pudo comunicar el bloqueo a perfiles_db');
                }
                
                throw new Error('COBRO_RECHAZADO_FONDO_INSUFICIENTE');
            } else {
                await client.query(`UPDATE trabajos SET estado = 'COMPLETADO' WHERE id = $1`, [trabajo_id]);
            }
        } else {
            return res.status(400).json({ error: 'Método de pago no reconocido o inválido' });
        }

        // 5. CONFIRMAR TRANSACCIÓN
        await client.query('COMMIT');
        
        res.status(200).json({ 
            success: true, 
            mensaje: 'Trabajo finalizado y pagos/comisiones procesados exitosamente.' 
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error al finalizar trabajo:', error.message);
        
        if (error.message === 'ERROR_RED_PERFILES') {
            return res.status(503).json({ error: 'Servicio de perfiles no disponible. Intente más tarde.' });
        }
        if (error.message === 'COBRO_RECHAZADO_FONDO_INSUFICIENTE') {
            return res.status(402).json({ error: 'El cobro de comisión falló. La cuenta del profesional ha sido bloqueada.' });
        }
        if (error.message === 'SIN_METODO_COBRO_PROFESIONAL') {
             return res.status(400).json({ error: 'El profesional no tiene una tarjeta guardada para cobrar la comisión.' });
        }
        
        res.status(500).json({ error: 'Error interno del servidor.' });
        
    } finally {
        client.release();
    }
});

// =========================================================================
// RUTA: PROFESIONAL MARCA COMO TERMINADO
// =========================================================================
app.put('/api/trabajos/:id/terminar', async (req, res) => {
    const trabajoId = req.params.id;
    const { profesional_id } = req.body;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const buscarTrabajo = await client.query(
            'SELECT * FROM trabajos WHERE id = $1 AND profesional_id = $2',
            [trabajoId, profesional_id]
        );

        if (buscarTrabajo.rows.length === 0) {
            throw new Error('Trabajo no encontrado o no le pertenece a este profesional.');
        }

        await client.query(
            `UPDATE trabajos SET estado = 'FINALIZADO_PROFESIONAL' WHERE id = $1`,
            [trabajoId]
        );

        await client.query(
            `INSERT INTO acciones_trabajo (trabajo_id, accion, descripcion, realizado_por) 
             VALUES ($1, 'TERMINADO', 'El profesional ha marcado el trabajo como completado', $2)`,
            [trabajoId, profesional_id]
        );

        await client.query('COMMIT');
        res.status(200).json({ success: true, mensaje: 'Trabajo marcado como terminado.' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error al terminar el trabajo:', error.message);
        res.status(500).json({ success: false, error: error.message || 'Error del servidor' });
    } finally {
        client.release();
    }
});

// =========================================================================
// RUTA: CREAR RESEÑA
// =========================================================================
app.post('/api/trabajos/:id/resena', async (req, res) => {
    const trabajoId = req.params.id;
    const { cliente_id, profesional_id, calificacion, comentario } = req.body;

    if (!cliente_id || !profesional_id || !calificacion) {
        return res.status(400).json({ success: false, mensaje: 'Faltan datos requeridos (cliente_id, profesional_id, calificacion)' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Check if a review already exists
        const resenaExistente = await client.query(
            'SELECT id FROM resenas WHERE trabajo_id = $1 AND cliente_id = $2',
            [trabajoId, cliente_id]
        );

        if (resenaExistente.rows.length > 0) {
            throw new Error('Ya has dejado una reseña para este trabajo.');
        }

        // Insert new review
        const insertResena = await client.query(
            `INSERT INTO resenas (trabajo_id, cliente_id, profesional_id, calificacion, comentario) 
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [trabajoId, cliente_id, profesional_id, calificacion, comentario]
        );

        // Update actions table
        await client.query(
            `INSERT INTO acciones_trabajo (trabajo_id, accion, descripcion, realizado_por) 
             VALUES ($1, 'RESENA', 'El cliente dejó una reseña', $2)`,
            [trabajoId, cliente_id]
        );

        await client.query('COMMIT');

        res.status(201).json({
            success: true,
            mensaje: 'Reseña enviada con éxito',
            resena: insertResena.rows[0]
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error(' Error al crear la reseña:', error.message);
        res.status(500).json({ success: false, error: error.message || 'Error del servidor' });
    } finally {
        client.release();
    }
});

// =========================================================================
// RUTA: OBTENER UN TRABAJO POR ID
// =========================================================================
app.get('/api/trabajos/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM trabajos WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Trabajo no encontrado' });
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error buscando trabajo por ID:', error.message);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// =========================================================================
// RUTA: OBTENER TRABAJOS ACTIVOS DE CLIENTE (excluye los finalizados/confirmados)
// =========================================================================
app.get('/api/trabajos/cliente/:id', async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM trabajos WHERE cliente_id = $1 AND estado IN ('EN_PROGRESO', 'FINALIZADO_PROFESIONAL') ORDER BY fecha_creacion DESC",
            [req.params.id]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error buscando trabajos del cliente:', error.message);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// =========================================================================
// RUTA: HISTORIAL DE TRABAJOS COMPLETADOS DE CLIENTE
// =========================================================================
app.get('/api/trabajos/cliente/:id/historial', async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM trabajos WHERE cliente_id = $1 AND estado = 'CONFIRMADO_CLIENTE' ORDER BY fecha_creacion DESC",
            [req.params.id]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error buscando historial del cliente:', error.message);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// =========================================================================
// RUTA: OBTENER TRABAJOS DE PROFESIONAL
// =========================================================================
app.get('/api/trabajos/profesional/:id', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM trabajos WHERE profesional_id = $1 ORDER BY fecha_creacion DESC',
            [req.params.id]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error buscando trabajos del profesional:', error.message);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// =========================================================================
// RUTA: OBTENER RESEÑAS DE PROFESIONAL
// =========================================================================
app.get('/api/resenas/profesional/:id', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM resenas WHERE profesional_id = $1 ORDER BY fecha_creacion DESC',
            [req.params.id]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error buscando reseñas del profesional:', error.message);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// =========================================================================
// RUTA: OBTENER RESEÑAS DADAS POR UN CLIENTE
// =========================================================================
app.get('/api/resenas/cliente/:id', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM resenas WHERE cliente_id = $1 ORDER BY fecha_creacion DESC',
            [req.params.id]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error buscando reseñas del cliente:', error.message);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

const PORT = process.env.PORT || 3003;
app.listen(PORT, () => {
    console.log(` Microservicio de Trabajos corriendo en http://localhost:${PORT}`);
});
