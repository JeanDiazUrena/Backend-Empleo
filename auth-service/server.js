import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import { pool } from "./db.js";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

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

    // CORRECCIÓN: Usamos RETURNING id para obtener el ID del nuevo usuario
    const newUser = await pool.query(
      `INSERT INTO usuarios (nombre, email, password, rol, activo)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id`,
      [nombre, email, hashedPassword, rol]
    );

    res.status(201).json({
      message: "Usuario creado correctamente",
      id: newUser.rows[0].id // <--- DEVOLVEMOS EL ID
    });

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
      { id: user.id, email: user.email, rol: user.rol },
      process.env.JWT_SECRET || "secret",
      { expiresIn: "1h" }
    );

    res.json({
      token,
      user: { id: user.id, nombre: user.nombre, rol: user.rol }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error del servidor" });
  }
});

// --- RUTA: LOGIN/REGISTRO CON GOOGLE ---
app.post("/api/google", async (req, res) => {
  const { credential, rol } = req.body;

  if (!credential) {
    return res.status(400).json({ message: "Token de Google requerido" });
  }

  try {
    // 1. Verificar Token
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const email = payload.email;
    const name = payload.name;

    // 2. Comprobar si existe en BD
    const result = await pool.query("SELECT * FROM usuarios WHERE email = $1 AND activo = true", [email]);
    let user = result.rows.length > 0 ? result.rows[0] : null;

    if (!user) {
      // 3. Crear usuario (SI trae rol, asume intención de Registro)
      if (!rol) {
        return res.status(404).json({ message: "Cuenta no registrada. Por favor, crea una cuenta primero en la pantalla de registro." });
      }

      if (!['cliente', 'profesional'].includes(rol)) {
        return res.status(400).json({ message: "Rol inválido al registrar por Google." });
      }

      const randomPassword = await bcrypt.hash(Math.random().toString(36).substring(2, 18), 10);

      const newUser = await pool.query(
        `INSERT INTO usuarios (nombre, email, password, rol, activo) VALUES ($1, $2, $3, $4, true) RETURNING *`,
        [name, email, randomPassword, rol]
      );
      user = newUser.rows[0];
    }

    // 4. Generar Token JWT
    const token = jwt.sign(
      { id: user.id, email: user.email, rol: user.rol },
      process.env.JWT_SECRET || "secret",
      { expiresIn: "1h" }
    );

    res.json({
      token,
      user: { id: user.id, nombre: user.nombre, rol: user.rol }
    });

  } catch (error) {
    console.error("Google Auth Error:", error);
    res.status(500).json({ message: "Error al validar tu cuenta de Google." });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log(` Servidor Auth corriendo en puerto ${process.env.PORT || 3000}`);
});