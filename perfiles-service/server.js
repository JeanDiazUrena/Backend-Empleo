import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { pool } from "./db.js";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { Server } from 'socket.io';

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
      WHERE 1=1
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
        leido BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log("Tablas de chat listas");
  } catch (err) {
    console.error("Error creando tablas chat:", err.message);
  }
};
initChatTables();

// ==========================================
// RUTAS DE CHAT (REST)
// ==========================================
app.post("/api/chat/conversacion", async (req, res) => {
  const { cliente_id, profesional_usuario_id } = req.body;
  if (!cliente_id || !profesional_usuario_id) return res.status(400).json({ error: "Faltan datos" });
  try {
    await pool.query(
      `INSERT INTO conversaciones (cliente_id, profesional_usuario_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [cliente_id, profesional_usuario_id]
    );
    const result = await pool.query(
      `SELECT * FROM conversaciones WHERE cliente_id = $1 AND profesional_usuario_id = $2`,
      [cliente_id, profesional_usuario_id]
    );
    res.json(result.rows[0]);
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
        (SELECT COUNT(*) FROM mensajes m WHERE m.conversacion_id = c.id AND m.remitente_id::text != $1 AND m.leido = false)::int as no_leidos
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
    const { conversacion_id, remitente_id, contenido } = data;
    try {
      const result = await pool.query(
        `INSERT INTO mensajes (conversacion_id, remitente_id, contenido) VALUES ($1, $2, $3) RETURNING *`,
        [conversacion_id, remitente_id, contenido]
      );
      // Incluir el avatar del remitente o nombre extra opcional
      io.to(`conv_${conversacion_id}`).emit("new_message", result.rows[0]);
    } catch (err) {
      console.error("Error en socket send_message:", err.message);
    }
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