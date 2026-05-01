const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

async function check() {
  try {
    const res = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'notificaciones'");
    console.log('ESTRUCTURA DE TABLA:');
    console.log(JSON.stringify(res.rows, null, 2));

    const data = await pool.query("SELECT * FROM notificaciones LIMIT 5");
    console.log('DATOS EN TABLA:');
    console.log(JSON.stringify(data.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}

check();
