import request from "supertest";
import { app } from "../src/server.js";
import { pool } from "../src/db.js";
import jwt from "jsonwebtoken";

describe("Auth Service - Pruebas de Seguridad (Security Testing)", () => {

    test("1. [Anti-Inyección SQL] Debe resistir ataques de Inyección SQL en el Login", async () => {
        const response = await request(app)
            .post("/api/login")
            .send({
                // Simulamos un atacante intentando saltarse la validación de la BD
                email: "admin@ejemplo.com' OR '1'='1",
                password: "' OR 1=1 --"
            });

        // La inyección no debe surtir efecto. Debe devolver 401.
        // NUNCA debe dar 500 (crashear la BD) ni 200 (dejarlo entrar).
        expect(response.statusCode).toBe(401);
        expect(response.body).toHaveProperty("message", "Credenciales inválidas");
    });

    test("2. [JWT Falsificado] Debe rechazar un Token inventado por un atacante", async () => {
        const fakeToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.datosFalsosParaAtacar.firmaFalsa123";
        
        const response = await request(app)
            .get("/api/users/me")
            .set("Authorization", `Bearer ${fakeToken}`);

        // El middleware debe atrapar que la firma no coincide con nuestro JWT_SECRET
        expect(response.statusCode).toBe(401);
        expect(response.body).toHaveProperty("message", "Token inválido o expirado");
    });

    test("3. [Time-Travel / Expiración] Debe rechazar Tokens auténticos pero que ya expiraron", async () => {
        // Generamos un token válido, con nuestra firma secreta, pero que expiró hace 10 horas
        const expiredToken = jwt.sign(
            { id: "uuid-aleatorio", email: "hacker@gmail.com", rol: "cliente" },
            process.env.JWT_SECRET || "mi_clave_secreta_super_segura",
            { expiresIn: "-10h" } // Expiración en negativo
        );

        const response = await request(app)
            .get("/api/users/sessions")
            .set("Authorization", `Bearer ${expiredToken}`);

        expect(response.statusCode).toBe(401);
        expect(response.body).toHaveProperty("message", "Token inválido o expirado");
    });

    afterAll(async () => {
        // Cerramos la conexión para que Jest termine limpio
        await pool.end();
    });
});
