import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pkg;

export const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: String(process.env.DB_PASSWORD),

  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

export const testDB = async () => {
  try {
    const res = await pool.query("SELECT NOW()");
    console.log("✅ DB conectada (perfiles):", res.rows[0]);
  } catch (err) {
    console.error("❌ Error DB perfiles:", err.message);
  }
};
