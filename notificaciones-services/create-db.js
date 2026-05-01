import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: "postgres",
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
});

async function createDatabase() {
    try {
        const res = await pool.query(`SELECT 1 FROM pg_database WHERE datname = '${process.env.DB_NAME}'`);
        if (res.rowCount === 0) {
            console.log(`Creando base de datos ${process.env.DB_NAME}...`);
            await pool.query(`CREATE DATABASE ${process.env.DB_NAME}`);
            console.log("Base de datos creada exitosamente.");
        } else {
            console.log(`La base de datos ${process.env.DB_NAME} ya existe.`);
        }
    } catch (err) {
        console.error("Error al crear la base de datos:", err.message);
    } finally {
        await pool.end();
    }
}

createDatabase();
