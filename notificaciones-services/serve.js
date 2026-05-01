import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { testDB, pool } from "./db.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Obtener todas las notificaciones de un usuario
app.get("/notificaciones/:user_id", async (req, res) => {
    try {
        const { user_id } = req.params;
        const result = await pool.query(
            "SELECT * FROM notificaciones WHERE user_id = $1 ORDER BY created_at DESC",
            [user_id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// Marcar notificación como leída
app.put("/notificaciones/:id/read", async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query("UPDATE notificaciones SET is_read = TRUE WHERE id = $1", [id]);
        res.json({ message: "Notificación marcada como leída" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// Obtener la cantidad de notificaciones no leídas
app.get("/notificaciones/:user_id/unread-count", async (req, res) => {
    try {
        const { user_id } = req.params;
        const result = await pool.query(
            "SELECT COUNT(*) FROM notificaciones WHERE user_id = $1 AND is_read = FALSE",
            [user_id]
        );
        res.json({ count: parseInt(result.rows[0].count, 10) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// Crear notificación (para que otros servicios la llamen)
app.post("/notificaciones", async (req, res) => {
    try {
        const { user_id, title, message, type } = req.body;
        const result = await pool.query(
            "INSERT INTO notificaciones (user_id, title, message, type) VALUES ($1, $2, $3, $4) RETURNING *",
            [user_id, title, message, type || 'info']
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

const PORT = process.env.PORT || 3005;

app.listen(PORT, async () => {
    console.log(`Servicio de notificaciones corriendo en puerto ${PORT}`);
    await testDB();
});
