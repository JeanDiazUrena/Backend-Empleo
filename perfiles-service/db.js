import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pkg;

export const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT),
});

pool.query("SELECT NOW()", (err, res) => {
  if (err) {
    console.error(" Error conectando a perfiles_db:", err);
  } else {
    console.log(" perfiles_db conectado:", res.rows[0]);
  }
});
