import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import { pool, testDB } from "./db.js";
import jwt from "jsonwebtoken";
import http from "http";
import { Server } from "socket.io";
import { OAuth2Client } from "google-auth-library";
import nodemailer from "nodemailer";
import crypto from "crypto";
import dns from "dns";

dotenv.config();
dns.setDefaultResultOrder("ipv4first");

const app = express();
const server = http.createServer(app);

// CONFIGURACIÓN DE SOCKET.IO
const io = new Server(server, {
    cors: {
        origin: "*",
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

app.use(cors());
app.use(express.json());

// 🩺 Endpoint de Salud para UptimeRobot
app.get("/", (req, res) => res.send("🚀 Auth Service Online"));
app.get("/health", (req, res) => res.status(200).json({ status: "ok", service: "auth-service" }));

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

const CODE_TTL_MINUTES = 10;
const MAX_CODE_ATTEMPTS = 5;

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();
const isGmailEmail = (email) => /^[a-z0-9._%+-]+@(gmail\.com|googlemail\.com)$/i.test(email);

const createVerificationCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, "0");

const getMailTransport = () => {
    const host = process.env.SMTP_HOST || "smtp.gmail.com";
    const port = Number(process.env.SMTP_PORT || 465);
    const secure = String(process.env.SMTP_SECURE || "true") === "true";
    const family = Number(process.env.SMTP_FAMILY || 4);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!user || !pass) {
        throw new Error("SMTP_NOT_CONFIGURED");
    }

    return nodemailer.createTransport({
        host,
        port,
        secure,
        family,
        requireTLS: !secure,
        connectionTimeout: 60000,
        greetingTimeout: 30000,
        socketTimeout: 60000,
        auth: { user, pass }
    });
};

const getMailSubject = (purpose) =>
    purpose === "password_reset"
        ? "Codigo para recuperar tu cuenta ServiHub"
        : "Verifica tu correo en ServiHub";

const getMailFrom = () => process.env.MAIL_FROM || `"ServiHub" <${process.env.SMTP_USER || "no-reply@servihub.com"}>`;

const buildEmailTemplate = ({ code, purpose, nombre }) => {
    const title = purpose === "password_reset" ? "Recupera tu acceso" : "Confirma tu correo";
    const intro = purpose === "password_reset"
        ? "Recibimos una solicitud para cambiar tu contrasena. Usa este codigo para continuar."
        : "Para crear tu cuenta en ServiHub, confirma que este Gmail te pertenece con el siguiente codigo.";

    return `
      <div style="margin:0;padding:0;background:#f4f7fb;font-family:Inter,Segoe UI,Arial,sans-serif;color:#122033;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7fb;padding:32px 12px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:22px;overflow:hidden;border:1px solid #e3ebf5;box-shadow:0 18px 45px rgba(15,35,52,.12);">
                <tr>
                  <td style="background:#0b4c6f;padding:28px 32px;color:white;">
                    <div style="font-size:24px;font-weight:800;letter-spacing:.2px;">ServiHub</div>
                    <div style="font-size:14px;opacity:.86;margin-top:6px;">Servicios confiables, cuentas protegidas.</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:34px 32px 28px;">
                    <h1 style="margin:0 0 12px;font-size:26px;line-height:1.2;color:#0f172a;">${title}</h1>
                    <p style="margin:0 0 22px;font-size:15px;line-height:1.65;color:#526173;">Hola${nombre ? `, ${nombre}` : ""}. ${intro}</p>
                    <div style="background:#f8fbff;border:1px solid #dbe8f4;border-radius:18px;padding:22px;text-align:center;margin:20px 0;">
                      <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#64748b;margin-bottom:10px;">Tu codigo</div>
                      <div style="font-size:38px;letter-spacing:10px;font-weight:900;color:#0b4c6f;">${code}</div>
                    </div>
                    <p style="margin:20px 0 0;font-size:14px;line-height:1.6;color:#64748b;">Este codigo vence en ${CODE_TTL_MINUTES} minutos. Si no fuiste tu, puedes ignorar este correo.</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:18px 32px;background:#f8fafc;border-top:1px solid #edf2f7;color:#8a98aa;font-size:12px;line-height:1.5;">
                    ServiHub nunca te pedira tu contrasena por correo.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </div>
    `;
};

const sendCodeEmailWithResend = async ({ email, code, purpose, nombre }) => {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error("RESEND_NOT_CONFIGURED");

    const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            from: getMailFrom(),
            to: [email],
            subject: getMailSubject(purpose),
            text: `Tu codigo de ServiHub es ${code}. Vence en ${CODE_TTL_MINUTES} minutos.`,
            html: buildEmailTemplate({ code, purpose, nombre })
        })
    });

    if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        const error = new Error("RESEND_SEND_FAILED");
        error.status = response.status;
        error.body = errorBody;
        throw error;
    }
};

