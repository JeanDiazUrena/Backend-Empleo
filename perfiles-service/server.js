import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { pool } from "./db.js";
import crypto from "crypto";

dotenv.config();

const app = express();
app.use(cors({
  origin: "http://localhost:5173", // <- tu frontend
}));
app.use(express.json());

app.post("/api/perfiles", async (req, res) => {
  const {
    usuario_id,
    profesion,
    biografia,
    anios_experiencia,
    sitio_web,
    telefono,
    email_publico,
    ciudad,
    sector,
    horario,
    habilidades
  } = req.body;

  try {
    const profesionalId = crypto.randomUUID();

    // 1. profesionales
    await pool.query(
      `INSERT INTO profesionales 
      (id, usuario_id, profesion, biografia, anios_experiencia, sitio_web)
      VALUES ($1,$2,$3,$4,$5,$6)`,
      [profesionalId, usuario_id, profesion, biografia, anios_experiencia, sitio_web]
    );

    // 2. contacto
    await pool.query(
      `INSERT INTO contacto_profesional 
      (profesional_id, telefono, email_publico)
      VALUES ($1,$2,$3)`,
      [profesionalId, telefono, email_publico]
    );

    // 3. ubicacion
    const ubicacion = await pool.query(
      `INSERT INTO ubicaciones (ciudad, sector)
       VALUES ($1,$2) RETURNING id`,
      [ciudad, sector]
    );

    await pool.query(
      `INSERT INTO profesional_ubicaciones 
      (profesional_id, ubicacion_id)
      VALUES ($1,$2)`,
      [profesionalId, ubicacion.rows[0].id]
    );

    // 4. habilidades
    for (const nombre of habilidades) {
      const hab = await pool.query(
        `INSERT INTO habilidades (nombre)
         VALUES ($1)
         ON CONFLICT (nombre) DO NOTHING
         RETURNING id`,
        [nombre]
      );

      if (hab.rows[0]) {
        await pool.query(
          `INSERT INTO profesional_habilidades
          (profesional_id, habilidad_id)
          VALUES ($1,$2)`,
          [profesionalId, hab.rows[0].id]
        );
      }
    }

    res.status(201).json({ message: "Perfil creado", profesionalId });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error al crear perfil" });
  }
});

app.listen(process.env.PORT, () => {
  console.log(`🚀 Perfiles service en puerto ${process.env.PORT}`);
});
