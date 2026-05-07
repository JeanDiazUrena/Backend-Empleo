import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import { pool, testDB } from "./db.js";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// 🔐 Middleware para verificar JWT
const verificarToken = (req, res, next) => {
    const token = req.headers["authorization"]?.split(" ")[1];
    if (!token) return res.status(403).json({ message: "Token requerido" });

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) return res.status(401).json({ message: "Token inválido o expirado" });
        req.user = decoded;
        next();
    });
};

// 🔐 Función para generar JWT (reutilizable)
const generarToken = (user) => {
    return jwt.sign(
        { id: user.id, email: user.email, rol: user.rol },
        process.env.JWT_SECRET,
        { expiresIn: "24h" } // Aumentamos a 24h para mejor UX
    );
};

// --- REGISTRAR USUARIO ---
app.post("/api/register", async (req, res) => {
    const { nombre, email, password, rol } = req.body;

    if (!nombre || !email || !password || !rol) {
        return res.status(400).json({ message: "Datos incompletos" });
    }

    if (password.length < 8) {
        return res.status(400).json({ message: "La contraseña debe tener al menos 8 caracteres" });
    }

    if (!["cliente", "profesional"].includes(rol)) {
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

        const newUser = await pool.query(
            `INSERT INTO usuarios (nombre, email, password, rol, activo)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id, nombre, email, rol`,
            [nombre, email, hashedPassword, rol]
        );

        res.status(201).json({
            message: "Usuario creado correctamente",
            user: newUser.rows[0],
        });

    } catch (error) {
        console.error("Register error:", error);
        res.status(500).json({ message: "Error del servidor" });
    }
});

// --- LOGIN ---
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

        const token = generarToken(user);

        // 📝 Registrar Sesión
        const ua = req.headers["user-agent"] || "Desconocido";
        const ip = req.ip || req.connection.remoteAddress || "0.0.0.0";
        await pool.query(
            "INSERT INTO sesiones (usuario_id, dispositivo, ip_address) VALUES ($1, $2, $3)",
            [user.id, ua, ip]
        );

        res.json({
            token,
            user: {
                id: user.id,
                nombre: user.nombre,
                email: user.email,
                rol: user.rol,
            },
        });

    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ message: "Error del servidor" });
    }
});

// --- GOOGLE AUTH ---
app.post("/api/google", async (req, res) => {
    const { credential, rol } = req.body;

    if (!credential) {
        return res.status(400).json({ message: "Token de Google requerido" });
    }

    try {
        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: process.env.GOOGLE_CLIENT_ID,
        });

        const payload = ticket.getPayload();
        const email = payload.email;
        const name = payload.name;

        let result = await pool.query(
            "SELECT * FROM usuarios WHERE email = $1 AND activo = true",
            [email]
        );

        let user = result.rows[0];

        // 🔥 Si no existe → registrar
        if (!user) {
            if (!rol) {
                return res.status(404).json({
                    message: "Cuenta no registrada. Regístrate primero.",
                });
            }

            if (!["cliente", "profesional"].includes(rol)) {
                return res.status(400).json({ message: "Rol inválido" });
            }

            const randomPassword = await bcrypt.hash(
                Math.random().toString(36),
                10
            );

            const newUser = await pool.query(
                `INSERT INTO usuarios (nombre, email, password, rol, activo)
         VALUES ($1, $2, $3, $4, true)
         RETURNING *`,
                [name, email, randomPassword, rol]
            );

            user = newUser.rows[0];
        }

        const token = generarToken(user);

        // 📝 Registrar Sesión (Google)
        const ua = req.headers["user-agent"] || "Desconocido (Google)";
        const ip = req.ip || req.connection.remoteAddress || "0.0.0.0";
        await pool.query(
            "INSERT INTO sesiones (usuario_id, dispositivo, ip_address) VALUES ($1, $2, $3)",
            [user.id, ua, ip]
        );

        res.json({
            token,
            user: {
                id: user.id,
                nombre: user.nombre,
                email: user.email,
                rol: user.rol,
            },
        });

    } catch (error) {
        console.error("Google Auth Error:", error);
        res.status(500).json({ 
            success: false, 
            message: "Error con Google Auth", 
            error: error.message 
        });
    }
});

