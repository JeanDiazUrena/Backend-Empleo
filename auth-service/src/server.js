import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import { pool, testDB } from "./db.js";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";

dotenv.config();

const app = express();

// 🔥 IMPORTANTE PARA DEPLOY (Render / proxies)
app.set("trust proxy", 1);

app.use(cors());
app.use(express.json());

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// -------------------- JWT --------------------
const generarToken = (user) => {
    return jwt.sign(
        { id: user.id, email: user.email, rol: user.rol },
        process.env.JWT_SECRET,
        { expiresIn: "24h" }
    );
};

// -------------------- MIDDLEWARE JWT --------------------
const verificarToken = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(403).json({ message: "Token requerido" });
    }

    const token = authHeader.split(" ")[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ message: "Token inválido o expirado" });
    }
};

// ======================================================
// 🔐 REGISTRO
// ======================================================
app.post("/api/register", async (req, res) => {
    console.log("POST /api/register - Body:", req.body);
    const { nombre, email, password, rol } = req.body;

    if (!nombre?.trim() || !email?.trim() || !password?.trim() || !rol) {
        console.log("Registro fallido: Datos incompletos");
        return res.status(400).json({ message: "Datos incompletos" });
    }

    if (password.length < 8) {
        return res.status(400).json({ message: "Mínimo 8 caracteres" });
    }

    if (!["cliente", "profesional"].includes(rol)) {
        return res.status(400).json({ message: "Rol inválido" });
    }

    try {
        console.log("1. Buscando si existe email:", email);
        const existe = await pool.query(
            "SELECT id FROM usuarios WHERE email = $1",
            [email]
        );

        if (existe.rows.length > 0) {
            console.log("Registro fallido: Email ya existe");
            return res.status(409).json({ message: "Email ya registrado" });
        }

        console.log("2. Hasheando password...");
        const hashedPassword = await bcrypt.hash(password, 10);

        console.log("3. Insertando usuario...");
        const newUser = await pool.query(
            `INSERT INTO usuarios (nombre, email, password, rol, activo)
             VALUES ($1, $2, $3, $4, true)
             RETURNING id, nombre, email, rol`,
            [nombre, email, hashedPassword, rol]
        );

        console.log("4. Registro exitoso:", newUser.rows[0].id);
        res.status(201).json({
            message: "Usuario creado",
            user: newUser.rows[0],
        });

    } catch (error) {
        console.error("❌ ERROR CRÍTICO EN REGISTER:", error);
        res.status(500).json({ message: "Error servidor" });
    }
});

// ======================================================
// 🔐 LOGIN
// ======================================================
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

        const user = result.rows[0];

        if (!user || !user.password) {
            return res.status(401).json({ message: "Credenciales inválidas" });
        }

        const valid = await bcrypt.compare(password, user.password);

        if (!valid) {
            return res.status(401).json({ message: "Credenciales inválidas" });
        }

        const token = generarToken(user);

        await pool.query(
            "INSERT INTO sesiones (usuario_id, dispositivo, ip_address) VALUES ($1, $2, $3)",
            [user.id, req.headers["user-agent"] || "Desconocido", req.ip]
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
        console.error(error);
        res.status(500).json({ message: "Error servidor" });
    }
});

// ======================================================
// 🔐 GOOGLE AUTH
// ======================================================
app.post("/api/google", async (req, res) => {
    const { credential, rol } = req.body;

    if (!credential) {
        return res.status(400).json({ message: "Token Google requerido" });
    }

    try {
        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: process.env.GOOGLE_CLIENT_ID,
        });

        const payload = ticket.getPayload();
        const email = payload.email;
        const name = payload.name;

        let user;

        await pool.query("BEGIN");

        const check = await pool.query(
            "SELECT * FROM usuarios WHERE email = $1 FOR UPDATE",
            [email]
        );

        user = check.rows[0];

        if (!user) {
            if (!rol) {
                await pool.query("ROLLBACK");
                return res.status(400).json({
                    message: "Rol requerido para registro",
                });
            }

            const randomPassword = await bcrypt.hash(
                Math.random().toString(36),
                10
            );

            const created = await pool.query(
                `INSERT INTO usuarios (nombre, email, password, rol, activo)
                 VALUES ($1, $2, $3, $4, true)
                 RETURNING *`,
                [name, email, randomPassword, rol]
            );

            user = created.rows[0];
        }

        await pool.query("COMMIT");

        const token = generarToken(user);

        await pool.query(
            "INSERT INTO sesiones (usuario_id, dispositivo, ip_address) VALUES ($1, $2, $3)",
            [user.id, req.headers["user-agent"], req.ip]
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
        await pool.query("ROLLBACK");
        console.error(error);
        res.status(500).json({ message: "Error Google Auth" });
    }
});

