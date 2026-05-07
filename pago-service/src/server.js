import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { pool, testDB } from "./db.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// Logger simple
app.use((req, res, next) => {
    console.log(`${new Date().toLocaleString()} - ${req.method} ${req.url}`);
    next();
});

// ===============================
// TEST
// ===============================
app.get("/", (req, res) => {
    res.json({ success: true, message: "pa-service funcionando" });
});

// ===============================
// PAGOS
// ===============================
app.put("/api/pagos/:trabajoId/liberar", async (req, res) => {
    try {
        const { trabajoId } = req.params;

        if (!trabajoId) {
            return res.status(400).json({
                success: false,
                message: "trabajoId es requerido",
            });
        }

        const result = await pool.query(
            "UPDATE pagos SET estado = 'LIBERADO' WHERE trabajo_id = $1",
            [trabajoId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({
                success: false,
                message: "No se encontró un pago para este trabajo",
            });
        }

        res.json({
            success: true,
            message: "Pago liberado correctamente",
            trabajo_id: trabajoId,
        });
    } catch (error) {
        console.error("❌ Error liberando pago:", error.message);
        res.status(500).json({
            success: false,
            message: "Error al liberar pago",
        });
    }
});

// ===============================
// SETTINGS (MOCK)
// ===============================
app.get("/api/settings", (req, res) => {
    res.json({
        success: true,
        message: "API de Settings operativa",
    });
});

// -------- PASSWORD --------
app.post("/api/settings/password", async (req, res) => {
    try {
        const { current, next } = req.body;

        if (!current || !next) {
            return res.status(400).json({
                success: false,
                message: "Datos incompletos",
            });
        }

        if (current === "error") {
            return res.status(400).json({
                success: false,
                message: "La contraseña actual es incorrecta",
            });
        }

        res.json({
            success: true,
            message: "Contraseña actualizada correctamente",
        });
    } catch (err) {
        res.status(500).json({ success: false, message: "Error interno" });
    }
});

// -------- EMAIL --------
app.post("/api/settings/email/code", async (req, res) => {
    res.json({
        success: true,
        message: "Código enviado",
    });
});

app.post("/api/settings/email/verify", async (req, res) => {
    const { code, newEmail } = req.body;

    if (!code || !newEmail) {
        return res.status(400).json({
            success: false,
            message: "Datos incompletos",
        });
    }

    if (code !== "123456") {
        return res.status(400).json({
            success: false,
            message: "Código incorrecto",
        });
    }

    res.json({
        success: true,
        message: "Correo actualizado",
        email: newEmail,
    });
});

// -------- MÉTODOS DE PAGO --------
app.get("/api/settings/payments/:usuarioId", async (req, res) => {
    try {
        const { usuarioId } = req.params;
        const result = await pool.query(
            "SELECT * FROM metodos_pago WHERE usuario_id = $1 ORDER BY created_at DESC",
            [usuarioId]
        );
        res.json({
            success: true,
            data: result.rows,
        });
    } catch (error) {
        console.error("❌ Error obteniendo métodos de pago:", error.message);
        res.status(500).json({ success: false, message: "Error al obtener métodos de pago" });
    }
});

app.post("/api/settings/payments", async (req, res) => {
    try {
        console.log("📥 Recibiendo solicitud de pago:", req.body);
        const { usuario_id, card_number, holder_name, exp, cvv, brand } = req.body;

        if (!usuario_id || !card_number || !exp || !holder_name) {
            return res.status(400).json({
                success: false,
                message: "Datos incompletos",
            });
        }

        const calculatedBrand = brand || (card_number.startsWith("4") ? "visa" : "mastercard");
        const last4 = card_number.slice(-4);

        const result = await pool.query(
            "INSERT INTO metodos_pago (usuario_id, brand, holder_name, card_number, last4, exp, cvv, token) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *",
            [usuario_id, calculatedBrand, holder_name, card_number, last4, exp, cvv, 'tok_mock_' + Date.now()]
        );

        res.json({
            success: true,
            data: result.rows[0],
        });
    } catch (error) {
        console.error("❌ ERROR DETALLADO guardando método de pago:", error);
        res.status(500).json({ 
            success: false, 
            message: "Error al guardar método de pago",
            error: error.message 
        });
    }
});

app.delete("/api/settings/payments/:id", async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query("DELETE FROM metodos_pago WHERE id = $1", [id]);
        res.json({ success: true });
    } catch (error) {
        console.error("❌ Error eliminando método de pago:", error.message);
        res.status(500).json({ success: false, message: "Error al eliminar" });
    }
});

// -------- 2FA --------
app.get("/api/settings/twofa", async (req, res) => {
    res.json({
        success: true,
        data: { enabled: false, method: "sms" },
    });
});

app.post("/api/settings/twofa", async (req, res) => {
    res.json({ success: true });
});

// -------- SESIONES --------
app.get("/api/settings/sessions", async (req, res) => {
    res.json({
        success: true,
        data: [
            {
                id: 1,
                device: "Chrome / Windows 11",
                location: "Santo Domingo, DO",
                time: "Ahora mismo",
                current: true,
            },
        ],
    });
});

app.delete("/api/settings/sessions/:id", async (req, res) => {
    res.json({ success: true });
});

app.delete("/api/settings/sessions", async (req, res) => {
    res.json({ success: true });
});

// ===============================
// DESACTIVAR CUENTA
// ===============================
app.post("/api/settings/deactivate", async (req, res) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "userId requerido",
            });
        }

        const response = await fetch("http://localhost:3000/api/users/deactivate", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId }),
        });

        if (!response.ok) {
            throw new Error("Error en auth-service");
        }

        res.json({
            success: true,
            message: "Cuenta desactivada",
        });
    } catch (error) {
        console.error("❌ Error:", error.message);
        res.status(500).json({
            success: false,
            message: "Error al desactivar cuenta",
        });
    }
});

// ===============================
// ELIMINAR CUENTA
// ===============================
app.delete("/api/settings/account", async (req, res) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "userId requerido",
            });
        }

        // eliminar perfil
        try {
            await fetch(`http://localhost:3001/api/perfiles/usuario/${userId}`, {
                method: "DELETE",
            });
        } catch (err) {
            console.warn("⚠️ perfiles-service no respondió");
        }

        // eliminar usuario
        const response = await fetch(
            `http://localhost:3000/api/users/${userId}`,
            { method: "DELETE" }
        );

        if (!response.ok) {
            throw new Error("Error eliminando usuario");
        }

        res.json({
            success: true,
            message: "Cuenta eliminada completamente",
        });
    } catch (error) {
        console.error("❌ Error:", error.message);
        res.status(500).json({
            success: false,
            message: "Error eliminando cuenta",
        });
    }
});

// ===============================
// START SERVER
// ===============================
const PORT = process.env.PORT || 3002;

app.listen(PORT, async () => {
    console.log(`💰 pa-service corriendo en puerto ${PORT}`);
    await testDB();
});