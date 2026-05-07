import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use("/auth-service", createProxyMiddleware({
    target: "http://localhost:3000",
    changeOrigin: true,
    pathRewrite: { "^/auth-service": "" },
}));

app.use("/perfiles-service", createProxyMiddleware({
    target: "http://localhost:3001",
    changeOrigin: true,
    pathRewrite: { "^/perfiles-service": "" },
    ws: true,
}));

app.use("/pagos-service", createProxyMiddleware({
    target: "http://localhost:3002",
    changeOrigin: true,
    pathRewrite: { "^/pagos-service": "" },
}));

app.use("/trabajos-service", createProxyMiddleware({
    target: "http://localhost:3003",
    changeOrigin: true,
    pathRewrite: { "^/trabajos-service": "" },
}));

app.use("/notificaciones-service", createProxyMiddleware({
    target: "http://localhost:3005",
    changeOrigin: true,
    pathRewrite: { "^/notificaciones-service": "" },
}));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`Gateway corriendo en puerto ${PORT}`);
});