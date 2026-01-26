import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { pool } from "./db.js";
import crypto from "crypto";

dotenv.config();

const app = express();
const PORT = 3001; // Forzamos el 3001

app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

// --- RUTA DE PRUEBA DE VIDA ---
// Si entras aquí desde el navegador verás el mensaje
app.get("/api/perfiles", (req, res) => {
  res.send(" ¡HOLA! EL SERVIDOR NUEVO ESTÁ VIVO Y ESCUCHANDO.");
});

app.post("/api/perfiles", async (req, res) => {
  console.log("\n ¡PETICIÓN RECIBIDA EN EL NUEVO CÓDIGO! ");
  console.log(" Datos llegando:", req.body);

  const { usuario_id, profesion, biografia, anios_experiencia, sitio_web, ciudad, sector } = req.body;

  // Validación
  if (!usuario_id) {
    console.error(" ERROR: Faltó el usuario_id");
    return res.status(400).json({ error: "Falta usuario_id" });
  }

  const client = await pool.connect();

  try {
    console.log("🔌 Conectando a BD y empezando transacción...");
    await client.query('BEGIN');

    const nuevoId = crypto.randomUUID();
    
    // 1. Insertar Profesional
    await client.query(
      `INSERT INTO profesionales (id, usuario_id, profesion, biografia, anios_experiencia, sitio_web) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [nuevoId, String(usuario_id), profesion, biografia, anios_experiencia || 0, sitio_web]
    );
    console.log(" Insertado Profesional");

    // 2. Insertar Ubicación (Básica para prueba)
    if (ciudad) {
       // Lógica simplificada para probar inserción múltiple
       console.log(" Intentando guardar ubicación...");
       const ubRes = await client.query(`INSERT INTO ubicaciones (ciudad, sector) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id`, [ciudad, sector]);
       // Nota: Si ya existe no devuelve ID con ON CONFLICT DO NOTHING, pero para prueba sirve.
    }

    await client.query('COMMIT');
    console.log("¡TRANSACCIÓN COMPLETADA EXITOSAMENTE! ");
    
    // Respondemos DESPUÉS de confirmar la BD
    res.status(201).json({ message: "Guardado REAL en base de datos", id: nuevoId });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error(" ERROR FATAL EN SQL:", error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.listen(PORT, () => {
  console.log(`\n SERVIDOR NUEVO INICIADO EN PUERTO ${PORT} `);
  console.log(` Prueba abrir esto en tu navegador: http://localhost:${PORT}/api/perfiles`);
});