// ======================================================
// 👤 OBTENER USUARIO ACTUAL
// ======================================================
app.get("/api/users/me", verificarToken, async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT id, nombre, email, rol FROM usuarios WHERE id = $1",
            [req.user.id]
        );

        if (!result.rows[0]) {
            return res.status(404).json({ message: "Usuario no encontrado" });
        }

        res.json(result.rows[0]);

    } catch (error) {
        res.status(500).json({ message: "Error servidor" });
    }
});

// ======================================================
// 🔑 CAMBIAR PASSWORD
// ======================================================
app.post("/api/users/change-password", verificarToken, async (req, res) => {
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
        return res.status(400).json({ message: "Datos incompletos" });
    }

    if (newPassword.length < 8) {
        return res.status(400).json({ message: "Mínimo 8 caracteres" });
    }

    try {
        const result = await pool.query(
            "SELECT password FROM usuarios WHERE id = $1",
            [req.user.id]
        );

        const user = result.rows[0];

        if (!user) {
            return res.status(404).json({ message: "Usuario no existe" });
        }

        const valid = await bcrypt.compare(oldPassword, user.password);

        if (!valid) {
            return res.status(401).json({ message: "Contraseña incorrecta" });
        }

        const hashed = await bcrypt.hash(newPassword, 10);

        await pool.query(
            "UPDATE usuarios SET password = $1 WHERE id = $2",
            [hashed, req.user.id]
        );

        res.json({ message: "Contraseña actualizada" });

    } catch (error) {
        res.status(500).json({ message: "Error servidor" });
    }
});

// ======================================================
// 📧 CAMBIAR EMAIL
// ======================================================
app.post("/api/users/change-email", verificarToken, async (req, res) => {
    const { newEmail } = req.body;

    if (!newEmail) {
        return res.status(400).json({ message: "Email requerido" });
    }

    try {
        const existe = await pool.query(
            "SELECT id FROM usuarios WHERE email = $1 AND id != $2",
            [newEmail, req.user.id]
        );

        if (existe.rows.length > 0) {
            return res.status(409).json({ message: "Email en uso" });
        }

        await pool.query(
            "UPDATE usuarios SET email = $1 WHERE id = $2",
            [newEmail, req.user.id]
        );

        res.json({ message: "Email actualizado" });

    } catch (error) {
        res.status(500).json({ message: "Error servidor" });
    }
});

// ======================================================
// ❌ ELIMINAR USUARIO
// ======================================================
app.delete("/api/users/:id", verificarToken, async (req, res) => {
    const { id } = req.params;

    if (Number(req.user.id) !== Number(id)) {
        return res.status(403).json({ message: "No autorizado" });
    }

    try {
        await pool.query("DELETE FROM usuarios WHERE id = $1", [id]);

        res.json({ message: "Usuario eliminado" });

    } catch (error) {
        res.status(500).json({ message: "Error servidor" });
    }
});

// ======================================================
// 📡 SESIONES
// ======================================================
app.get("/api/users/sessions", verificarToken, async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT id, dispositivo, ip_address, created_at FROM sesiones WHERE usuario_id = $1 ORDER BY created_at DESC",
            [req.user.id]
        );

        res.json(result.rows);

    } catch (error) {
        res.status(500).json({ message: "Error sesiones" });
    }
});

app.delete("/api/users/sessions/:id", verificarToken, async (req, res) => {
    try {
        await pool.query(
            "DELETE FROM sesiones WHERE id = $1 AND usuario_id = $2",
            [req.params.id, req.user.id]
        );

        res.json({ message: "Sesión cerrada" });

    } catch (error) {
        res.status(500).json({ message: "Error servidor" });
    }
});

// ======================================================
// 🚀 START SERVER
// ======================================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
    console.log(`🚀 Auth service corriendo en puerto ${PORT}`);
    await testDB();
});

// ======================================================
// ❌ ERROR HANDLER GLOBAL
// ======================================================
app.use((err, req, res, next) => {
    console.error("🔥 ERROR GLOBAL:", err);
    res.status(500).json({ message: "Error interno servidor", error: err.message });
});