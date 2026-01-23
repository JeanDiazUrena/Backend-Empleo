import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import { pool } from "./db.js";
import jwt from "jsonwebtoken";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// --- RUTA: REGISTRAR USUARIO ---
app.post("/api/register", async (req, res) => {
  const { nombre, email, password, rol } = req.body;

  if (!nombre || !email || !password || !rol) {
    return res.status(400).json({ message: "Datos incompletos" });
  }

  if (!['cliente', 'profesional'].includes(rol)) {
    return res.status(400).json({ message: "Rol inválido" });
  }

  try {
    const existe = await pool.query(
      "SELECT id FROM usuarios WHERE email = $1",
      [email]
    );

    if (existe.rows.length > 0) {
      return res.status(409).json({ message: "Email ya registrado" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query(
      `INSERT INTO usuarios (nombre, email, password, rol, activo)
       VALUES ($1, $2, $3, $4, true)`,
      [nombre, email, hashedPassword, rol]
    );

    res.status(201).json({ message: "Usuario creado correctamente" });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error del servidor" });
  }
});

// --- RUTA: LOGIN USUARIO ---
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Datos incompletos" });
  }

  try {
    const result = await pool.query(
      "SELECT * FROM usuarios WHERE email = $1 AND activo = true",
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: "Credenciales inválidas" });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password);

    if (!valid) {
      return res.status(401).json({ message: "Credenciales inválidas" });
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        rol: user.rol
      },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.json({
      token,
      user: {
        id: user.id,
        nombre: user.nombre,
        rol: user.rol
      }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error del servidor" });
  }
});

// --- NUEVA RUTA: GUARDAR PERFIL PROFESIONAL ---
app.post("/api/perfiles", async (req, res) => {
  const { 
    usuario_id, profesion, biografia, categoria, anios_experiencia, 
    sitio_web, telefono, email_publico, ciudad, sector, horario, habilidades 
  } = req.body;

  // Validación básica
  if (!usuario_id || !profesion || !telefono || !ciudad) {
    return res.status(400).json({ message: "Datos obligatorios faltantes" });
  }

  try {
    // =====================================================================
    // ZONA DE CONEXIÓN A BASE DE DATOS (JEAN LUIS)
    // =====================================================================
    // Aquí va el código para insertar en la tabla 'perfiles'.
    // Ejemplo de la consulta que deberían usar:
    /*
    await pool.query(
      `INSERT INTO perfiles (
         usuario_id, profesion, biografia, categoria, anios_experiencia, 
         sitio_web, telefono, email_publico, ciudad, sector, horario, habilidades
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        usuario_id, profesion, biografia, categoria, anios_experiencia, 
        sitio_web, telefono, email_publico, ciudad, sector, horario, habilidades
      ]
    );
    */
    // =====================================================================

    console.log("Perfil recibido para usuario:", usuario_id);
    
    // Respondemos OK para que el frontend avance
    res.status(201).json({ message: "Perfil guardado correctamente" });

  } catch (error) {
    console.error("Error al guardar perfil:", error);
    res.status(500).json({ message: "Error al guardar perfil" });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`🚀 Servidor corriendo en puerto ${process.env.PORT || 3000}`);
});