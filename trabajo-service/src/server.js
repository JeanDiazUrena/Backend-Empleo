import express from 'express';
import cors from 'cors';
import pool, { testDB } from './db.js';
import dotenv from 'dotenv';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
app.use(cors({
    origin: ["https://servihub-topaz.vercel.app", "http://localhost:5173", "http://localhost:4000"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CONFIGURACIÓN DE SUBIDA DE COMPROBANTES
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

app.use('/uploads', express.static(uploadDir));

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'comprobante-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });
const getUploadUrl = (filename) => `/uploads/${filename}`;

app.post('/api/trabajos/upload-comprobante', upload.single('comprobante'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No se subió ningún archivo" });
    const fileUrl = getUploadUrl(req.file.filename);
    res.json({ url: fileUrl });
});

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

const CLIENT_PROFILE_INCOMPLETE_MESSAGE = "Debes completar tu perfil antes de hacer una solicitud.";
const PERFILES_SERVICE_URL = process.env.PERFILES_SERVICE_URL || "http://localhost:3001";

const isClientProfileComplete = (cliente) => {
    if (!cliente) return false;
    return Boolean(
        String(cliente.nombre || "").trim() &&
        String(cliente.telefono || "").trim() &&
        String(cliente.direccion || "").trim()
    );
};

const ensureClientProfileComplete = async (clienteId, res) => {
    try {
        console.log(`[TRABAJOS] Validando perfil del cliente ${clienteId} en: ${PERFILES_SERVICE_URL}`);
        const response = await fetch(`${PERFILES_SERVICE_URL}/api/clientes/${clienteId}`);
        
        if (!response.ok) {
            console.error(`[TRABAJOS] Error al consultar perfiles-service: ${response.status}`);
            return res.status(503).json({ error: "El servicio de perfiles no respondió correctamente." });
        }

        const cliente = await response.json();
        if (isClientProfileComplete(cliente)) return true;
    } catch (error) {
        console.error("❌ ERROR CRÍTICO conectando con perfiles-service:", error.message);
        return res.status(503).json({ error: "No se pudo validar el perfil del cliente por un error de red interno." });
    }

    res.status(403).json({
        error: CLIENT_PROFILE_INCOMPLETE_MESSAGE,
        code: "CLIENT_PROFILE_INCOMPLETE"
    });
    return false;
};

// RUTA RAIZ DE PRUEBA
app.get('/', (req, res) => {
    res.json({ message: "Servicio de Trabajos (Trabajos-Perfil) está corriendo correctamente." });
});

// SCHEMA UPDATE (Movido a db.js y scripts de inicio)// =========================================================================
// RUTA: CREAR TRABAJO (CONTRATAR)
// =========================================================================
app.post('/api/trabajos', async (req, res) => {
    const { cliente_id, profesional_id, solicitud_id, titulo, descripcion, horario, presupuesto, cliente_nombre, categoria } = req.body;

    if (!cliente_id || !profesional_id) {
        return res.status(400).json({ error: 'Faltan cliente_id o profesional_id' });
    }

    try {
        const clientProfileOk = await ensureClientProfileComplete(cliente_id, res);
        if (!clientProfileOk) return;

        if (solicitud_id) {
            const existingJob = await pool.query(
                `SELECT * FROM trabajos
                 WHERE solicitud_id = $1
                   AND estado IN ('EN_PROGRESO', 'FINALIZADO_PROFESIONAL', 'ESPERANDO_CONFIRMACION_TRANSFERENCIA')
                 ORDER BY created_at DESC
                 LIMIT 1`,
                [solicitud_id]
            );

            if (existingJob.rows.length > 0) {
                return res.json({
                    success: true,
                    alreadyExists: true,
                    trabajo: existingJob.rows[0]
                });
            }
        }

        let metodoPago = normalizePaymentMethod(req.body.metodo_pago);
        let montoAcordado = parseMoney(req.body.monto_acordado ?? req.body.monto_total ?? presupuesto);

        if (solicitud_id) {
            try {
                const solicitudRes = await fetch(`${PERFILES_SERVICE_URL}/api/solicitudes/${solicitud_id}`);
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
                await fetch(`${PERFILES_SERVICE_URL}/api/solicitudes/${solicitud_id}/progreso`, {
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
                await fetch(`${PERFILES_SERVICE_URL}/api/solicitudes/cliente/${cliente_id}/aceptar`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ profesional_id })
                });
            } catch (err) {
                console.error("Error setting pending solicitudes to progreso:", err.message);
            }
        }

        // Notify the client
        try {
            await fetch('http://localhost:3005/notificaciones', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: cliente_id,
                    title: 'Solicitud Aceptada',
                    message: `Un profesional ha aceptado tu solicitud "${titulo || 'Servicio'}". Revisa tus trabajos en curso.`,
                    type: 'success'
                })
            });
        } catch (err) { console.error('Error enviando notificacion', err); }

        res.json({ success: true, trabajo: result.rows[0] });
    } catch (error) {
        console.error('Error al crear el trabajo:', error.message);
        res.status(500).json({ error: 'Error interno del servidor al crear el trabajo' });
    }
});

