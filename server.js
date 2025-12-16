// server.js
import express from "express";
import cors from "cors";
import pool from "./db.js"; // Tu conexión a PostgreSQL

const app = express();
const PORT = 3000;

// Middlewares
app.use(cors());
app.use(express.json());

// ------------------------
// Rutas
// ------------------------

// Ruta raíz de prueba
app.get("/", (req, res) => {
  res.json({ mensaje: "Servidor backend funcionando correctamente" });
});

// Obtener todos los productos
app.get("/api/productos", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM productos ORDER BY id ASC");
    res.json(result.rows);
  } catch (error) {
    console.error("Error al obtener productos:", error);
    res.status(500).json({ error: error.message });
  }
});

// Obtener un producto por ID
app.get("/api/productos/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query("SELECT * FROM productos WHERE id = $1", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error al obtener producto:", error);
    res.status(500).json({ error: error.message });
  }
});

// Crear un nuevo producto
app.post("/api/productos", async (req, res) => {
  const { nombre, precio, stock, categoria } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO productos (nombre, precio, stock, categoria) VALUES ($1, $2, $3, $4) RETURNING *",
      [nombre, precio, stock, categoria]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error al crear producto:", error);
    res.status(500).json({ error: error.message });
  }
});

// Actualizar un producto por ID
app.put("/api/productos/:id", async (req, res) => {
  const { id } = req.params;
  const { nombre, precio, stock, categoria } = req.body;
  try {
    const result = await pool.query(
      "UPDATE productos SET nombre=$1, precio=$2, stock=$3, categoria=$4 WHERE id=$5 RETURNING *",
      [nombre, precio, stock, categoria, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error al actualizar producto:", error);
    res.status(500).json({ error: error.message });
  }
});

// Eliminar un producto por ID
app.delete("/api/productos/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query("DELETE FROM productos WHERE id=$1 RETURNING *", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }
    res.json({ mensaje: "Producto eliminado", producto: result.rows[0] });
  } catch (error) {
    console.error("Error al eliminar producto:", error);
    res.status(500).json({ error: error.message });
  }
});

// Test de conexión a la DB
app.get("/api/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ success: true, serverTime: result.rows[0].now });
  } catch (error) {
    console.error("Error al conectar con la base:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ------------------------
// Servidor
// ------------------------
app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
