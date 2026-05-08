const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const cors = require("cors");
const http = require("http");

require("dotenv").config();

const app = express();

const defaultOrigins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://frontendempleo.vercel.app"
];

const configuredOrigins = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

const allowedOrigins = [...new Set([...defaultOrigins, ...configuredOrigins])];

app.use(cors({
    origin: allowedOrigins,
    credentials: true
}));

const server = http.createServer(app);

// ================================
// SOCKET.IO PROXY (Hacia Perfiles Service que es el principal para Chat)
// ================================
const socketProxy = createProxyMiddleware({
    target: process.env.PERFILES_SERVICE_URL || "http://127.0.0.1:3010",
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
                    details: "No se pudo conectar con perfile-service en el puerto 3010"
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
        pathRewrite: {
            [`^${path}`]: ""
        },
        onError: (err, req, res) => {
            console.error(`ERROR GATEWAY (${path}):`, err.message);
            res.status(500).json({
                error: "Gateway Error",
                details: err.message
            });
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