// =========================================================================
// RUTA: OBTENER COTIZACIONES POR CLIENTE (PENDIENTES)
// =========================================================================
app.get('/api/cotizaciones/cliente/:clienteId', async (req, res) => {
    try {
        const { clienteId } = req.params;
        const result = await pool.query(
            `SELECT * FROM cotizaciones
             WHERE cliente_id = $1 AND estado = 'PENDIENTE'
             ORDER BY created_at DESC`,
            [clienteId]
        );
        res.json(result.rows);
    } catch (error) {
        console.error("Error obteniendo cotizaciones del cliente:", error);
        res.status(500).json({ error: "Error obteniendo cotizaciones" });
    }
});

// =========================================================================
// RUTA: OBTENER COTIZACION ACTIVA DE UN TRABAJO ESPECÍFICO
// =========================================================================
app.get('/api/cotizaciones/trabajo/:trabajoId', async (req, res) => {
    try {
        const { trabajoId } = req.params;
        const result = await pool.query(
            `SELECT * FROM cotizaciones
             WHERE trabajo_id = $1
             ORDER BY created_at DESC
             LIMIT 1`,
            [trabajoId]
        );
        res.json(result.rows[0] || null);
    } catch (error) {
        console.error("Error obteniendo cotizacion del trabajo:", error);
        res.status(500).json({ error: "Error obteniendo cotizacion" });
    }
});

// =========================================================================
// RUTA: OBTENER COTIZACIONES POR PROFESIONAL (PENDIENTES)
// =========================================================================
app.get('/api/cotizaciones/profesional/:profesionalId', async (req, res) => {
    try {
        const { profesionalId } = req.params;
        const result = await pool.query(
            `SELECT * FROM cotizaciones
             WHERE profesional_id = $1 AND estado = 'PENDIENTE'
             ORDER BY created_at DESC`,
            [profesionalId]
        );
        res.json(result.rows);
    } catch (error) {
        console.error("Error obteniendo cotizaciones del profesional:", error);
        res.status(500).json({ error: "Error obteniendo cotizaciones" });
    }
});

