import express from 'express';
import cors from 'cors';
import pool from './db.js'; // ¡Ojo! En ES Modules hay que poner el .js al final
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

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
            ADD COLUMN IF NOT EXISTS categoria TEXT;
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
        const result = await pool.query(
            `INSERT INTO trabajos (cliente_id, profesional_id, solicitud_id, estado, titulo, descripcion, horario, presupuesto, cliente_nombre, categoria) 
             VALUES ($1, $2, $3, 'EN_PROGRESO', $4, $5, $6, $7, $8, $9) RETURNING *`,
            [cliente_id, profesional_id, solicitud_id || null, titulo || null, descripcion || null, horario || null, presupuesto || null, cliente_nombre || null, categoria || null]
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
            SELECT t.id, t.profesional_id, t.estado, t.metodo_pago,
                   c.monto_total, c.monto_comision
            FROM trabajos t
            LEFT JOIN cotizaciones c ON t.cotizacion_id = c.id
            WHERE t.id = $1
        `;
        const resultJob = await client.query(queryJob, [trabajo_id]);

        if (resultJob.rows.length === 0) {
            return res.status(404).json({ error: 'Trabajo no encontrado' });
        }

        const trabajo = resultJob.rows[0];

        if (trabajo.estado === 'COMPLETADO') {
            return res.status(400).json({ error: 'Este trabajo ya fue completado previamente' });
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