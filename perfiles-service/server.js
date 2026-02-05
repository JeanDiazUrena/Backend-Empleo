import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { pool } from "./db.js";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
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
// RUTA 1: GUARDAR O ACTUALIZAR PERFIL
// ==========================================
app.post("/api/perfiles", upload.fields([{ name: 'avatar', maxCount: 1 }, { name: 'cover', maxCount: 1 }]), async (req, res) => {
  try {
    const {
      usuario_id, nombre, profesion, biografia, categoria,
      anios_experiencia, sitio_web, telefono, email_publico,
      ciudad, sector, horario, habilidades
    } = req.body;

    // A. Verificar si el usuario ya existe
    const checkUser = await pool.query("SELECT id FROM profesionales WHERE usuario_id = $1", [usuario_id]);
    
    let profesionalId;
    const avatarUrl = req.files['avatar'] ? `http://localhost:${PORT}/uploads/${req.files['avatar'][0].filename}` : null;
    const coverUrl = req.files['cover'] ? `http://localhost:${PORT}/uploads/${req.files['cover'][0].filename}` : null;

    if (checkUser.rows.length > 0) {
      // === ACTUALIZAR (UPDATE) ===
      profesionalId = checkUser.rows[0].id;
      
      // Creamos la consulta dinámica para no borrar fotos si no se suben nuevas
      let query = `UPDATE profesionales SET 
        nombre=$1, profesion=$2, biografia=$3, anios_experiencia=$4, 
        telefono=$5, email_publico=$6, sitio_web=$7, ciudad=$8, sector=$9, horario_texto=$10`;
      
      const values = [
        nombre, profesion, biografia, anios_experiencia || 0,
        telefono, email_publico, sitio_web, ciudad, sector, horario
      ];
      
      let counter = 11;
      if (avatarUrl) { query += `, avatar_url=$${counter}`; values.push(avatarUrl); counter++; }
      if (coverUrl) { query += `, cover_url=$${counter}`; values.push(coverUrl); counter++; }
      
      query += ` WHERE id=$${counter}`;
      values.push(profesionalId);

      await pool.query(query, values);

    } else {
      // === CREAR (INSERT) ===
      const insertResult = await pool.query(
        `INSERT INTO profesionales (
          usuario_id, nombre, profesion, biografia, anios_experiencia,
          telefono, email_publico, sitio_web, ciudad, sector, horario_texto,
          avatar_url, cover_url
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
        [
          usuario_id, nombre, profesion, biografia, anios_experiencia || 0,
          telefono, email_publico, sitio_web, ciudad, sector, horario,
          avatarUrl, coverUrl
        ]
      );
      profesionalId = insertResult.rows[0].id;
    }

    // B. ACTUALIZAR CATEGORÍA
    if (categoria) {
      await pool.query("DELETE FROM profesional_categorias WHERE profesional_id = $1", [profesionalId]);
      
      let catRes = await pool.query("SELECT id FROM categorias WHERE nombre = $1", [categoria]);
      let catId = catRes.rows.length > 0 ? catRes.rows[0].id : (await pool.query("INSERT INTO categorias (nombre) VALUES ($1) RETURNING id", [categoria])).rows[0].id;
      
      await pool.query("INSERT INTO profesional_categorias (profesional_id, categoria_id) VALUES ($1, $2)", [profesionalId, catId]);
    }

    // C. ACTUALIZAR HABILIDADES
    if (habilidades) {
        await pool.query("DELETE FROM profesional_habilidades WHERE profesional_id = $1", [profesionalId]);
        
        let habilidadesArray = [];
        if (typeof habilidades === 'string') habilidadesArray = habilidades.split(',').map(h => h.trim()).filter(Boolean);
        
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
// RUTA 2: OBTENER PERFIL COMPLETO
// ==========================================
app.get("/api/profesionales/:usuarioId", async (req, res) => {
  const { usuarioId } = req.params;
  try {
    const result = await pool.query(`
      SELECT p.*,
        (SELECT nombre FROM categorias c JOIN profesional_categorias pc ON pc.categoria_id = c.id WHERE pc.profesional_id = p.id LIMIT 1) as categoria_nombre,
        (SELECT STRING_AGG(h.nombre, ', ') FROM habilidades h JOIN profesional_habilidades ph ON ph.habilidad_id = h.id WHERE ph.profesional_id = p.id) as habilidades
      FROM profesionales p WHERE p.usuario_id = $1
    `, [usuarioId]);

    if (result.rows.length === 0) return res.json(null);

    const perfil = result.rows[0];
    const portfolio = await pool.query("SELECT * FROM trabajos_portafolio WHERE profesional_id = $1 ORDER BY id DESC", [perfil.id]);

    res.json({
      id: perfil.id,
      name: perfil.nombre,
      profession: perfil.profesion,
      bio: perfil.biografia,
      category: perfil.categoria_nombre,
      experience: perfil.anios_experiencia,
      phone: perfil.telefono,
      emailPublic: perfil.email_publico,
      website: perfil.sitio_web,
      avatar: perfil.avatar_url,
      cover: perfil.cover_url,
      workingHours: perfil.horario_texto,
      skills: perfil.habilidades,
      city: perfil.ciudad,
      sector: perfil.sector,
      fecha_registro: perfil.fecha_registro,
      location: `${perfil.ciudad}, ${perfil.sector}`,
      portfolio: portfolio.rows
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error servidor" });
  }
});

// ==========================================
// RUTAS DE PORTAFOLIO (Crear, Leer Uno, Editar, Borrar)
// ==========================================

// CREAR
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

// LEER UNO (Para editar)
app.get("/api/portfolio/single/:id", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM trabajos_portafolio WHERE id = $1", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ message: "No existe" });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// EDITAR (PUT)
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

// BORRAR (DELETE)
app.delete("/api/portfolio/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM trabajos_portafolio WHERE id = $1", [req.params.id]);
    res.json({ message: "Eliminado" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => {
  console.log(`SERVIDOR 3001 CORRIENDO`);
});