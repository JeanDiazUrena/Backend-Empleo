import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import { pool, testDB } from "./db.js";
import jwt from "jsonwebtoken";
import http from "http";
import { Server } from "socket.io";
import { OAuth2Client } from "google-auth-library";

dotenv.config();

const app = express();
const server = http.createServer(app);

// CONFIGURACIÓN DE SOCKET.IO
const io = new Server(server, {
    cors: {
        origin: ["https://servihub-topaz.vercel.app", "http://localhost:4000"],
        credentials: true,
        methods: ["GET", "POST"]
    }
});

io.on("connection", (socket) => {
    console.log("🔌 Cliente conectado a Auth:", socket.id);
    const userId = socket.handshake.query.userId;
    if (userId) {
        socket.join(userId);
        console.log("👤 Usuario unido a su canal:", userId);
    }
    socket.on("disconnect", () => {
        console.log("❌ Cliente desconectado de Auth:", socket.id);
    });
});

app.use(cors({
    origin: ["https://servihub-topaz.vercel.app", "http://localhost:4000"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));
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

// 🔐 Función para generar JWT
const generarToken = (user) => {
    return jwt.sign(
        { id: user.id, email: user.email, rol: user.rol },
        process.env.JWT_SECRET,
        { expiresIn: "24h" }
    );
};

const registrarSesion = async (req, userId) => {
    try {
        await pool.query(
            `INSERT INTO sesiones (usuario_id, dispositivo, ip_address)
             VALUES ($1, $2, $3)`,
            [
                userId,
                req.headers["user-agent"] || "Navegador Web",
                req.ip || req.socket?.remoteAddress || null
            ]
        );
    } catch (error) {
        console.error("Error registrando sesión:", error.message);
    }
};

// --- REGISTRAR USUARIO ---
app.post("/api/register", async (req, res) => {
    const { nombre, email, password, rol } = req.body;
    if (!nombre || !email || !password || !rol) return res.status(400).json({ message: "Datos incompletos" });
    if (password.length < 8) return res.status(400).json({ message: "La contraseña debe tener al menos 8 caracteres" });
    if (!["cliente", "profesional"].includes(rol)) return res.status(400).json({ message: "Rol inválido" });

    try {
        const existe = await pool.query("SELECT id FROM usuarios WHERE email = $1", [email]);
        if (existe.rows.length > 0) return res.status(409).json({ message: "Email ya registrado" });

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = await pool.query(
            `INSERT INTO usuarios (nombre, email, password, rol, activo) VALUES ($1, $2, $3, $4, true) RETURNING id, nombre, email, rol`,
            [nombre, email, hashedPassword, rol]
        );
        res.status(201).json({ message: "Usuario creado correctamente", user: newUser.rows[0] });
    } catch (error) {
        console.error("Register error:", error);
        res.status(500).json({ message: "Error del servidor" });
    }
});

// --- LOGIN ---
app.post("/api/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: "Datos incompletos" });

    try {
        const result = await pool.query("SELECT * FROM usuarios WHERE email = $1 AND activo = true", [email]);
        if (result.rows.length === 0) return res.status(401).json({ message: "Credenciales inválidas" });

        const user = result.rows[0];
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(401).json({ message: "Credenciales inválidas" });

        const token = generarToken(user);
        await registrarSesion(req, user.id);

        // Notificar via Socket (Opcional)
        io.to(user.id).emit("login_success", { message: "Has iniciado sesión" });

        res.json({
            token,
            user: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol }
        });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ message: "Error del servidor" });
    }
});

// --- GOOGLE AUTH ---
app.post("/api/google", async (req, res) => {
    const { credential, rol } = req.body;
    if (!credential) return res.status(400).json({ message: "Token de Google requerido" });

    try {
        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        const email = payload.email;
        const name = payload.name;

        let result = await pool.query("SELECT * FROM usuarios WHERE email = $1 AND activo = true", [email]);
        let user = result.rows[0];

        if (!user) {
            if (!rol) return res.status(404).json({ message: "Cuenta no registrada. Regístrate primero." });
            const randomPassword = await bcrypt.hash(Math.random().toString(36), 10);
            const newUser = await pool.query(
                `INSERT INTO usuarios (nombre, email, password, rol, activo) VALUES ($1, $2, $3, $4, true) RETURNING *`,
                [name, email, randomPassword, rol]
            );
            user = newUser.rows[0];
        }

        const token = generarToken(user);
        await registrarSesion(req, user.id);
        res.json({
            token,
            user: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol }
        });
    } catch (error) {
        console.error("Google Auth Error:", error);
        res.status(500).json({ message: "Error con Google Auth", error: error.message });
    }
});

// --- OBTENER DATOS DEL USUARIO ACTUAL ---
app.get("/api/users/me", verificarToken, async (req, res) => {
    try {
        const result = await pool.query("SELECT id, nombre, email, rol, avatar_url FROM usuarios WHERE id = $1", [req.user.id]);
        if (result.rows.length === 0) return res.status(404).json({ message: "Usuario no encontrado" });
        res.json(result.rows[0]);
    } catch (error) { res.status(500).json({ message: "Error obteniendo datos" }); }
});

// --- SESIONES DEL USUARIO ---
app.get("/api/users/sessions", verificarToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, dispositivo, ip_address, last_active, created_at
             FROM sesiones
             WHERE usuario_id = $1
             ORDER BY created_at DESC`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (error) {
        console.error("Error obteniendo sesiones:", error);
        res.status(500).json({ message: "Error obteniendo sesiones" });
    }
});

app.delete("/api/users/sessions/:id", verificarToken, async (req, res) => {
    try {
        await pool.query(
            "DELETE FROM sesiones WHERE id = $1 AND usuario_id = $2",
            [req.params.id, req.user.id]
        );
        res.json({ success: true });
    } catch (error) {
        console.error("Error cerrando sesión:", error);
        res.status(500).json({ message: "Error cerrando sesión" });
    }
});

app.get("/", (req, res) => {
    res.send("🚀 Auth Service + Socket.IO funcionando en puerto 3000");
});

// --- START SERVER ---
const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'test') {
    server.listen(PORT, async () => {
        console.log(`🚀 Auth + Socket.IO corriendo en puerto ${PORT}`);
        await testDB();
    });
}
export { app, server };