// =========================================================================
// RUTA: CREAR COTIZACION DESDE DASHBOARD / CHAT
// =========================================================================
app.post('/api/cotizaciones', async (req, res) => {
    const {
        conversacion_id,
        solicitud_id,
        trabajo_id,
        cliente_id,
        profesional_id,
        titulo,
        descripcion,
        monto_total,
        metodo_pago
    } = req.body;

    const montoTotal = Number(monto_total);
    if ((!solicitud_id && !trabajo_id) || !cliente_id || !profesional_id || !Number.isFinite(montoTotal) || montoTotal <= 0) {
        return res.status(400).json({ error: 'Faltan datos de cotizacion o el monto no es valido' });
    }

    try {
        const result = await pool.query(
            `INSERT INTO cotizaciones (
                conversacion_id, solicitud_id, trabajo_id, cliente_id, profesional_id, titulo, descripcion,
                monto_total, porcentaje_comision, metodo_pago, estado
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PENDIENTE')
             RETURNING *`,
            [
                conversacion_id || null,
                solicitud_id || null,
                trabajo_id || null,
                cliente_id,
                profesional_id,
                titulo || 'Cotizacion de servicio',
                descripcion || null,
                montoTotal,
                COMMISSION_RATE * 100,
                normalizePaymentMethod(metodo_pago)
            ]
        );

        try {
            await fetch('http://localhost:3005/notificaciones', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: cliente_id,
                    title: 'Nueva Cotización Recibida',
                    message: `Un profesional te ha enviado una cotización por RD$ ${montoTotal.toLocaleString('es-DO', { minimumFractionDigits: 2 })}.`,
                    type: 'info'
                })
            });
        } catch (err) { console.error('Error enviando notificacion', err); }

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
                 metodo_pago = $7,
                 estado = 'PENDIENTE'
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

        // Notificar al cliente que la cotización fue actualizada
        try {
            await fetch('http://localhost:3005/notificaciones', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: cotizacion.cliente_id,
                    title: 'Cotización Actualizada',
                    message: `El profesional ha actualizado la cotización para "${cotizacion.titulo}". Revisa los nuevos detalles.`,
                    type: 'info'
                })
            });
        } catch (err) { console.error('Error enviando notificacion', err); }

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

        // Verificar si ya existe un trabajo activo entre este cliente y profesional
        const existingJobRes = await client.query(
            `SELECT * FROM trabajos 
             WHERE cliente_id = $1 AND profesional_id = $2 
             AND estado IN ('EN_PROGRESO', 'FINALIZADO_PROFESIONAL') 
             FOR UPDATE`,
            [cotizacion.cliente_id, cotizacion.profesional_id]
        );

        let trabajo;
        if (existingJobRes.rows.length > 0) {
            trabajo = existingJobRes.rows[0];
            await client.query(
                `UPDATE trabajos
                 SET titulo = $1, descripcion = $2, presupuesto = $3, monto_acordado = $4,
                     metodo_pago = $5, cotizacion_id = $6, estado = 'EN_PROGRESO'
                 WHERE id = $7`,
                [cotizacion.titulo, cotizacion.descripcion, presupuesto, cotizacion.monto_total,
                normalizePaymentMethod(cotizacion.metodo_pago), cotizacion.id, trabajo.id]
            );
            trabajo.monto_acordado = cotizacion.monto_total;
            trabajo.estado = 'EN_PROGRESO';
        } else {
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
            trabajo = trabajoRes.rows[0];
        }
        await client.query(
            `UPDATE cotizaciones
             SET estado = 'ACEPTADA', trabajo_id = $2
             WHERE id = $1`,
            [cotizacion.id, trabajo.id]
        );

        if (cotizacion.solicitud_id) {
            try {
                await fetch(`${PERFILES_SERVICE_URL}/api/solicitudes/${cotizacion.solicitud_id}/progreso`, {
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

        // Notify professional
        try {
            await fetch('http://localhost:3005/notificaciones', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: cotizacion.profesional_id,
                    title: 'Cotización Aceptada',
                    message: `El cliente ha aceptado la cotización para "${cotizacion.titulo}". El trabajo está en progreso.`,
                    type: 'success'
                })
            });
        } catch (err) { console.error('Error enviando notificacion', err); }

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
                await fetch(`${PERFILES_SERVICE_URL}/api/solicitudes/${trabajo.solicitud_id}/finalizar`, {
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

        // Notify professional
        try {
            await fetch('http://localhost:3005/notificaciones', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: trabajo.profesional_id,
                    title: 'Pago Liberado',
                    message: `El cliente ha confirmado el trabajo "${trabajo.titulo || 'Servicio'}" y el pago ha sido liberado.`,
                    type: 'success'
                })
            });
        } catch (err) { console.error('Error enviando notificacion', err); }

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
    const { monto_final } = req.body;

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
            let montoAcordado = Number(monto_final || trabajo.monto_acordado);
            
            // Si el monto acordado es nulo o 0, intentamos sacarlo del presupuesto guardado en el trabajo
            if (!montoAcordado || montoAcordado <= 0) {
                montoAcordado = parseMoney(trabajo.presupuesto);
            }

            if (!montoAcordado || montoAcordado <= 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ 
                    error: 'El trabajo no tiene un monto acordado válido. Por favor, asegúrese de que el profesional haya establecido un precio o que la solicitud original tenga un presupuesto definido.' 
                });
            }

            const metodoPago = normalizePaymentMethod(trabajo.metodo_pago);
            const montoComision = Number((montoAcordado * COMMISSION_RATE).toFixed(2));

            if (metodoPago === 'TRANSFERENCIA' && req.body.comprobante_url) {
                // ESCENARIO: TRANSFERENCIA CON COMPROBANTE PENDIENTE DE VALIDACIÓN
                await client.query(
                    `UPDATE trabajos
                     SET estado = 'ESPERANDO_CONFIRMACION_TRANSFERENCIA',
                         estado_pago = 'PENDIENTE',
                         monto_acordado = $2,
                         comprobante_url = $3,
                         comprobante_estado = 'PENDIENTE'
                     WHERE id = $1`,
                    [trabajo_id, montoAcordado, req.body.comprobante_url]
                );

                await client.query(
                    `INSERT INTO acciones_trabajo (trabajo_id, accion, descripcion, realizado_por)
                     VALUES ($1, 'SUBIDA_COMPROBANTE', 'El cliente subió un comprobante de transferencia y espera confirmación del profesional', $2)`,
                    [trabajo_id, trabajo.cliente_id]
                );

                await client.query('COMMIT');

                // Notificar al profesional que debe revisar el comprobante
                try {
                    await fetch('http://localhost:3005/notificaciones', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            user_id: trabajo.profesional_id,
                            title: 'Comprobante de Pago Recibido',
                            message: `El cliente ha subido un comprobante para el trabajo "${trabajo.titulo || 'Servicio'}". Por favor, verifícalo para finalizar.`,
                            type: 'info'
                        })
                    });
                } catch (err) { console.error('Error enviando notificacion', err); }

                return res.status(200).json({
                    success: true,
                    mensaje: 'Comprobante enviado. Esperando confirmación del profesional.',
                    estado: 'ESPERANDO_CONFIRMACION_TRANSFERENCIA'
                });
            }

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
                     updated_at = NOW()
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
                 monto_comision = $3,
                 comprobante_estado = CASE WHEN metodo_pago = 'TRANSFERENCIA' THEN 'APROBADO' ELSE comprobante_estado END
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
                    await fetch(`${PERFILES_SERVICE_URL}/api/solicitudes/${trabajo.solicitud_id}/finalizar`, { method: 'PUT' });
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
            const response = await fetch(`${PERFILES_SERVICE_URL}/api/profesionales/${trabajo.profesional_id}/financiero`);
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
                    await fetch(`${PERFILES_SERVICE_URL}/api/profesionales/${trabajo.profesional_id}/bloquear`, { method: 'PUT' });
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

        // Verificar si existe una cotización aceptada para este trabajo
        const cotizacionRes = await client.query(
            "SELECT * FROM cotizaciones WHERE trabajo_id = $1 AND estado = 'ACEPTADA'",
            [trabajoId]
        );

        if (cotizacionRes.rows.length === 0) {
            throw new Error('Debe existir una cotización aceptada por el cliente antes de terminar el trabajo.');
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

        const trabajo = buscarTrabajo.rows[0];
        try {
            await fetch('http://localhost:3005/notificaciones', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: trabajo.cliente_id,
                    title: 'Trabajo Terminado',
                    message: `El profesional ha marcado el trabajo "${trabajo.titulo || 'Servicio'}" como terminado. Por favor, confirma y libera el pago.`,
                    type: 'info'
                })
            });
        } catch (err) { console.error('Error enviando notificacion', err); }

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
            "SELECT * FROM trabajos WHERE cliente_id = $1 AND estado IN ('EN_PROGRESO', 'FINALIZADO_PROFESIONAL', 'ESPERANDO_CONFIRMACION_TRANSFERENCIA') ORDER BY created_at DESC",
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
            "SELECT * FROM trabajos WHERE cliente_id = $1 AND estado = 'CONFIRMADO_CLIENTE' ORDER BY created_at DESC",
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
            'SELECT * FROM trabajos WHERE profesional_id = $1 ORDER BY created_at DESC',
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
            'SELECT * FROM resenas WHERE profesional_id = $1 ORDER BY created_at DESC',
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
            'SELECT * FROM resenas WHERE cliente_id = $1 ORDER BY created_at DESC',
            [req.params.id]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error buscando reseñas del cliente:', error.message);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// =========================================================================