// --- DESACTIVAR USUARIO ---
app.put("/api/users/deactivate", async (req, res) => {
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({ message: "ID requerido" });
    }

    try {
        await pool.query(
            "UPDATE usuarios SET activo = false WHERE id = $1",
            [userId]
        );

        res.json({ message: "Usuario desactivado" });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error del servidor" });
    }
});

// --- OBTENER SESIONES ACTIVAS ---
app.get("/api/users/sessions", verificarToken, async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT id, dispositivo, ip_address, created_at FROM sesiones WHERE usuario_id = $1 ORDER BY created_at DESC LIMIT 10",
            [req.user.id]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ message: "Error obteniendo sesiones" });
    }
});

// --- CERRAR SESIÓN (Eliminar de DB) ---
app.delete("/api/users/sessions/:id", verificarToken, async (req, res) => {
    try {
        await pool.query("DELETE FROM sesiones WHERE id = $1 AND usuario_id = $2", [req.params.id, req.user.id]);
        res.json({ message: "Sesión cerrada" });
    } catch (error) {
        res.status(500).json({ message: "Error al cerrar sesión" });
    }
});

// --- CAMBIAR CONTRASEÑA ---
app.post("/api/users/change-password", verificarToken, async (req, res) => {
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
        return res.status(400).json({ message: "Datos incompletos" });
    }

    if (newPassword.length < 8) {
        return res.status(400).json({ message: "La nueva contraseña debe tener al menos 8 caracteres" });
    }

    try {
        const result = await pool.query("SELECT password FROM usuarios WHERE id = $1", [req.user.id]);
        const user = result.rows[0];

        const valid = await bcrypt.compare(oldPassword, user.password);
        if (!valid) {
            return res.status(401).json({ message: "Contraseña actual incorrecta" });
        }

        const hashed = await bcrypt.hash(newPassword, 10);
        await pool.query("UPDATE usuarios SET password = $1 WHERE id = $2", [hashed, req.user.id]);

        res.json({ message: "Contraseña actualizada correctamente" });
    } catch (error) {
        res.status(500).json({ message: "Error al cambiar contraseña" });
    }
});

// --- OBTENER DATOS DEL USUARIO ACTUAL ---
app.get("/api/users/me", verificarToken, async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT id, nombre, email, rol, avatar_url FROM usuarios WHERE id = $1",
            [req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ message: "Usuario no encontrado" });
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ message: "Error obteniendo datos" });
    }
});

// --- CAMBIAR EMAIL ---
app.post("/api/users/change-email", verificarToken, async (req, res) => {
    const { newEmail } = req.body;
    if (!newEmail) return res.status(400).json({ message: "Email requerido" });

    try {
        // Verificar si el email ya existe
        const existe = await pool.query("SELECT id FROM usuarios WHERE email = $1", [newEmail]);
        if (existe.rows.length > 0) return res.status(409).json({ message: "El email ya está en uso" });

        await pool.query("UPDATE usuarios SET email = $1 WHERE id = $2", [newEmail, req.user.id]);
        res.json({ message: "Email actualizado correctamente" });
    } catch (error) {
        res.status(500).json({ message: "Error al cambiar email" });
    }
});

// --- ELIMINAR USUARIO ---
app.delete("/api/users/:id", verificarToken, async (req, res) => {
    const { id } = req.params;
    if (req.user.id !== id) return res.status(403).json({ message: "No autorizado" });

    try {
        await pool.query("DELETE FROM usuarios WHERE id = $1", [id]);

        res.json({ message: "Usuario eliminado" });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error del servidor" });
    }
});

// --- START SERVER ---
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
    console.log(` Auth corriendo en puerto ${PORT}`);
    await testDB();
});