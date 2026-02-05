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

app.listen(process.env.PORT || 3000, () => {
  console.log(` Servidor Auth corriendo en puerto ${process.env.PORT || 3000}`);
});