const sendCodeEmailWithSmtp = async ({ email, code, purpose, nombre }) => {
    const transporter = getMailTransport();

    await transporter.sendMail({
        from: getMailFrom(),
        to: email,
        subject: getMailSubject(purpose),
        text: `Tu codigo de ServiHub es ${code}. Vence en ${CODE_TTL_MINUTES} minutos.`,
        html: buildEmailTemplate({ code, purpose, nombre })
    });
};

const sendCodeEmail = async ({ email, code, purpose, nombre }) => {
    if (process.env.RESEND_API_KEY) {
        return sendCodeEmailWithResend({ email, code, purpose, nombre });
    }

    return sendCodeEmailWithSmtp({ email, code, purpose, nombre });
};

const issueEmailCode = async ({ email, purpose, nombre }) => {
    const code = createVerificationCode();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

    await pool.query(
        `UPDATE email_verification_codes
         SET consumed_at = NOW()
         WHERE email = $1 AND purpose = $2 AND consumed_at IS NULL`,
        [email, purpose]
    );

    await pool.query(
        `INSERT INTO email_verification_codes (email, purpose, code_hash, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [email, purpose, codeHash, expiresAt]
    );

    await sendCodeEmail({ email, code, purpose, nombre });
};

const verifyEmailCode = async ({ email, purpose, code }) => {
    const cleanCode = String(code || "").trim();
    if (!/^\d{6}$/.test(cleanCode)) {
        return { ok: false, message: "Ingresa el codigo de 6 digitos." };
    }

    const result = await pool.query(
        `SELECT *
         FROM email_verification_codes
         WHERE email = $1 AND purpose = $2 AND consumed_at IS NULL
         ORDER BY created_at DESC
         LIMIT 1`,
        [email, purpose]
    );

    if (result.rows.length === 0) {
        return { ok: false, message: "Primero solicita un codigo de verificacion." };
    }

    const record = result.rows[0];
    if (new Date(record.expires_at).getTime() < Date.now()) {
        await pool.query("UPDATE email_verification_codes SET consumed_at = NOW() WHERE id = $1", [record.id]);
        return { ok: false, message: "El codigo caduco. Solicita uno nuevo." };
    }

    if (Number(record.attempts || 0) >= MAX_CODE_ATTEMPTS) {
        await pool.query("UPDATE email_verification_codes SET consumed_at = NOW() WHERE id = $1", [record.id]);
        return { ok: false, message: "Demasiados intentos. Solicita un codigo nuevo." };
    }

    const valid = await bcrypt.compare(cleanCode, record.code_hash);
    if (!valid) {
        await pool.query("UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = $1", [record.id]);
        return { ok: false, message: "Codigo incorrecto." };
    }

    await pool.query("UPDATE email_verification_codes SET consumed_at = NOW() WHERE id = $1", [record.id]);
    return { ok: true };
};

const handleMailError = (error, res) => {
    console.error("Email error:", error);
    if (error.message === "RESEND_NOT_CONFIGURED") {
        return res.status(503).json({
            message: "El envio de correos por API no esta configurado. Configura RESEND_API_KEY en Render."
        });
    }
    if (error.message === "RESEND_SEND_FAILED") {
        console.error("Resend response:", error.status, error.body);
        return res.status(502).json({
            message: "El proveedor de correo rechazo el envio. Revisa RESEND_API_KEY y MAIL_FROM."
        });
    }
    if (error.message === "SMTP_NOT_CONFIGURED") {
        return res.status(503).json({
            message: "El envio de correos no esta configurado. Configura SMTP_USER y SMTP_PASS en Render."
        });
    }
    if (error.code === "ETIMEDOUT" || error.code === "ESOCKET") {
        return res.status(503).json({
            message: "Render no pudo conectar con SMTP. Configura RESEND_API_KEY para enviar correos por API."
        });
    }
    return res.status(500).json({ message: "No se pudo enviar el correo. Intenta mas tarde." });
};

// --- REGISTRAR USUARIO ---
app.post("/api/register/request-code", async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const nombre = String(req.body.nombre || "").trim();

    if (!email) return res.status(400).json({ message: "Ingresa tu correo." });
    if (!isGmailEmail(email)) return res.status(400).json({ message: "Debes usar una cuenta de Gmail valida." });

    try {
        const existe = await pool.query("SELECT id FROM usuarios WHERE email = $1", [email]);
        if (existe.rows.length > 0) return res.status(409).json({ message: "Email ya registrado" });

        await issueEmailCode({ email, purpose: "register", nombre });
        res.json({ message: "Te enviamos un codigo a tu Gmail. Revisa tu bandeja de entrada." });
    } catch (error) {
        return handleMailError(error, res);
    }
});

app.post("/api/register", async (req, res) => {
    const { nombre, password, rol, verification_code } = req.body;
    const email = normalizeEmail(req.body.email);
    if (!nombre || !email || !password || !rol) return res.status(400).json({ message: "Datos incompletos" });
    if (!isGmailEmail(email)) return res.status(400).json({ message: "Debes usar una cuenta de Gmail valida." });
    if (password.length < 8) return res.status(400).json({ message: "La contraseña debe tener al menos 8 caracteres" });
    if (!["cliente", "profesional"].includes(rol)) return res.status(400).json({ message: "Rol inválido" });

    try {
        const existe = await pool.query("SELECT id FROM usuarios WHERE email = $1", [email]);
        if (existe.rows.length > 0) return res.status(409).json({ message: "Email ya registrado" });

        const codeCheck = await verifyEmailCode({ email, purpose: "register", code: verification_code });
        if (!codeCheck.ok) return res.status(400).json({ message: codeCheck.message });

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

// --- RECUPERACION DE CONTRASENA ---
app.post("/api/password/forgot-code", async (req, res) => {
    const email = normalizeEmail(req.body.email);
    if (!email) return res.status(400).json({ message: "Ingresa tu correo." });
    if (!isGmailEmail(email)) return res.status(400).json({ message: "Debes usar una cuenta de Gmail valida." });

    try {
        const result = await pool.query("SELECT nombre FROM usuarios WHERE email = $1 AND activo = true", [email]);
        if (result.rows.length === 0) return res.status(404).json({ message: "No encontramos una cuenta activa con ese Gmail." });

        await issueEmailCode({ email, purpose: "password_reset", nombre: result.rows[0].nombre });
        res.json({ message: "Te enviamos un codigo para recuperar tu contrasena." });
    } catch (error) {
        return handleMailError(error, res);
    }
});

app.post("/api/password/reset", async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const { code, password } = req.body;

    if (!email || !code || !password) return res.status(400).json({ message: "Datos incompletos" });
    if (!isGmailEmail(email)) return res.status(400).json({ message: "Debes usar una cuenta de Gmail valida." });
    if (password.length < 8) return res.status(400).json({ message: "La contraseña debe tener al menos 8 caracteres" });

    try {
        const existe = await pool.query("SELECT id FROM usuarios WHERE email = $1 AND activo = true", [email]);
        if (existe.rows.length === 0) return res.status(404).json({ message: "No encontramos una cuenta activa con ese Gmail." });

        const codeCheck = await verifyEmailCode({ email, purpose: "password_reset", code });
        if (!codeCheck.ok) return res.status(400).json({ message: codeCheck.message });

        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query("UPDATE usuarios SET password = $1, updated_at = NOW() WHERE email = $2", [hashedPassword, email]);
        res.json({ message: "Contrasena actualizada correctamente." });
    } catch (error) {
        console.error("Password reset error:", error);
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
