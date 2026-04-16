import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

export const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
});

export const testDB = async () => {
    try {
        const res = await pool.query("SELECT NOW()");
        console.log(" DB conectada:", res.rows[0]);
    } catch (err) {
        console.error(" Error DB:", err.message);
    }
};
