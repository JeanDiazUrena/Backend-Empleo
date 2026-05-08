import request from "supertest";
import { app } from "../src/server.js";
import { pool } from "../src/db.js";

describe("Auth Service - Pruebas de Aceptación", () => {
    const testEmail = `accept_${Date.now()}@gmail.com`;

    test("1. No debe permitir el registro sin datos completos", async () => {
        const response = await request(app).post("/api/register").send({ email: testEmail, password: "password123" });
        expect(response.statusCode).toBe(400);
    });

    test("2. No debe permitir contraseñas inseguras (< 8 caracteres)", async () => {
        const response = await request(app).post("/api/register").send({
            nombre: "Short", email: `fail_${Date.now()}@gmail.com`, password: "123", rol: "cliente"
        });
        expect(response.statusCode).toBe(400);
    });

    test("3. No debe permitir registrar un email duplicado", async () => {
        await request(app).post("/api/register").send({
            nombre: "Original", email: testEmail, password: "password123!", rol: "cliente"
        });
        const dupResponse = await request(app).post("/api/register").send({
            nombre: "Clon", email: testEmail, password: "password123!", rol: "cliente"
        });
        expect(dupResponse.statusCode).toBe(409);
    });

    test("4. Debe bloquear inicio de sesión con contraseña incorrecta", async () => {
        const response = await request(app).post("/api/login").send({
            email: testEmail, password: "WrongPassword99"
        });
        expect(response.statusCode).toBe(401);
    });

    afterAll(async () => {
        try { await pool.query("DELETE FROM usuarios WHERE email = $1", [testEmail]); } catch (e) {}
        await pool.end();
    });
});
