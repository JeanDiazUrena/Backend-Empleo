import request from "supertest";
import { app } from "../src/server.js";
import { pool } from "../src/db.js";

describe("Auth Service - Login Unitario", () => {
    test("Debe iniciar sesión correctamente", async () => {
        // 1. Crear un usuario de prueba dinámico
        const testEmail = `test_${Date.now()}@gmail.com`;
        const testPassword = "password123";

        await request(app)
            .post("/api/register")
            .send({
                nombre: "Usuario Test Unitario",
                email: testEmail,
                password: testPassword,
                rol: "cliente"
            });

        // 2. Hacer login con ese usuario
        const response = await request(app)
            .post("/api/login")
            .send({
                email: testEmail,
                password: testPassword
            });

        // 3. Verificaciones
        expect(response.statusCode).toBe(200);
        expect(response.body).toHaveProperty("token");
        expect(response.body.user.email).toBe(testEmail);
    });

    afterAll(async () => {
        await pool.end();
    });
});
