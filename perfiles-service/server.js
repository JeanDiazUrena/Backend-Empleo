import express from "express";
import cors from "cors";
import { pool } from "./db.js";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from "dotenv";

dotenv.config();



const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "http://localhost:5173", methods: ["GET", "POST"] }
});
const PORT = 3001;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. CONFIGURACIÓN BÁSICA
app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 2. CONFIGURACIÓN DE SUBIDA DE IMÁGENES (MULTER)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = 'uploads/';
    if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath);
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ==========================================
// RUTA 1: GUARDAR O ACTUALIZAR PERFIL (PROFESIONALES)
// ==========================================
app.post("/api/perfiles", upload.fields([{ name: 'avatar', maxCount: 1 }, { name: 'cover', maxCount: 1 }]), async (req, res) => {
  try {
    const { usuario_id, nombre, profesion, biografia, categoria, anios_experiencia, sitio_web, telefono, email_publico, ciudad, sector, horario, habilidades } = req.body;
    const checkUser = await pool.query("SELECT id FROM profesionales WHERE usuario_id = $1", [usuario_id]);
    let profesionalId;
    const avatarUrl = req.files['avatar'] ? `http://localhost:${PORT}/uploads/${req.files['avatar'][0].filename}` : null;
    const coverUrl = req.files['cover'] ? `http://localhost:${PORT}/uploads/${req.files['cover'][0].filename}` : null;

    if (checkUser.rows.length > 0) {
      profesionalId = checkUser.rows[0].id;
      let query = `UPDATE profesionales SET nombre=$1, profesion=$2, biografia=$3, anios_experiencia=$4, telefono=$5, email_publico=$6, sitio_web=$7, ciudad=$8, sector=$9, horario_texto=$10`;
      const values = [nombre, profesion, biografia, anios_experiencia || 0, telefono, email_publico, sitio_web, ciudad, sector, horario];
      let counter = 11;
      if (avatarUrl) { query += `, avatar_url=$${counter}`; values.push(avatarUrl); counter++; }
      if (coverUrl) { query += `, cover_url=$${counter}`; values.push(coverUrl); counter++; }
      query += ` WHERE id=$${counter}`;
      values.push(profesionalId);
      await pool.query(query, values);
    } else {
      const insertResult = await pool.query(
        `INSERT INTO profesionales (usuario_id, nombre, profesion, biografia, anios_experiencia, telefono, email_publico, sitio_web, ciudad, sector, horario_texto, avatar_url, cover_url) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
        [usuario_id, nombre, profesion, biografia, anios_experiencia || 0, telefono, email_publico, sitio_web, ciudad, sector, horario, avatarUrl, coverUrl]
      );
      profesionalId = insertResult.rows[0].id;
    }

    if (categoria) {
      await pool.query("DELETE FROM profesional_categorias WHERE profesional_id = $1", [profesionalId]);
      let catRes = await pool.query("SELECT id FROM categorias WHERE nombre = $1", [categoria]);
      let catId = catRes.rows.length > 0 ? catRes.rows[0].id : (await pool.query("INSERT INTO categorias (nombre) VALUES ($1) RETURNING id", [categoria])).rows[0].id;
      await pool.query("INSERT INTO profesional_categorias (profesional_id, categoria_id) VALUES ($1, $2)", [profesionalId, catId]);
    }
    if (habilidades) {
      await pool.query("DELETE FROM profesional_habilidades WHERE profesional_id = $1", [profesionalId]);
      let habilidadesArray = typeof habilidades === 'string' ? habilidades.split(',').map(h => h.trim()).filter(Boolean) : [];
      for (const habilidad of habilidadesArray) {
        const habRes = await pool.query(`INSERT INTO habilidades (nombre) VALUES ($1) ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING id`, [habilidad]);
        await pool.query(`INSERT INTO profesional_habilidades (profesional_id, habilidad_id) VALUES ($1,$2)`, [profesionalId, habRes.rows[0].id]);
      }
    }
    res.json({ message: "Perfil guardado", id: profesionalId });
  } catch (error) {
    console.error("Error backend:", error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// RUTA 2B: OBTENER TODOS LOS PROFESIONALES (Para Explorar)
// ==========================================
app.get("/api/profesionales", async (req, res) => {
  const { busqueda, categoria, ciudad } = req.query;
  try {
    let query = `
      SELECT 
        p.*,
        (SELECT nombre FROM categorias c JOIN profesional_categorias pc ON pc.categoria_id = c.id WHERE pc.profesional_id = p.id LIMIT 1) as categoria_nombre,
        (SELECT STRING_AGG(h.nombre, ', ') FROM habilidades h JOIN profesional_habilidades ph ON ph.habilidad_id = h.id WHERE ph.profesional_id = p.id) as habilidades,
        (SELECT imagen_url FROM trabajos_portafolio tp WHERE tp.profesional_id = p.id ORDER BY id DESC LIMIT 1) as foto_reciente
      FROM profesionales p
      WHERE p.activo = true 
        AND p.nombre IS NOT NULL AND p.nombre != ''
        AND p.profesion IS NOT NULL AND p.profesion != ''
    `;
    const params = [];
    let i = 1;

    if (busqueda) {
      query += ` AND (LOWER(p.nombre) LIKE $${i} OR LOWER(p.profesion) LIKE $${i} OR LOWER(p.biografia) LIKE $${i})`;
      params.push(`%${busqueda.toLowerCase()}%`);
      i++;
    }
    if (categoria) {
      query += ` AND EXISTS (SELECT 1 FROM categorias c JOIN profesional_categorias pc ON pc.categoria_id = c.id WHERE pc.profesional_id = p.id AND LOWER(c.nombre) = $${i})`;
      params.push(categoria.toLowerCase());
      i++;
    }
    if (ciudad) {
      query += ` AND LOWER(p.ciudad) LIKE $${i}`;
      params.push(`%${ciudad.toLowerCase()}%`);
      i++;
    }

    query += ` ORDER BY p.id DESC`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error("Error obteniendo profesionales:", error);
    res.status(500).json({ error: "Error servidor" });
  }
});

// ==========================================
// RUTA 2: OBTENER PERFIL COMPLETO (PROFESIONALES)
// ==========================================
app.get("/api/profesionales/:usuarioId", async (req, res) => {
  const { usuarioId } = req.params;
  try {
    const result = await pool.query(`SELECT p.*, (SELECT nombre FROM categorias c JOIN profesional_categorias pc ON pc.categoria_id = c.id WHERE pc.profesional_id = p.id LIMIT 1) as categoria_nombre, (SELECT STRING_AGG(h.nombre, ', ') FROM habilidades h JOIN profesional_habilidades ph ON ph.habilidad_id = h.id WHERE ph.profesional_id = p.id) as habilidades FROM profesionales p WHERE p.usuario_id = $1`, [usuarioId]);
    if (result.rows.length === 0) return res.json(null);
    const perfil = result.rows[0];
    const portfolio = await pool.query("SELECT * FROM trabajos_portafolio WHERE profesional_id = $1 ORDER BY id DESC", [perfil.id]);
    res.json({ ...perfil, location: `${perfil.ciudad}, ${perfil.sector}`, portfolio: portfolio.rows });
  } catch (error) { res.status(500).json({ error: "Error servidor" }); }
});

// ==========================================
// RUTAS FINANCIERAS (PARA TRABAJOS-SERVICE)
// ==========================================
app.get("/api/profesionales/:usuarioId/financiero", async (req, res) => {
  try {
    const { usuarioId } = req.params;
    const result = await pool.query("SELECT stripe_card_token, cuenta_bancaria, banco, estado_financiero FROM profesionales WHERE usuario_id = $1", [usuarioId]);
    if (result.rows.length === 0) return res.status(404).json({ error: "No encontrado" });
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: "Error servidor" }); }
});

app.put("/api/profesionales/:usuarioId/bloquear", async (req, res) => {
  try {
    const { usuarioId } = req.params;
    await pool.query("UPDATE profesionales SET estado_financiero = 'bloqueado_por_deuda' WHERE usuario_id = $1", [usuarioId]);
    res.json({ message: "Usuario bloqueado" });
  } catch (error) { res.status(500).json({ error: "Error servidor" }); }
});

app.put("/api/profesionales/:usuarioId/financiero", async (req, res) => {
  const { usuarioId } = req.params;
  const { stripe_card_token, cuenta_bancaria, banco } = req.body;
  
  console.log("--- INTENTANDO GUARDAR DATOS FINANCIEROS ---");
  console.log("ID Usuario:", usuarioId);
  console.log("Datos:", { stripe_card_token, cuenta_bancaria, banco });

  try {
    // 1. Verificar si el profesional ya existe
    const check = await pool.query("SELECT id FROM profesionales WHERE usuario_id = $1", [usuarioId]);
    
    if (check.rows.length > 0) {
      console.log("Profesional encontrado, actualizando...");
      await pool.query(
        "UPDATE profesionales SET stripe_card_token = $1, cuenta_bancaria = $2, banco = $3 WHERE usuario_id = $4",
        [stripe_card_token, cuenta_bancaria, banco, usuarioId]
      );
    } else {
      console.log("Profesional NO encontrado, creando registro base...");
      await pool.query(
        `INSERT INTO profesionales (
          usuario_id, stripe_card_token, cuenta_bancaria, banco, 
          nombre, profesion, biografia, ciudad, sector, telefono, anios_experiencia, activo
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [usuarioId, stripe_card_token, cuenta_bancaria, banco, 'Profesional', 'Sin especificar', '', 'Sin especificar', 'Sin especificar', '000-000-0000', 0, true]
      );
    }

    console.log("¡Guardado exitoso!");
    res.json({ message: "Datos financieros actualizados exitosamente" });
  } catch (error) { 
    console.error("ERROR CRÍTICO EN GUARDADO FINANCIERO:");
    console.error(error);
    res.status(500).json({ error: "Error en el servidor: " + error.message }); 
  }
});

// ==========================================
// RUTAS DE PORTAFOLIO
// ==========================================
app.post("/api/portfolio", upload.single('imagen'), async (req, res) => {
  try {
    const { profesional_id, titulo, descripcion } = req.body;
    if (!req.file) return res.status(400).json({ message: "Falta imagen" });
    const prof = await pool.query("SELECT id FROM profesionales WHERE usuario_id = $1", [profesional_id]);
    if (prof.rows.length === 0) return res.status(404).json({ message: "Perfil no existe" });
    const imagenUrl = `http://localhost:${PORT}/uploads/${req.file.filename}`;
    await pool.query("INSERT INTO trabajos_portafolio (profesional_id, titulo, descripcion, imagen_url) VALUES ($1, $2, $3, $4)", [prof.rows[0].id, titulo, descripcion, imagenUrl]);
    res.json({ message: "Creado" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get("/api/portfolio/single/:id", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM trabajos_portafolio WHERE id = $1", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ message: "No existe" });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.put("/api/portfolio/:id", upload.single('imagen'), async (req, res) => {
  try {
    const { id } = req.params;
    const { titulo, descripcion } = req.body;
    if (req.file) {
      const imagenUrl = `http://localhost:${PORT}/uploads/${req.file.filename}`;
      await pool.query("UPDATE trabajos_portafolio SET titulo=$1, descripcion=$2, imagen_url=$3 WHERE id=$4", [titulo, descripcion, imagenUrl, id]);
    } else {
      await pool.query("UPDATE trabajos_portafolio SET titulo=$1, descripcion=$2 WHERE id=$3", [titulo, descripcion, id]);
    }
    res.json({ message: "Actualizado" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.delete("/api/portfolio/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM trabajos_portafolio WHERE id = $1", [req.params.id]);
    res.json({ message: "Eliminado" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// RUTAS DE CLIENTES
// ==========================================
app.get("/api/clientes/:usuarioId", async (req, res) => {
  try {
    const { usuarioId } = req.params;
    const result = await pool.query("SELECT * FROM clientes WHERE usuario_id = $1", [usuarioId]);
    if (result.rows.length === 0) return res.json(null);
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error buscando cliente" });
  }
});

app.post("/api/clientes", upload.fields([{ name: 'avatar', maxCount: 1 }, { name: 'banner', maxCount: 1 }]), async (req, res) => {
  try {
    const { usuario_id, phone, location, nombre, email } = req.body;

    let avatarUrl = null;
    let bannerUrl = null;

    if (req.files['avatar']) {
      avatarUrl = `http://localhost:${PORT}/uploads/${req.files['avatar'][0].filename}`;
    }
    if (req.files['banner']) {
      bannerUrl = `http://localhost:${PORT}/uploads/${req.files['banner'][0].filename}`;
    }

    const check = await pool.query("SELECT id FROM clientes WHERE usuario_id = $1", [usuario_id]);

    if (check.rows.length > 0) {
      await pool.query(
        `UPDATE clientes SET telefono = $1, direccion = $2, avatar = COALESCE($3, avatar), banner = COALESCE($4, banner), nombre = COALESCE($5, nombre), email = COALESCE($6, email) WHERE usuario_id = $7`,
        [phone, location, avatarUrl, bannerUrl, nombre, email, usuario_id]
      );
    } else {
      await pool.query(
        `INSERT INTO clientes (usuario_id, telefono, direccion, avatar, banner, nombre, email) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [usuario_id, phone, location, avatarUrl, bannerUrl, nombre, email]
      );
    }

    // DEVOLVER LOS DATOS REALES AL FRONTEND PARA ACTUALIZAR LA IMAGEN
    const updatedUser = await pool.query("SELECT * FROM clientes WHERE usuario_id = $1", [usuario_id]);

    res.json({
      message: "Perfil guardado con imágenes",
      cliente: updatedUser.rows[0]
    });

  } catch (error) {
    console.error("Error backend clientes:", error);
    res.status(500).json({ error: "Error guardando datos" });
  }
});

app.delete("/api/perfiles/usuario/:usuarioId", async (req, res) => {
  const { usuarioId } = req.params;
  try {
    const profResult = await pool.query("SELECT id FROM profesionales WHERE usuario_id = $1", [usuarioId]);
    if (profResult.rows.length > 0) {
      const profId = profResult.rows[0].id;
      await pool.query("DELETE FROM profesional_categorias WHERE profesional_id = $1", [profId]).catch(() => { });
      await pool.query("DELETE FROM profesional_habilidades WHERE profesional_id = $1", [profId]).catch(() => { });
      await pool.query("DELETE FROM trabajos_portafolio WHERE profesional_id = $1", [profId]).catch(() => { });
      await pool.query("DELETE FROM profesionales WHERE id = $1", [profId]).catch(() => { });
    }

    await pool.query("DELETE FROM clientes WHERE usuario_id = $1", [usuarioId]).catch(() => { });
    await pool.query("DELETE FROM conversaciones WHERE cliente_id = $1 OR profesional_usuario_id = $1", [usuarioId]).catch(() => { });
    await pool.query("DELETE FROM solicitudes WHERE cliente_id = $1", [usuarioId]).catch(() => { });

    res.json({ success: true, message: "Datos del perfil eliminados de perfiles-service" });
  } catch (error) {
    console.error("Error eliminando perfil del usuario:", error);
    res.status(500).json({ error: "Error eliminando perfil del usuario" });
  }
});

// ==========================================
// CREAR TABLAS DE CHAT (si no existen)
// ==========================================
const initChatTables = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS conversaciones (
        id SERIAL PRIMARY KEY,
        cliente_id UUID NOT NULL,
        profesional_usuario_id UUID NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(cliente_id, profesional_usuario_id)
      )
    `);
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
    
    // Migración para columna tipo si no existe
    await pool.query(`ALTER TABLE mensajes ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) DEFAULT 'texto'`);

    // TABLA SOLICITUDES
    await pool.query(`
      CREATE TABLE IF NOT EXISTS solicitudes (
        id SERIAL PRIMARY KEY,
        cliente_id UUID NOT NULL,
        titulo VARCHAR(255) NOT NULL,
        categoria VARCHAR(255) NOT NULL,
        descripcion TEXT NOT NULL,
        urgencia VARCHAR(50),
        ubicacion VARCHAR(255),
        disponibilidad VARCHAR(100),
        presupuesto_min DECIMAL(12,2),
        presupuesto_max DECIMAL(12,2),
        imagen_url TEXT,
        profesional_id UUID,
        estado VARCHAR(50) DEFAULT 'pendiente',
        metodo_pago VARCHAR(50) DEFAULT 'EFECTIVO',
        fecha_creacion TIMESTAMP DEFAULT NOW(),
        CONSTRAINT fk_profesional FOREIGN KEY (profesional_id) REFERENCES profesionales(id) ON DELETE SET NULL
      )
    `);
    console.log("Tablas de chat y solicitudes listas");
  } catch (err) {
    console.error("Error creando tablas chat/solicitudes:", err.message);
  }
};
initChatTables();

// ==========================================
// RUTAS DE SOLICITUDES
// ==========================================
app.post("/api/solicitudes", upload.single('imagen'), async (req, res) => {
  try {
    const { cliente_id, titulo, categoria, descripcion, profesional_id, urgencia, ubicacion, disponibilidad, presupuesto_min, presupuesto_max, metodo_pago } = req.body;
    let imagenUrl = null;
    if (req.file) {
      imagenUrl = `http://localhost:${PORT}/uploads/${req.file.filename}`;
    }
    const result = await pool.query(
      "INSERT INTO solicitudes (cliente_id, titulo, categoria, descripcion, profesional_id, imagen_url, urgencia, ubicacion, disponibilidad, presupuesto_min, presupuesto_max, metodo_pago) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *",
      [cliente_id, titulo, categoria, descripcion, profesional_id || null, imagenUrl, urgencia, ubicacion, disponibilidad, presupuesto_min || null, presupuesto_max || null, metodo_pago || 'EFECTIVO']
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error creando solicitud:", error);
    res.status(500).json({ error: "Error creando solicitud" });
  }
});

app.get("/api/solicitudes/cliente/:clienteId", async (req, res) => {
  try {
    const { clienteId } = req.params;
    const result = await pool.query("SELECT * FROM solicitudes WHERE cliente_id = $1 AND estado != 'FINALIZADA' ORDER BY fecha_creacion DESC", [clienteId]);
    res.json(result.rows);
  } catch (error) {
    console.error("Error obteniendo solicitudes del cliente:", error);
    res.status(500).json({ error: "Error obteniendo solicitudes" });
  }
});

app.get("/api/solicitudes", async (req, res) => {
  try {
    const { profesional_id } = req.query;
    let query = `
      SELECT s.*, c.nombre as cliente_nombre, c.avatar as cliente_avatar, c.direccion as cliente_direccion
      FROM solicitudes s
      LEFT JOIN clientes c ON s.cliente_id::text = c.usuario_id::text
      WHERE s.estado = 'pendiente'
    `;
    const params = [];
    if (profesional_id) {
      query += ` AND (s.profesional_id IS NULL OR s.profesional_id::text = $1) `;
      params.push(profesional_id);
    } else {
      query += ` AND s.profesional_id IS NULL `;
    }
    query += ` ORDER BY s.fecha_creacion DESC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error("Error obteniendo todas las solicitudes:", error);
    res.status(500).json({ error: "Error obteniendo solicitudes" });
  }
});

app.put("/api/solicitudes/:id/finalizar", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE solicitudes SET estado = 'FINALIZADA' WHERE id = $1 RETURNING *`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Solicitud no encontrada" });
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error finalizando solicitud:", error);
    res.status(500).json({ error: "Error servidor" });
  }
});

app.put("/api/solicitudes/:id/progreso", async (req, res) => {
  try {
    const { id } = req.params;
    const { profesional_id } = req.body;
    const result = await pool.query(
      `UPDATE solicitudes SET estado = 'en_progreso', profesional_id = $1 WHERE id = $2 RETURNING *`,
      [profesional_id, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Solicitud no encontrada" });
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error actualizando solicitud a progreso:", error);
    res.status(500).json({ error: "Error servidor" });
  }
});

app.put("/api/solicitudes/cliente/:clienteId/aceptar", async (req, res) => {
  try {
    const { clienteId } = req.params;
    const { profesional_id } = req.body;
    const result = await pool.query(
      `UPDATE solicitudes SET estado = 'en_progreso', profesional_id = $1 WHERE cliente_id = $2 AND estado = 'pendiente' RETURNING *`,
      [profesional_id, clienteId]
    );
    res.json({ success: true, actualizadas: result.rowCount });
  } catch (error) {
    console.error("Error aceptando solicitudes del cliente:", error);
    res.status(500).json({ error: "Error servidor" });
  }
});

// ==========================================
// RUTAS DE CHAT (REST)
// ==========================================
app.post("/api/chat/conversacion", async (req, res) => {
  const { cliente_id, profesional_usuario_id, solicitud_titulo, solicitud_descripcion } = req.body;
  if (!cliente_id || !profesional_usuario_id) return res.status(400).json({ error: "Faltan datos" });
  try {
    // Check if conversation already exists
    const existing = await pool.query(
      `SELECT * FROM conversaciones WHERE cliente_id = $1 AND profesional_usuario_id = $2`,
      [cliente_id, profesional_usuario_id]
    );

    let conv;
    const isNew = existing.rows.length === 0;

    if (isNew) {
      // Create new conversation
      await pool.query(
        `INSERT INTO conversaciones (cliente_id, profesional_usuario_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [cliente_id, profesional_usuario_id]
      );
    }

    const result = await pool.query(
      `SELECT * FROM conversaciones WHERE cliente_id = $1 AND profesional_usuario_id = $2`,
      [cliente_id, profesional_usuario_id]
    );
    conv = result.rows[0];

    // If solicitud_titulo is provided (from job acceptance), insert auto-messages
    if (solicitud_titulo) {
      const msgCliente = solicitud_descripcion
        ? `📋 Solicitud enviada: "${solicitud_titulo}"\n\n${solicitud_descripcion}`
        : `📋 Solicitud enviada: "${solicitud_titulo}"`;
      
      // Message 1: from client
      await pool.query(
        `INSERT INTO mensajes (conversacion_id, remitente_id, contenido) VALUES ($1, $2, $3)`,
        [conv.id, cliente_id, msgCliente]
      );

      // Message 2: from professional
      await pool.query(
        `INSERT INTO mensajes (conversacion_id, remitente_id, contenido) VALUES ($1, $2, $3)`,
        [conv.id, profesional_usuario_id, `✅ Solicitud aceptada. ¡Hola! He aceptado tu solicitud y estoy listo para comenzar. ¿Cuándo podemos coordinar los detalles?`]
      );

      // Emit via socket if possible (though conv.id might not be joined yet)
      // io.to(`conv_${conv.id}`).emit("new_message", ...); 
    }

    res.json(conv);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/chat/conversaciones/cliente/:usuarioId", async (req, res) => {
  const { usuarioId } = req.params;
  try {
    const result = await pool.query(`
      SELECT c.*,
        p.nombre as otro_nombre, p.avatar_url as otro_avatar, p.profesion as otro_sub,
        (SELECT m.contenido FROM mensajes m WHERE m.conversacion_id = c.id ORDER BY m.created_at DESC LIMIT 1) as ultimo_mensaje,
        (SELECT m.created_at FROM mensajes m WHERE m.conversacion_id = c.id ORDER BY m.created_at DESC LIMIT 1) as ultimo_mensaje_fecha,
        (SELECT COUNT(*) FROM mensajes m WHERE m.conversacion_id = c.id AND m.remitente_id::text != $1 AND m.leido = false)::int as no_leidos
      FROM conversaciones c
      LEFT JOIN profesionales p ON p.usuario_id::text = c.profesional_usuario_id::text
      WHERE c.cliente_id::text = $1
      ORDER BY ultimo_mensaje_fecha DESC NULLS LAST
    `, [usuarioId]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/chat/conversaciones/profesional/:usuarioId", async (req, res) => {
  const { usuarioId } = req.params;
  try {
    const result = await pool.query(`
      SELECT c.*,
        cl.nombre as otro_nombre, cl.avatar as otro_avatar, NULL as otro_sub,
        (SELECT m.contenido FROM mensajes m WHERE m.conversacion_id = c.id ORDER BY m.created_at DESC LIMIT 1) as ultimo_mensaje,
        (SELECT m.created_at FROM mensajes m WHERE m.conversacion_id = c.id ORDER BY m.created_at DESC LIMIT 1) as ultimo_mensaje_fecha,
        (SELECT COUNT(*) FROM mensajes m WHERE m.conversacion_id = c.id AND m.remitente_id::text != $1 AND m.leido = false)::int as no_leidos,
        (SELECT metodo_pago FROM solicitudes WHERE cliente_id = c.cliente_id::uuid AND (profesional_id::text = $1 OR profesional_id IS NULL) ORDER BY fecha_creacion DESC LIMIT 1) as metodo_pago
      FROM conversaciones c
      LEFT JOIN clientes cl ON cl.usuario_id::text = c.cliente_id::text
      WHERE c.profesional_usuario_id::text = $1
      ORDER BY ultimo_mensaje_fecha DESC NULLS LAST
    `, [usuarioId]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/chat/mensajes/:conversacionId", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM mensajes WHERE conversacion_id = $1 ORDER BY created_at ASC`,
      [req.params.conversacionId]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put("/api/chat/leer/:conversacionId", async (req, res) => {
  const { lector_id } = req.body;
  try {
    await pool.query(
      `UPDATE mensajes SET leido = true WHERE conversacion_id = $1 AND remitente_id::text != $2`,
      [req.params.conversacionId, lector_id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// CARGA DE ARCHIVOS EN EL CHAT
// ==========================================
app.post("/api/chat/upload", upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se subió ningún archivo" });
  const fileUrl = `http://localhost:${PORT}/uploads/${req.file.filename}`;
  res.json({ url: fileUrl, filename: req.file.originalname, mimetype: req.file.mimetype });
});

app.get("/api/chat/unread-count/:usuarioId", async (req, res) => {
  const { usuarioId } = req.params;
  try {
    const result = await pool.query(
      `SELECT COUNT(*)::int as count 
       FROM mensajes m
       JOIN conversaciones c ON m.conversacion_id = c.id
       WHERE (c.cliente_id::text = $1 OR c.profesional_usuario_id::text = $1)
       AND m.remitente_id::text != $1
       AND m.leido = false`,
      [usuarioId]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// SOCKET.IO — TIEMPO REAL
// ==========================================
const connectedUsers = new Set(); // Guardará los IDs de usuarios online

io.on("connection", (socket) => {
  // Cuando un usuario se conecta, envía su ID por la query
  const userId = socket.handshake.query.userId;
  if (userId) {
    connectedUsers.add(userId);
    // Emitir la lista actualizada a todo el mundo
    io.emit("online_users", Array.from(connectedUsers));
  }

  socket.on("join_conversation", (conversacionId) => {
    socket.join(`conv_${conversacionId}`);
  });

  socket.on("send_message", async (data) => {
    const { conversacion_id, remitente_id, contenido, tipo } = data;
    try {
      const result = await pool.query(
        `INSERT INTO mensajes (conversacion_id, remitente_id, contenido, tipo) VALUES ($1, $2, $3, $4) RETURNING *`,
        [conversacion_id, remitente_id, contenido, tipo || 'texto']
      );
      // Incluir el avatar del remitente o nombre extra opcional
      const newMsg = result.rows[0];
      io.to(`conv_${conversacion_id}`).emit("new_message", newMsg);
      // Emitir notificación global para que los layouts se enteren
      io.emit("notification_new_message", newMsg);
    } catch (err) {
      console.error("Error en socket send_message:", err.message);
    }
  });

  socket.on("messages_read", (data) => {
    // Notificar a todos que se han leído mensajes para actualizar contadores globales
    io.emit("update_unread_count", { usuarioId: data.usuarioId });
  });

  socket.on("disconnect", () => {
    if (userId) {
      connectedUsers.delete(userId);
      // Notificar desconexión
      io.emit("online_users", Array.from(connectedUsers));
    }
  });
});

// ==========================================
// INICIAR SERVIDOR
// ==========================================
httpServer.listen(PORT, () => {
  console.log(`SERVIDOR ${PORT} con Socket.io activo`);
});