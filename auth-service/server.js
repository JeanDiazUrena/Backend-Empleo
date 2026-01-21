import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import { pool } from "./db.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Registrar usuario
app.post("/api/register", async (req, res) => {
  const { nombre, email, password } = req.body;

  if (!nombre || !email || !password) {
    return res.status(400).json({ message: "Datos incompletos" });
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
      `INSERT INTO usuarios (nombre, email, password, activo)
       VALUES ($1, $2, $3, true)`,
      [nombre, email, hashedPassword]
    );

    res.status(201).json({ message: "Usuario creado correctamente" });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error del servidor" });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`🚀 Servidor corriendo en puerto ${process.env.PORT || 3000}`);
});
