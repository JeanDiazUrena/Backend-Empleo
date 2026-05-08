const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const cors = require("cors");
const http = require("http");

require("dotenv").config();

const app = express();

const defaultOrigins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://frontendempleo.vercel.app",
    "https://servihub-topaz.vercel.app"
];

const configuredOrigins = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

const allowedOrigins = [...new Set([...defaultOrigins, ...configuredOrigins])];
const allowedVercelOriginPattern = /^https:\/\/servihub[-\w]*\.vercel\.app$/;

const corsOptions = {
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin) || allowedVercelOriginPattern.test(origin)) {
            return callback(null, true);
        }

        return callback(new Error(`Origen no permitido por CORS: ${origin}`));
    },
    credentials: true,
    optionsSuccessStatus: 204
};

app.use(cors(corsOptions));

const server = http.createServer(app);

// 🩺 Endpoint de Salud para UptimeRobot
app.get("/", (req, res) => res.send("🚀 ServiHub Gateway Online"));
app.get("/health", (req, res) => res.status(200).json({ status: "ok", service: "gateway" }));

// ================================
// SOCKET.IO PROXY (hacia Perfiles, donde vive el chat en tiempo real)
// ================================
const socketProxy = createProxyMiddleware({
    target: process.env.SOCKET_SERVICE_URL || process.env.PERFILES_SERVICE_URL || "http://127.0.0.1:3001",
    changeOrigin: true,
    ws: true,
    secure: false,
    logLevel: "debug",
    on: {
        error: (err, req, res) => {
            console.error("ERROR GATEWAY (Socket.IO):", err.message);
            if (res && typeof res.writeHead === "function" && !res.headersSent) {
                res.writeHead(502, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    error: "Socket Gateway Error",
                    details: "No se pudo conectar con el servicio de chat (Socket)"
                }));
            } else if (res && typeof res.end === "function") {
                res.end();
            }
        }
    }
});

app.use((req, res, next) => {
    if (req.path.startsWith("/socket.io")) {
        return socketProxy(req, res, next);
    }
    next();
});

// ================================
// MICROSERVICIOS
// ================================
const routes = {
    "/auth-service": process.env.AUTH_SERVICE_URL || "http://localhost:3000",
    "/perfiles-service": process.env.PERFILES_SERVICE_URL || "http://localhost:3010",
    "/pagos-service": process.env.PAGOS_SERVICE_URL || "http://localhost:3002",
    "/trabajos-service": process.env.TRABAJOS_SERVICE_URL || "http://localhost:3003",
    "/notificaciones-service": process.env.NOTIFICACIONES_SERVICE_URL || "http://localhost:3005"
};

for (const [path, target] of Object.entries(routes)) {
    app.use(path, createProxyMiddleware({
        target,
        changeOrigin: true,
        secure: false,
        xfwd: true,
        pathRewrite: {
            [`^${path}`]: ""
        },
        onError: (err, req, res) => {
            console.error(`ERROR GATEWAY (${path}):`, err.message);
            if (!res.headersSent) {
                res.status(502).json({
                    error: "Gateway Error",
                    details: `No se pudo conectar con el servicio en ${target}`
                });
            }
        }
    }));
}

app.get("/", (req, res) => {
    res.send("🚀 Gateway funcionando");
});

const PORT = Number(process.env.PORT) || 4000;

server.listen(PORT, () => {
    console.log(`🚀 Gateway en puerto ${PORT}`);
});

// Soporte para WebSockets (Socket.IO)
server.on("upgrade", (req, socket, head) => {
    if (req.url && req.url.startsWith("/socket.io")) {
        socketProxy.upgrade(req, socket, head);
    }
});