// RUTA: OBTENER RECIBO COMPLETO DE UN TRABAJO
// =========================================================================
app.get('/api/trabajos/:id/recibo', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `SELECT t.*, c.monto_total as cotizacion_monto, c.descripcion as cotizacion_desc, c.metodo_pago as cotizacion_pago
             FROM trabajos t
             LEFT JOIN cotizaciones c ON t.id = c.trabajo_id AND c.estado = 'ACEPTADA'
             WHERE t.id = $1`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Trabajo no encontrado" });
        }

        const recibo = result.rows[0];
        
        // Intentar obtener más datos del profesional desde perfile-service si es posible
        try {
            const profRes = await fetch(`${PERFILES_SERVICE_URL}/api/profesionales/${recibo.profesional_id}`);
            if (profRes.ok) {
                const profData = await profRes.json();
                recibo.profesional_nombre = profData?.nombre || 'Profesional';
                recibo.profesional_email = profData?.email_publico || 'No disponible';
            }
        } catch (e) {
            console.log("No se pudo obtener info extra del profesional");
        }

        res.json(recibo);
    } catch (error) {
        console.error("Error obteniendo recibo:", error);
        res.status(500).json({ error: "Error del servidor" });
    }
});

// =========================================================================
// RUTA: PROFESIONAL CONFIRMA TRANSFERENCIA
// =========================================================================
app.post('/api/trabajos/:id/confirmar-transferencia', async (req, res) => {
    const trabajo_id = req.params.id;
    const { profesional_id } = req.body;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const queryJob = `
            SELECT * FROM trabajos
            WHERE id = $1 AND profesional_id = $2
            FOR UPDATE
        `;
        const resultJob = await client.query(queryJob, [trabajo_id, profesional_id]);

        if (resultJob.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Trabajo no encontrado o no pertenece a este profesional' });
        }

        const trabajo = resultJob.rows[0];

        if (trabajo.estado !== 'ESPERANDO_CONFIRMACION_TRANSFERENCIA') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'El trabajo no está en espera de confirmación de transferencia' });
        }

        const montoAcordado = Number(trabajo.monto_acordado);
        const montoComision = Number((montoAcordado * COMMISSION_RATE).toFixed(2));

        // Debitar comisión de la billetera
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
                 updated_at = NOW()
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
                `Comision ServiHub ${(COMMISSION_RATE * 100).toFixed(0)}% por pago TRANSFERENCIA confirmado`
            ]
        );

        // Finalizar trabajo
        await client.query(
            `UPDATE trabajos
             SET estado = 'CONFIRMADO_CLIENTE',
                 estado_pago = 'LIBERADO',
                 monto_comision = $2,
                 comprobante_estado = 'APROBADO'
             WHERE id = $1`,
            [trabajo_id, montoComision]
        );

        await client.query(
            `INSERT INTO acciones_trabajo (trabajo_id, accion, descripcion, realizado_por)
             VALUES ($1, 'CONFIRMACION_TRANSFERENCIA', 'El profesional confirmó la recepción de la transferencia', $2)`,
            [trabajo_id, profesional_id]
        );

        await client.query('COMMIT');

        // Cerrar solicitud en perfiles-service
        if (trabajo.solicitud_id) {
            try {
                await fetch(`${PERFILES_SERVICE_URL}/api/solicitudes/${trabajo.solicitud_id}/finalizar`, { method: 'PUT' });
            } catch (err) {
                console.error('Error cerrando solicitud en perfiles-service:', err.message);
            }
        }

        // Notificar al cliente
        try {
            await fetch('http://localhost:3005/notificaciones', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: trabajo.cliente_id,
                    title: 'Pago Confirmado',
                    message: `El profesional ha confirmado tu pago por transferencia para el trabajo "${trabajo.titulo || 'Servicio'}". Ya puedes ver tu recibo.`,
                    type: 'success'
                })
            });
        } catch (err) { console.error('Error enviando notificacion', err); }

        res.json({ success: true, mensaje: 'Transferencia confirmada y trabajo finalizado.' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error confirmando transferencia:', error.message);
        res.status(500).json({ error: 'Error interno del servidor' });
    } finally {
        client.release();
    }
});

const PORT = process.env.PORT || 3003;
app.listen(PORT, async () => {
    console.log(`✅ Microservicio de Trabajos corriendo en http://localhost:${PORT}`);
    await testDB();
});
