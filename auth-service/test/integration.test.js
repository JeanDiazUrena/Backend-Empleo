import request from "supertest";
import { app } from "../src/server.js";
import { pool } from "../src/db.js";

describe("Auth Service - Pruebas de Integración", () => {
    let testEmail = `integration_${Date.now()}@gmail.com`;
    let testPassword = "securepassword123";
    let authToken = "";

    test("1. Debería registrar un nuevo usuario", async () => {
        const response = await request(app)
            .post("/api/register")
            .send({ nombre: "User", email: testEmail, password: testPassword, rol: "profesional" });
        expect(response.statusCode).toBe(201);
    });

    test("2. Debería hacer login y generar token", async () => {
        const response = await request(app)
            .post("/api/login")
            .send({ email: testEmail, password: testPassword });
        expect(response.statusCode).toBe(200);
        authToken = response.body.token;
    });

    test("3. Debería acceder a ruta protegida con token", async () => {
        const response = await request(app)
            .get("/api/users/me")
            .set("Authorization", `Bearer ${authToken}`);
        expect(response.statusCode).toBe(200);
    });

    test("4. Debería devolver 403 sin token", async () => {
        const response = await request(app).get("/api/users/me");
        expect(response.statusCode).toBe(403);
    });

    afterAll(async () => {
        try { await pool.query("DELETE FROM usuarios WHERE email = $1", [testEmail]); } catch(e){}
        await pool.end();
    });
});
