import { pool } from './db.js';
async function run() {
    const res = await pool.query("SELECT usuario_id, nombre FROM profesionales WHERE nombre ILIKE '%Jean%'");
    console.log(res.rows);
    pool.end();
}
run();
